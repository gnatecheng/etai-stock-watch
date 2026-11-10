import { findNextValidFillBar, type BarRow } from "./fill";
import { DEMO_FEE_SCHEDULES, type FeeScheduleRow } from "./fees";
import { fillPendingOrderFromRow, type PendingOrderRow } from "./fill-order";

export interface PendingEodResult {
  scanned: number;
  filled: number;
  stillPending: number;
  rejected: { orderId: string; code: string; message: string }[];
}

export async function loadFeeSchedules(db: D1Database): Promise<FeeScheduleRow[]> {
  const rows = await db.prepare("SELECT * FROM fee_schedules").bind().all();
  return (rows.results?.length ?? 0) > 0
    ? (rows.results as unknown as FeeScheduleRow[])
    : DEMO_FEE_SCHEDULES;
}

/**
 * 在 EOD 批次内推进已确认 pending 单：仅当下一可交易 session 行情已入库且 fillDate<=本次 EOD 交易日。
 * 不从信号自动建单。
 */
export async function processPendingPaperOrdersOnEod(
  db: D1Database,
  tradeDate: string,
  fees?: FeeScheduleRow[],
): Promise<PendingEodResult> {
  const feeRows = fees ?? (await loadFeeSchedules(db));
  const pending = await db
    .prepare(
      `SELECT o.id, o.user_id, o.instrument_id, o.side, o.quantity, o.idempotency_key, o.meta_json,
              i.board_lot
       FROM paper_orders o JOIN instruments i ON i.id = o.instrument_id
       WHERE o.status = 'pending' ORDER BY o.requested_at ASC`,
    )
    .bind()
    .all();

  const result: PendingEodResult = { scanned: 0, filled: 0, stillPending: 0, rejected: [] };

  for (const raw of pending.results ?? []) {
    const row = raw as unknown as PendingOrderRow & { board_lot: number };
    result.scanned++;
    const signalDate = parseSignalDate(row.meta_json);
    if (!signalDate) {
      result.rejected.push({ orderId: row.id, code: "NO_SIGNAL_DATE", message: "缺少 signalDate" });
      continue;
    }

    const bars = await db
      .prepare(
        `SELECT trade_date, open_cents, close_cents, volume FROM bars_daily
         WHERE instrument_id = ? ORDER BY trade_date`,
      )
      .bind(row.instrument_id)
      .all();

    const fillBar = await findNextValidFillBar(
      db,
      (bars.results ?? []) as unknown as BarRow[],
      signalDate,
    );
    if (!fillBar) {
      result.stillPending++;
      continue;
    }
    if (fillBar.trade_date > tradeDate) {
      result.stillPending++;
      continue;
    }

    const attempt = await fillPendingOrderFromRow(db, row, row.board_lot, signalDate, fillBar, feeRows);
    if (!attempt.ok) {
      result.rejected.push({ orderId: row.id, code: attempt.code, message: attempt.message });
      continue;
    }
    if (attempt.status === "filled") result.filled++;
    else result.stillPending++;
  }

  return result;
}

function parseSignalDate(metaJson: string | null): string | null {
  if (!metaJson) return null;
  try {
    const m = JSON.parse(metaJson) as { signalDate?: string };
    return m.signalDate ?? null;
  } catch {
    return null;
  }
}
