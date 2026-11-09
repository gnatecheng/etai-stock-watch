import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import { assertCalendarCoverage, getSessionType } from "../calendar/hk";
import { persistBars } from "../providers/import";
import type { DailyBar } from "../providers/types";
import type {
  ImportBatchStatus,
  ImportBatchType,
  StagedBarPayload,
  StagedFinancialPayload,
} from "./batch-types";
import { finVisibleForHistoricalScreen } from "./fin-point-in-time";

const ALLOWED_FIN_METRICS = new Set([
  "operating_revenue",
  "net_profit_attr_parent",
  "basic_eps",
  "roe",
  "gross_margin",
]);

export async function createImportBatch(
  db: D1Database,
  input: {
    batchType: ImportBatchType;
    source: string;
    idempotencyKey: string;
    tradeDateScope?: string;
    rowCountExpected?: number;
    scopeComplete?: boolean;
  },
): Promise<{ batchId: string; status: ImportBatchStatus; created: boolean }> {
  const existing = await db
    .prepare("SELECT id, status FROM import_batches WHERE idempotency_key = ?")
    .bind(input.idempotencyKey)
    .first<{ id: string; status: ImportBatchStatus }>();
  if (existing) {
    return { batchId: existing.id, status: existing.status, created: false };
  }
  const id = newId("ibat");
  await db
    .prepare(
      `INSERT INTO import_batches (id, batch_type, source, status, idempotency_key, trade_date_scope,
       scope_complete, row_count_expected, row_count_staged, created_at, updated_at)
       VALUES (?, ?, ?, 'staging', ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      input.batchType,
      input.source,
      input.idempotencyKey,
      input.tradeDateScope ?? null,
      input.scopeComplete ? 1 : 0,
      input.rowCountExpected ?? null,
      nowIso(),
      nowIso(),
    )
    .run();
  return { batchId: id, status: "staging", created: true };
}

export async function stageBatchRows(
  db: D1Database,
  batchId: string,
  rows: { seq: number; payloadType: "bar" | "financial"; payload: unknown }[],
): Promise<{ accepted: number }> {
  const batch = await db
    .prepare("SELECT status FROM import_batches WHERE id = ?")
    .bind(batchId)
    .first<{ status: ImportBatchStatus }>();
  if (!batch || batch.status !== "staging") {
    throw new Error("BATCH_NOT_STAGING");
  }
  let accepted = 0;
  for (const row of rows) {
    try {
      await db
        .prepare(
          `INSERT INTO import_batch_rows (id, batch_id, seq, payload_type, payload_json, validation_status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
        )
        .bind(newId("ibr"), batchId, row.seq, row.payloadType, JSON.stringify(row.payload))
        .run();
      accepted++;
    } catch {
      /* duplicate seq — idempotent replay skip */
    }
  }
  await db
    .prepare(
      `UPDATE import_batches SET row_count_staged = (SELECT COUNT(*) FROM import_batch_rows WHERE batch_id = ?), updated_at = ? WHERE id = ?`,
    )
    .bind(batchId, nowIso(), batchId)
    .run();
  return { accepted };
}

