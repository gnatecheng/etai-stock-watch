import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import { roundLots } from "../lib/money";
import type { FeeScheduleRow } from "./fees";
import { assertCalendarCoverage, getSessionType } from "../calendar/hk";
import type { BarRow } from "./fill";

export interface PaperConfirmInput {
  userId: string;
  instrumentId: string;
  side: "buy" | "sell";
  quantity: number;
  boardLot: number;
  signalTradeDate: string;
  idempotencyKey: string;
}

/**
 * 用户明确确认 → 仅创建/返回 pending（或已 filled）。
 * 成交由 EOD {@link processPendingPaperOrdersOnEod} 在下一 session 行情就绪后推进。
 */
export async function confirmPaperOrder(
  db: D1Database,
  input: PaperConfirmInput,
  _bars: BarRow[],
  _fees: FeeScheduleRow[],
): Promise<
  | { ok: true; orderId: string; status: "filled" | "pending" }
  | { ok: false; code: string; message: string }
> {
  const lotsQty = roundLots(input.quantity, input.boardLot);
  if (lotsQty <= 0) {
    return { ok: false, code: "INVALID_LOT", message: "数量须为整手" };
  }

  const signalCal = await getSessionType(db, input.signalTradeDate);
  const calOk = assertCalendarCoverage(input.signalTradeDate, signalCal.source);
  if (!calOk.ok) {
    return { ok: false, code: "CALENDAR", message: calOk.reason ?? "日历未配置" };
  }
  if (signalCal.session === "closed") {
    return { ok: false, code: "CLOSED_DAY", message: "信号日非交易 session" };
  }

  const existing = await db
    .prepare(
      "SELECT id, status FROM paper_orders WHERE user_id = ? AND idempotency_key = ?",
    )
    .bind(input.userId, input.idempotencyKey)
    .first<{ id: string; status: string }>();

  if (existing) {
    return {
      ok: true,
      orderId: existing.id,
      status: existing.status === "filled" ? "filled" : "pending",
    };
  }

  const orderId = newId("pord");
  await db
    .prepare(
      `INSERT INTO paper_orders (id, user_id, instrument_id, side, quantity, status, idempotency_key, requested_at, meta_json)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(
      orderId,
      input.userId,
      input.instrumentId,
      input.side,
      lotsQty,
      input.idempotencyKey,
      nowIso(),
      JSON.stringify({
        reason: "awaiting_next_session",
        signalDate: input.signalTradeDate,
        confirmedBy: "user",
      }),
    )
    .run();
  return { ok: true, orderId, status: "pending" };
}
