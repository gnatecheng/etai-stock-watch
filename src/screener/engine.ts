import type { Env } from "../env";
import { isDemoProvider } from "../env";
import { isTurnoverTrustworthy, turnoverFilterSupported } from "./trust";
import type {
  ConditionEvaluation,
  ScreenerCapabilities,
  ScreenerCondition,
  ScreenerHit,
  ScreenerRunRequest,
  ScreenerRunResult,
} from "./types";

interface BarRow {
  trade_date: string;
  open_cents: number;
  close_cents: number;
  volume: number;
  turnover_cents: number | null;
  snapshot_id: string;
}

interface InstRow {
  id: string;
  symbol: string;
  name_zh: string;
  currency: string;
  board_lot: number;
}

export async function screenerCapabilities(env: Env, db: D1Database): Promise<ScreenerCapabilities> {
  const turnover = await turnoverFilterSupported(env, db);
  const demo = isDemoProvider(env);
  return {
    demo,
    demoWatermark: env.DEMO_WATERMARK ?? "演示数据",
    units: {
      price: "收盘价：港币（HKD），基于日线收盘价，盘后数据",
      changePct: "涨跌幅：相对上一交易日收盘价的变化百分比（%）",
      turnover: "成交额：港币（HKD），仅当行情快照标注为供应商可信披露时可用",
      ma: "均线：简单算术平均收盘价（SMA），周期为用户所选交易日数",
    },
    turnoverSupported: turnover.supported,
    turnoverUnsupportedReason: turnover.reason,
    disclaimer: "筛选结果依您设置的条件组合（AND），与「信号」页的 20MA 策略无关，不构成投资建议。",
    signalDisclaimer: "信号 Tab 为固定策略输出；筛选 Tab 为用户自定义条件。",
    maxMaPeriod: 120,
    minMaPeriod: 2,
  };
}

