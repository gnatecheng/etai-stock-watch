import { newId } from "../lib/id";
import { nowIso, addDays } from "../lib/time";
import { roundLots, mulPriceQty } from "../lib/money";
import { computeTradeFees, notional, type FeeScheduleRow } from "./fees";

export interface PaperConfirmInput {
  userId: string;
  instrumentId: string;
  side: "buy" | "sell";
  quantity: number;
  boardLot: number;
  signalTradeDate: string;
  idempotencyKey: string;
}

export interface BarRow {
  trade_date: string;
  open_cents: number;
  close_cents: number;
  volume: number;
}

/**
 * 下一可交易 session 开盘价成交 — 禁止用信号当日收盘价回填。
 */
export function findFillBar(
  bars: BarRow[],
  afterDate: string,
): BarRow | null {
  const sorted = [...bars].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return sorted.find((b) => b.trade_date > afterDate && b.volume > 0) ?? null;
}

export async function confirmPaperOrder(
  db: D1Database,
  input: PaperConfirmInput,
  bars: BarRow[],
  fees: FeeScheduleRow[],
): Promise<{ ok: true; orderId: string } | { ok: false; code: string; message: string }> {
  const lotsQty = roundLots(input.quantity, input.boardLot);
  if (lotsQty <= 0) {
    return { ok: false, code: "INVALID_LOT", message: "数量须为整手" };
  }

  const existing = await db
    .prepare("SELECT id FROM paper_orders WHERE user_id = ? AND idempotency_key = ?")
    .bind(input.userId, input.idempotencyKey)
    .first();
  if (existing) {
    return { ok: true, orderId: existing.id as string };
  }

  const fillBar = findFillBar(bars, input.signalTradeDate);
  if (!fillBar) {
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
        JSON.stringify({ reason: "awaiting_next_session" }),
      )
      .run();
    return { ok: true, orderId };
  }

  const fillPrice = fillBar.open_cents;
  const tradeDate = fillBar.trade_date;
  const gross = notional(fillPrice, lotsQty);
  const { total: feesCents } = computeTradeFees(gross, fees, tradeDate);

  const account = await db
    .prepare("SELECT cash_cents FROM paper_accounts WHERE user_id = ?")
    .bind(input.userId)
    .first<{ cash_cents: number }>();
  if (!account) {
    return { ok: false, code: "NO_ACCOUNT", message: "模拟账户不存在" };
  }

  const pos = await db
    .prepare("SELECT quantity FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
    .bind(input.userId, input.instrumentId)
    .first<{ quantity: number }>();

  if (input.side === "buy") {
    const cost = gross + feesCents;
    if (account.cash_cents < cost) {
      return { ok: false, code: "INSUFFICIENT_FUNDS", message: "模拟资金不足" };
    }
  } else {
    const held = pos?.quantity ?? 0;
    if (held < lotsQty) {
      return { ok: false, code: "INSUFFICIENT_SHARES", message: "持仓不足" };
    }
  }

  const orderId = newId("pord");
  const tradeId = newId("ptrd");

  const stmts = [
    db
      .prepare(
        `INSERT INTO paper_orders (id, user_id, instrument_id, side, quantity, status, idempotency_key, requested_at, fill_trade_date, fill_price_cents, fees_cents, meta_json)
         VALUES (?, ?, ?, ?, ?, 'filled', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        orderId,
        input.userId,
        input.instrumentId,
        input.side,
        lotsQty,
        input.idempotencyKey,
        nowIso(),
        tradeDate,
        fillPrice,
        feesCents,
        JSON.stringify({ fillRule: "next_session_open", signalDate: input.signalTradeDate }),
      ),
  ];

  if (input.side === "buy") {
    const cost = gross + feesCents;
    stmts.push(
      db
        .prepare("UPDATE paper_accounts SET cash_cents = cash_cents - ?, updated_at = ? WHERE user_id = ?")
        .bind(cost, nowIso(), input.userId),
    );
    const newQty = (pos?.quantity ?? 0) + lotsQty;
    const prevAvg = await db
      .prepare("SELECT avg_cost_cents FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
      .bind(input.userId, input.instrumentId)
      .first<{ avg_cost_cents: number }>();
    const prevQ = pos?.quantity ?? 0;
    const newAvg =
      prevQ === 0
        ? Math.round(gross / lotsQty)
        : Math.round((prevAvg!.avg_cost_cents * prevQ + gross) / newQty);
    stmts.push(
      db
        .prepare(
          `INSERT INTO paper_positions (user_id, instrument_id, quantity, avg_cost_cents, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, instrument_id) DO UPDATE SET quantity = ?, avg_cost_cents = ?, updated_at = ?`,
        )
        .bind(
          input.userId,
          input.instrumentId,
          newQty,
          newAvg,
          nowIso(),
          newQty,
          newAvg,
          nowIso(),
        ),
    );
  } else {
    const proceeds = gross - feesCents;
    stmts.push(
      db
        .prepare("UPDATE paper_accounts SET cash_cents = cash_cents + ?, updated_at = ? WHERE user_id = ?")
        .bind(proceeds, nowIso(), input.userId),
    );
    const newQty = (pos?.quantity ?? 0) - lotsQty;
    if (newQty <= 0) {
      stmts.push(
        db
          .prepare("DELETE FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
          .bind(input.userId, input.instrumentId),
      );
    } else {
      stmts.push(
        db
          .prepare(
            "UPDATE paper_positions SET quantity = ?, updated_at = ? WHERE user_id = ? AND instrument_id = ?",
          )
          .bind(newQty, nowIso(), input.userId, input.instrumentId),
      );
    }
  }

  stmts.push(
    db
      .prepare(
        `INSERT INTO paper_trades (id, user_id, order_id, instrument_id, side, quantity, price_cents, fees_cents, trade_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        tradeId,
        input.userId,
        orderId,
        input.instrumentId,
        input.side,
        lotsQty,
        fillPrice,
        feesCents,
        tradeDate,
        nowIso(),
      ),
  );

  await db.batch(stmts);
  return { ok: true, orderId };
}

export function nextSessionAfterSignal(signalDate: string): string {
  return addDays(signalDate, 1);
}
