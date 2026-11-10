import type { Env } from "../env";
import { financialScreeningAllowed, isDemoProvider } from "../env";
import { finRowEligibleForScreen } from "../import/fin-point-in-time";
import { ALLOWED_FIN_METRICS } from "../import/batch-service";

export interface FinScreenerCondition {
  metric: string;
  min?: number;
  max?: number;
}

export interface FinScreenerRequest {
  asOfDate: string;
  conditions: FinScreenerCondition[];
}

export interface FinScreenerHit {
  instrumentId: string;
  symbol: string;
  nameZh: string;
  periodEnd: string;
  announcedAt: string | null;
  currency: string;
  unitLabel: string;
  metricResults: { metric: string; status: "pass" | "fail" | "excluded"; reason: string }[];
  summaryReasons: string[];
}

export interface FinScreenerResult {
  asOfDate: string;
  demo: boolean;
  dataLabel: string;
  hits: FinScreenerHit[];
  evaluatedCount: number;
  message?: string;
}

export function validateFinScreenerRequest(
  body: FinScreenerRequest,
  allowed: { allowed: boolean; reason?: string },
):
  | { ok: true; request: FinScreenerRequest }
  | { ok: false; code: string; message: string } {
  if (!allowed.allowed) {
    return { ok: false, code: "FIN_SCREEN_BLOCKED", message: allowed.reason ?? "财务筛选不可用" };
  }
  if (!body?.asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.asOfDate)) {
    return { ok: false, code: "INVALID_DATE", message: "须提供 asOfDate YYYY-MM-DD" };
  }
  if (!Array.isArray(body.conditions) || body.conditions.length === 0) {
    return { ok: false, code: "NO_CONDITIONS", message: "至少一项财务指标条件" };
  }
  for (const c of body.conditions) {
    if (!ALLOWED_FIN_METRICS.has(c.metric)) {
      return { ok: false, code: "METRIC_NOT_MAPPED", message: `未映射指标: ${c.metric}（不支持 PE/TTM）` };
    }
    if (c.min === undefined && c.max === undefined) {
      return { ok: false, code: "EMPTY_RANGE", message: `${c.metric} 须指定 min 或 max` };
    }
    if (c.min !== undefined && !Number.isFinite(c.min)) {
      return { ok: false, code: "INVALID_NUM", message: "min 非法" };
    }
    if (c.max !== undefined && !Number.isFinite(c.max)) {
      return { ok: false, code: "INVALID_NUM", message: "max 非法" };
    }
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) {
      return { ok: false, code: "INVALID_RANGE", message: "min > max" };
    }
  }
  return { ok: true, request: body };
}

export async function runFinancialScreener(
  env: Env,
  db: D1Database,
  request: FinScreenerRequest,
): Promise<FinScreenerResult> {
  const demo = isDemoProvider(env);
  const asOf = request.asOfDate;

  const instruments = await db
    .prepare("SELECT id, symbol, name_zh FROM instruments WHERE status = 'active'")
    .bind()
    .all<{ id: string; symbol: string; name_zh: string }>();

  const hits: FinScreenerHit[] = [];
  let evaluated = 0;

  for (const inst of instruments.results ?? []) {
    const fin = await db
      .prepare(
        `SELECT period_end, announced_at, currency, unit_label, metrics_json
         FROM fin_report_versions
         WHERE instrument_id = ? AND period_end <= ?
         ORDER BY period_end DESC LIMIT 1`,
      )
      .bind(inst.id, asOf)
      .first<{
        period_end: string;
        announced_at: string | null;
        currency: string;
        unit_label: string;
        metrics_json: string;
      }>();

    if (!fin) {
      evaluated++;
      continue;
    }

    const metricResults: FinScreenerHit["metricResults"] = [];
    let allPass = true;
    for (const cond of request.conditions) {
      const min = cond.min ?? -Infinity;
      const check = finRowEligibleForScreen(
        { announced_at: fin.announced_at, metrics_json: fin.metrics_json },
        asOf,
        cond.metric,
        Number.isFinite(min) ? min : -Infinity,
      );
      let metrics: Record<string, number | null> = {};
      try {
        metrics = JSON.parse(fin.metrics_json) as Record<string, number | null>;
      } catch {
        /* */
      }
      const v = metrics[cond.metric];
      if (check.pass && cond.max !== undefined && v != null && v > cond.max) {
        metricResults.push({
          metric: cond.metric,
          status: "fail",
          reason: `${cond.metric}=${v} 高于上限 ${cond.max}`,
        });
        allPass = false;
        continue;
      }
      if (!check.pass) {
        metricResults.push({
          metric: cond.metric,
          status: check.reason.includes("公告") ? "excluded" : "fail",
          reason: check.reason,
        });
        allPass = false;
      } else {
        metricResults.push({ metric: cond.metric, status: "pass", reason: check.reason });
      }
    }
    evaluated++;
    if (!allPass) continue;
    hits.push({
      instrumentId: inst.id,
      symbol: inst.symbol,
      nameZh: inst.name_zh,
      periodEnd: fin.period_end,
      announcedAt: fin.announced_at,
      currency: fin.currency,
      unitLabel: fin.unit_label,
      metricResults,
      summaryReasons: metricResults.map((m) => m.reason),
    });
  }

  return {
    asOfDate: asOf,
    demo,
    dataLabel: demo ? "合成 DEMO 财务版本（import_batches 发布）" : "已发布财务版本",
    hits,
    evaluatedCount: evaluated,
    message: hits.length === 0 ? "无命中；检查公告日/指标缺失或 asOf 过早" : undefined,
  };
}
