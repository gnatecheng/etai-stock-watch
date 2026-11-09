import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import { computeTradeFees, notional, type FeeScheduleRow } from "./fees";
import type { BarRow } from "./fill";

/** 并发 EOD 填单互斥（job_runs.idempotency_key UNIQUE） */
async function acquirePaperFillLock(db: D1Database, orderId: string): Promise<boolean> {
  const ik = `paper|fill|${orderId}`;
  const taken = await db
    .prepare("SELECT id FROM job_runs WHERE idempotency_key = ?")
    .bind(ik)
    .first<{ id: string }>();
  if (taken) return false;
  try {
    await db
      .prepare(
        `INSERT INTO job_runs (id, job_type, market, trade_date, strategy_slug, strategy_version, status, started_at, finished_at, detail_json, idempotency_key)
         VALUES (?, 'paper_fill', 'HK', '', 'paper', 1, 'running', ?, NULL, '{}', ?)`,
      )
      .bind(newId("job"), nowIso(), ik)
      .run();
    return true;
  } catch {
    return false;
  }
}

async function releasePaperFillLock(db: D1Database, orderId: string, ok: boolean, detail: Record<string, unknown>) {
  const ik = `paper|fill|${orderId}`;
  await db
    .prepare("UPDATE job_runs SET status = ?, finished_at = ?, detail_json = ? WHERE idempotency_key = ?")
    .bind(ok ? "completed" : "failed", nowIso(), JSON.stringify(detail), ik)
    .run();
}

export interface PendingOrderRow {
  id: string;
  user_id: string;
  instrument_id: string;
  side: "buy" | "sell";
  quantity: number;
  idempotency_key: string;
  meta_json: string | null;
}

export async function fillPendingOrderFromRow(
  db: D1Database,
  row: PendingOrderRow,
  boardLot: number,
  signalTradeDate: string,
  fillBar: BarRow,
  fees: FeeScheduleRow[],
): Promise<
  | { ok: true; orderId: string; status: "filled" }
  | { ok: false; code: string; message: string }
  | { ok: true; orderId: string; status: "pending" }
> {
  const lotsQty = row.quantity;
  if (lotsQty <= 0 || lotsQty % boardLot !== 0) {
    return { ok: false, code: "INVALID_LOT", message: "数量须为整手" };
  }
  if (fillBar.trade_date <= signalTradeDate) {
    return { ok: false, code: "LOOKAHEAD", message: "禁止在信号当日或之前回填成交" };
  }

  const fillPrice = fillBar.open_cents;
  const tradeDate = fillBar.trade_date;
  const gross = notional(fillPrice, lotsQty);
  const { total: feesCents } = computeTradeFees(gross, fees, tradeDate);

  const account = await db
    .prepare("SELECT cash_cents FROM paper_accounts WHERE user_id = ?")
    .bind(row.user_id)
    .first<{ cash_cents: number }>();
  if (!account) return { ok: false, code: "NO_ACCOUNT", message: "模拟账户不存在" };

  const pos = await db
    .prepare("SELECT quantity FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
    .bind(row.user_id, row.instrument_id)
    .first<{ quantity: number }>();

  if (row.side === "buy") {
    const cost = gross + feesCents;
    if (account.cash_cents < cost) {
      return { ok: false, code: "INSUFFICIENT_FUNDS", message: "模拟资金不足" };
    }
  } else {
    const held = pos?.quantity ?? 0;
    if (held < lotsQty) {
      return { ok: false, code: "INSUFFICIENT_SHARES", message: "持仓不足，拒绝超卖" };
    }
  }

  const locked = await acquirePaperFillLock(db, row.id);
  if (!locked) {
    const st = await db
      .prepare("SELECT status FROM paper_orders WHERE id = ?")
      .bind(row.id)
      .first<{ status: string }>();
    if (st?.status === "filled") return { ok: true, orderId: row.id, status: "filled" };
    return { ok: true, orderId: row.id, status: "pending" };
  }

  const tradeId = newId("ptrd");
  const buyCost = gross + feesCents;
  const sellProceeds = gross - feesCents;

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE paper_orders SET status = 'filled', fill_trade_date = ?, fill_price_cents = ?, fees_cents = ?,
         meta_json = ? WHERE id = ? AND status = 'pending'`,
      )
      .bind(
        tradeDate,
        fillPrice,
        feesCents,
        JSON.stringify({
          fillRule: "next_session_open",
          signalDate: signalTradeDate,
          filledBy: "eod",
        }),
        row.id,
      ),
  ];

  if (row.side === "buy") {
    stmts.push(
      db
        .prepare(
          "UPDATE paper_accounts SET cash_cents = cash_cents - ?, updated_at = ? WHERE user_id = ? AND cash_cents >= ?",
        )
        .bind(buyCost, nowIso(), row.user_id, buyCost),
    );
    const newQty = (pos?.quantity ?? 0) + lotsQty;
    const prevAvg = await db
      .prepare("SELECT avg_cost_cents FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
      .bind(row.user_id, row.instrument_id)
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
          row.user_id,
          row.instrument_id,
          newQty,
          newAvg,
          nowIso(),
          newQty,
          newAvg,
          nowIso(),
        ),
    );
  } else {
    stmts.push(
      db
        .prepare("UPDATE paper_accounts SET cash_cents = cash_cents + ?, updated_at = ? WHERE user_id = ?")
        .bind(sellProceeds, nowIso(), row.user_id),
    );
    const newQty = (pos?.quantity ?? 0) - lotsQty;
    if (newQty <= 0) {
      stmts.push(
        db
          .prepare("DELETE FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
          .bind(row.user_id, row.instrument_id),
      );
    } else {
      stmts.push(
        db
          .prepare(
            "UPDATE paper_positions SET quantity = ?, updated_at = ? WHERE user_id = ? AND instrument_id = ?",
          )
          .bind(newQty, nowIso(), row.user_id, row.instrument_id),
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
        row.user_id,
        row.id,
        row.instrument_id,
        row.side,
        lotsQty,
        fillPrice,
        feesCents,
        tradeDate,
        nowIso(),
      ),
  );

  const results = await db.batch(stmts);
  const orderUpdate = results[0];
  if (!orderUpdate.success || (orderUpdate.meta?.changes ?? 0) === 0) {
    await releasePaperFillLock(db, row.id, false, { reason: "not_pending" });
    return { ok: true, orderId: row.id, status: "pending" };
  }
  if (row.side === "buy") {
    const cashUpdate = results[1];
    if (!cashUpdate.success || (cashUpdate.meta?.changes ?? 0) === 0) {
      await releasePaperFillLock(db, row.id, false, { reason: "insufficient_funds" });
      return { ok: false, code: "INSUFFICIENT_FUNDS", message: "模拟资金不足或并发冲突" };
    }
  }
  await releasePaperFillLock(db, row.id, true, { tradeId, fillDate: tradeDate });
  return { ok: true, orderId: row.id, status: "filled" };
}