export async function validateBatch(db: D1Database, batchId: string): Promise<{ ok: boolean; errors: string[] }> {
  const batch = await db
    .prepare("SELECT * FROM import_batches WHERE id = ?")
    .bind(batchId)
    .first<{
      status: ImportBatchStatus;
      batch_type: ImportBatchType;
      trade_date_scope: string | null;
      scope_complete: number;
    }>();
  if (!batch) return { ok: false, errors: ["批次不存在"] };
  if (batch.status === "published" || batch.status === "failed" || batch.status === "abandoned") {
    return { ok: false, errors: [`批次状态不可验证: ${batch.status}`] };
  }
  await db
    .prepare("UPDATE import_batches SET status = 'validating', updated_at = ? WHERE id = ?")
    .bind(nowIso(), batchId)
    .run();

  const rows = await db
    .prepare("SELECT id, payload_type, payload_json FROM import_batch_rows WHERE batch_id = ? ORDER BY seq")
    .bind(batchId)
    .all<{ id: string; payload_type: string; payload_json: string }>();

  const errors: string[] = [];
  const symbolSet = new Set<string>();
  const instRows = await db.prepare("SELECT id, symbol FROM instruments").bind().all<{ id: string; symbol: string }>();
  const symMap = new Map((instRows.results ?? []).map((r) => [r.symbol, r.id]));

  for (const row of rows.results ?? []) {
    try {
      if (row.payload_type === "bar") {
        const p = JSON.parse(row.payload_json) as StagedBarPayload;
        if (!symMap.has(p.symbol)) throw new Error(`未知标的 ${p.symbol}`);
        if (batch.trade_date_scope && p.trade_date !== batch.trade_date_scope) {
          throw new Error(`trade_date 与 scope ${batch.trade_date_scope} 不一致`);
        }
        if (batch.trade_date_scope) {
          const cal = await getSessionType(db, p.trade_date);
          const cov = assertCalendarCoverage(p.trade_date, cal.source);
          if (!cov.ok) throw new Error(cov.reason ?? "日历未配置");
        }
        symbolSet.add(p.symbol);
        await db
          .prepare("UPDATE import_batch_rows SET validation_status = 'ok', validation_message = NULL WHERE id = ?")
          .bind(row.id)
          .run();
      } else if (row.payload_type === "financial") {
        const p = JSON.parse(row.payload_json) as StagedFinancialPayload;
        if (!symMap.has(p.symbol)) throw new Error(`未知标的 ${p.symbol}`);
        for (const k of Object.keys(p.metrics)) {
          if (!ALLOWED_FIN_METRICS.has(k)) throw new Error(`未映射指标: ${k}`);
          const v = p.metrics[k];
          if (v !== null && !Number.isFinite(v)) throw new Error(`指标 ${k} 非法`);
        }
        await db
          .prepare("UPDATE import_batch_rows SET validation_status = 'ok', validation_message = NULL WHERE id = ?")
          .bind(row.id)
          .run();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      await db
        .prepare("UPDATE import_batch_rows SET validation_status = 'error', validation_message = ? WHERE id = ?")
        .bind(msg, row.id)
        .run();
    }
  }

  if (batch.batch_type === "bars_daily" && batch.scope_complete && batch.trade_date_scope && errors.length === 0) {
    /* scope_complete 由采集端显式声明当日完整；此处仅校验日历与行内日期一致 */
  }

  const ok = errors.length === 0 && (rows.results?.length ?? 0) > 0;
  await db
    .prepare(
      `UPDATE import_batches SET status = ?, error_summary = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(ok ? "validated" : "failed", ok ? null : errors.slice(0, 20).join("; "), nowIso(), batchId)
    .run();
  return { ok, errors };
}

export async function publishBatch(
  db: D1Database,
  batchId: string,
  snapshotMeta: { provider: string; provenance: Record<string, unknown> },
): Promise<{ published: boolean; reason?: string }> {
  const batch = await db
    .prepare("SELECT * FROM import_batches WHERE id = ?")
    .bind(batchId)
    .first<{
      status: ImportBatchStatus;
      batch_type: ImportBatchType;
      idempotency_key: string;
      trade_date_scope: string | null;
      scope_complete: number;
    }>();
  if (!batch) return { published: false, reason: "批次不存在" };
  if (batch.status === "published") return { published: true };
  if (batch.status !== "validated") return { published: false, reason: `须先 validated，当前 ${batch.status}` };

  const lock = await db
    .prepare("UPDATE import_batches SET status = 'publishing', updated_at = ? WHERE id = ? AND status = 'validated'")
    .bind(nowIso(), batchId)
    .run();
  if ((lock.meta?.changes ?? 0) === 0) return { published: false, reason: "并发发布冲突" };

  const rows = await db
    .prepare(
      "SELECT payload_type, payload_json FROM import_batch_rows WHERE batch_id = ? AND validation_status = 'ok' ORDER BY seq",
    )
    .bind(batchId)
    .all<{ payload_type: string; payload_json: string }>();

  if (!rows.results?.length) {
    await db
      .prepare("UPDATE import_batches SET status = 'failed', error_summary = ?, updated_at = ? WHERE id = ?")
      .bind("无有效行", nowIso(), batchId)
      .run();
    return { published: false, reason: "无有效行" };
  }

  const snapId = newId("snap");
  const symMap = new Map(
    (await db.prepare("SELECT id, symbol FROM instruments").bind().all<{ id: string; symbol: string }>())
      .results?.map((r) => [r.symbol, r.id]) ?? [],
  );

  try {
    await db
      .prepare(
        `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
         VALUES (?, ?, 'import-v2', ?, ?, ?)`,
      )
      .bind(
        snapId,
        snapshotMeta.provider,
        nowIso(),
        rows.results.length,
        JSON.stringify({
          ...snapshotMeta.provenance,
          import_batch_id: batchId,
          idempotency_key: batch.idempotency_key,
        }),
      )
      .run();

    if (batch.batch_type === "bars_daily") {
      const bars: DailyBar[] = [];
      for (const row of rows.results) {
        const p = JSON.parse(row.payload_json) as StagedBarPayload;
        const instId = symMap.get(p.symbol)!;
        const trustworthy = p.turnover_trustworthy === true && p.turnover_hkd != null;
        bars.push({
          instrument_id: instId,
          trade_date: p.trade_date,
          open_cents: Math.round(p.open * 100),
          high_cents: Math.round(p.high * 100),
          low_cents: Math.round(p.low * 100),
          close_cents: Math.round(p.close * 100),
          volume: Math.round(p.volume),
          turnover_cents: trustworthy ? Math.round(p.turnover_hkd! * 100) : undefined,
          adj_factor: 10000,
        });
      }
      await persistBars(db, bars, snapId);
      if (snapshotMeta.provenance.turnover_trustworthy === true) {
        await db
          .prepare(`UPDATE data_snapshots SET provenance_json = ? WHERE id = ?`)
          .bind(
            JSON.stringify({
              ...snapshotMeta.provenance,
              import_batch_id: batchId,
              turnover_trustworthy: true,
              turnover_source: "vendor_reported",
            }),
            snapId,
          )
          .run();
      }
    } else if (batch.batch_type === "financial") {
      const pubAt = nowIso();
      for (const row of rows.results) {
        const p = JSON.parse(row.payload_json) as StagedFinancialPayload;
        const instId = symMap.get(p.symbol)!;
        const finId = newId("fin");
        await db
          .prepare(
            `INSERT INTO fin_report_versions (id, instrument_id, report_family, statement_type, period_end, period_type,
             accounting_standard, currency, unit_label, source, collected_at, announced_at, revision, import_batch_id, published_at, metrics_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'akshare', ?, ?, 1, ?, ?, ?)`,
          )
          .bind(
            finId,
            instId,
            p.report_family,
            p.statement_type ?? null,
            p.period_end,
            p.period_type,
            p.accounting_standard ?? null,
            p.currency,
            p.unit_label,
            pubAt,
            p.announced_at ?? null,
            batchId,
            pubAt,
            JSON.stringify(p.metrics),
          )
          .run();
      }
    }

    await db
      .prepare("UPDATE import_batches SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), batchId)
      .run();
    return { published: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .prepare("UPDATE import_batches SET status = 'failed', error_summary = ?, updated_at = ? WHERE id = ?")
      .bind(msg, nowIso(), batchId)
      .run();
    return { published: false, reason: msg };
  }
}

export async function abandonFailedBatch(db: D1Database, batchId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE import_batches SET status = 'abandoned', updated_at = ? WHERE id = ? AND status IN ('failed', 'staging', 'validating')`,
    )
    .bind(nowIso(), batchId)
    .run();
}

export { finVisibleForHistoricalScreen, ALLOWED_FIN_METRICS };