function sma(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function resolveAsOfDate(db: D1Database, req?: string): Promise<string | null> {
  if (req) return req;
  const row = await db
    .prepare("SELECT MAX(trade_date) as d FROM bars_daily")
    .bind()
    .first<{ d: string }>();
  return row?.d ?? null;
}

async function loadSnapshots(db: D1Database): Promise<Map<string, string | null>> {
  const rows = await db.prepare("SELECT id, provenance_json FROM data_snapshots").bind().all<{
    id: string;
    provenance_json: string | null;
  }>();
  const m = new Map<string, string | null>();
  for (const r of rows.results ?? []) {
    m.set(r.id, r.provenance_json);
  }
  return m;
}

function evalPriceClose(bar: BarRow, c: Extract<ScreenerCondition, { type: "price_close" }>): ConditionEvaluation {
  const closeHkd = bar.close_cents / 100;
  const values = { closeHkd, closeCents: bar.close_cents };
  if (c.minHkd !== undefined && closeHkd < c.minHkd) {
    return { type: "price_close", status: "fail", reason: `收盘价 ${closeHkd.toFixed(2)} HKD 低于下限 ${c.minHkd}`, values };
  }
  if (c.maxHkd !== undefined && closeHkd > c.maxHkd) {
    return { type: "price_close", status: "fail", reason: `收盘价 ${closeHkd.toFixed(2)} HKD 高于上限 ${c.maxHkd}`, values };
  }
  return {
    type: "price_close",
    status: "pass",
    reason: `收盘价 ${closeHkd.toFixed(2)} HKD 落在设定区间`,
    values,
  };
}

function evalChangePct(
  bars: BarRow[],
  asOf: string,
  c: Extract<ScreenerCondition, { type: "change_pct" }>,
): ConditionEvaluation {
  const idx = bars.findIndex((b) => b.trade_date === asOf);
  if (idx < 0) {
    return { type: "change_pct", status: "excluded", reason: `缺少 ${asOf} 日线收盘价` };
  }
  if (idx < 1) {
    return { type: "change_pct", status: "excluded", reason: "无上一交易日收盘价，无法计算涨跌幅" };
  }
  const prev = bars[idx - 1]!;
  const cur = bars[idx]!;
  if (prev.close_cents <= 0) {
    return { type: "change_pct", status: "excluded", reason: "上一交易日收盘价无效" };
  }
  const pct = ((cur.close_cents - prev.close_cents) / prev.close_cents) * 100;
  const values = {
    changePct: Math.round(pct * 100) / 100,
    prevCloseHkd: prev.close_cents / 100,
    closeHkd: cur.close_cents / 100,
    prevDate: prev.trade_date,
  };
  if (c.minPct !== undefined && pct < c.minPct) {
    return { type: "change_pct", status: "fail", reason: `涨跌幅 ${pct.toFixed(2)}% 低于下限 ${c.minPct}%`, values };
  }
  if (c.maxPct !== undefined && pct > c.maxPct) {
    return { type: "change_pct", status: "fail", reason: `涨跌幅 ${pct.toFixed(2)}% 高于上限 ${c.maxPct}%`, values };
  }
  return { type: "change_pct", status: "pass", reason: `涨跌幅 ${pct.toFixed(2)}% 符合区间`, values };
}

function evalMa(
  bars: BarRow[],
  asOf: string,
  c: Extract<ScreenerCondition, { type: "ma_relation" }>,
): ConditionEvaluation {
  const sorted = [...bars].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const idx = sorted.findIndex((b) => b.trade_date === asOf);
  if (idx < 0) {
    return { type: "ma_relation", status: "excluded", reason: `缺少 ${asOf} 日线` };
  }
  const window = sorted.slice(0, idx + 1);
  if (window.length < c.period) {
    return {
      type: "ma_relation",
      status: "excluded",
      reason: `均线历史不足：需要至少 ${c.period} 个交易日，当前仅 ${window.length} 根`,
      values: { haveBars: window.length, needBars: c.period },
    };
  }
  const closes = window.map((b) => b.close_cents);
  const ma = sma(closes.slice(-c.period));
  const close = closes[closes.length - 1]!;
  const closeHkd = close / 100;
  const maHkd = ma / 100;
  const values = { closeHkd, maHkd, period: c.period, relation: c.relation };
  const above = close > ma;
  if (c.relation === "above" && !above) {
    return { type: "ma_relation", status: "fail", reason: `收盘 ${closeHkd.toFixed(2)} 未高于 MA${c.period} ${maHkd.toFixed(2)}`, values };
  }
  if (c.relation === "below" && above) {
    return { type: "ma_relation", status: "fail", reason: `收盘 ${closeHkd.toFixed(2)} 未低于 MA${c.period} ${maHkd.toFixed(2)}`, values };
  }
  return {
    type: "ma_relation",
    status: "pass",
    reason: `收盘 ${closeHkd.toFixed(2)} ${c.relation === "above" ? "高于" : "低于"} MA${c.period} ${maHkd.toFixed(2)}`,
    values,
  };
}

function evalTurnover(
  env: Env,
  bar: BarRow,
  provenance: string | null | undefined,
  c: Extract<ScreenerCondition, { type: "turnover" }>,
): ConditionEvaluation {
  if (!isTurnoverTrustworthy(env, provenance ?? null, bar.turnover_cents)) {
    return {
      type: "turnover",
      status: "excluded",
      reason: "当日成交额字段不可信或缺失（不使用收盘价×成交量推算）",
      values: { turnoverTrusted: false },
    };
  }
  const turnoverHkd = (bar.turnover_cents ?? 0) / 100;
  const values = { turnoverHkd, turnoverCents: bar.turnover_cents };
  if (c.minHkd !== undefined && turnoverHkd < c.minHkd) {
    return { type: "turnover", status: "fail", reason: `成交额 ${turnoverHkd.toFixed(0)} HKD 低于下限`, values };
  }
  if (c.maxHkd !== undefined && turnoverHkd > c.maxHkd) {
    return { type: "turnover", status: "fail", reason: `成交额 ${turnoverHkd.toFixed(0)} HKD 高于上限`, values };
  }
  return { type: "turnover", status: "pass", reason: `成交额 ${turnoverHkd.toFixed(0)} HKD 符合区间`, values };
}

function instrumentMatches(evals: ConditionEvaluation[]): boolean {
  return evals.every((e) => e.status === "pass");
}

export async function runScreener(
  env: Env,
  db: D1Database,
  request: ScreenerRunRequest,
): Promise<ScreenerRunResult> {
  const caps = await screenerCapabilities(env, db);
  const asOf = await resolveAsOfDate(db, request.asOfDate);
  if (!asOf) {
    return {
      asOfDate: "",
      dataLabel: caps.demo ? caps.demoWatermark : "日线收盘后",
      demo: caps.demo,
      turnoverFilterSupported: caps.turnoverSupported,
      conditionsRequested: request.conditions,
      hits: [],
      evaluatedCount: 0,
      message: "尚无日线行情，无法筛选",
    };
  }

  const instruments = await db
    .prepare("SELECT id, symbol, name_zh, currency, board_lot FROM instruments WHERE status = 'active'")
    .bind()
    .all<InstRow>();

  const snapProv = await loadSnapshots(db);
  const hits: ScreenerHit[] = [];
  let evaluatedCount = 0;

  for (const inst of instruments.results ?? []) {
    const barRows = await db
      .prepare(
        `SELECT trade_date, open_cents, close_cents, volume, turnover_cents, snapshot_id
         FROM bars_daily WHERE instrument_id = ? ORDER BY trade_date`,
      )
      .bind(inst.id)
      .all<BarRow>();

    const bars = barRows.results ?? [];
    const bar = bars.find((b) => b.trade_date === asOf);
    if (!bar) {
      evaluatedCount++;
      continue;
    }

    const evals: ConditionEvaluation[] = [];
    for (const cond of request.conditions) {
      switch (cond.type) {
        case "price_close":
          evals.push(evalPriceClose(bar, cond));
          break;
        case "change_pct":
          evals.push(evalChangePct(bars, asOf, cond));
          break;
        case "ma_relation":
          evals.push(evalMa(bars, asOf, cond));
          break;
        case "turnover": {
          const prov = snapProv.get(bar.snapshot_id);
          evals.push(evalTurnover(env, bar, prov, cond));
          break;
        }
        default:
          break;
      }
    }

    evaluatedCount++;
    if (!instrumentMatches(evals)) continue;

    const summaryReasons = evals.map((e) => e.reason);
    hits.push({
      instrumentId: inst.id,
      symbol: inst.symbol,
      nameZh: inst.name_zh,
      currency: inst.currency,
      boardLot: inst.board_lot,
      tradeDate: asOf,
      conditionResults: evals,
      summaryReasons,
    });
  }

  return {
    asOfDate: asOf,
    dataLabel: caps.demo ? `${caps.demoWatermark} · 合成 DEMO` : "正式收盘日线",
    demo: caps.demo,
    turnoverFilterSupported: caps.turnoverSupported,
    conditionsRequested: request.conditions,
    hits,
    evaluatedCount,
    message: hits.length === 0 ? "当前条件下无命中标的，可调整条件后重筛" : undefined,
  };
}
