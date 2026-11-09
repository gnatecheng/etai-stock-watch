import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { confirmPaperOrder } from "../src/paper/engine";
import { processPendingPaperOrdersOnEod } from "../src/paper/pending-eod";
import { DEMO_FEE_SCHEDULES } from "../src/paper/fees";
import { seedCalendarRange } from "../src/calendar/hk";
import { newId } from "../src/lib/id";
import { nowIso } from "../src/lib/time";
import {
  acceptanceBarsThroughSellSignal,
  ACCEPTANCE_SIGNAL_DATE,
  ACCEPTANCE_NEXT_SESSION,
  ACCEPTANCE_SELL_SIGNAL_DATE,
  ACCEPTANCE_SELL_NEXT_SESSION,
  ACCEPTANCE_INSTRUMENT_ID,
  acceptanceSellNextSessionBar,
} from "../src/providers/demo-scenario";

describe("sell loop via EOD", () => {
  let d1: D1Database;
  let uid: string;
  let snap: string;
  const inst = ACCEPTANCE_INSTRUMENT_ID;
  const bars = acceptanceBarsThroughSellSignal().map((b) => ({
    trade_date: b.trade_date,
    open_cents: b.open_cents,
    close_cents: b.close_cents,
    volume: b.volume,
  }));

  beforeAll(async () => {
    ({ d1 } = freshMigratedDb());
    await seedCalendarRange(d1, "2024-07-01", "2024-09-15");
    uid = newId("usr");
    await d1
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, 'sell@l', 'S', 'x', 'user', 'active', ?, ?)`,
      )
      .bind(uid, nowIso(), nowIso())
      .run();
    await d1
      .prepare(`INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, 1e7, 'HKD', ?)`)
      .bind(uid, nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
         VALUES (?, 'DEMO:00700', 'T', 'HKD', 100, 'XHKG', 'active', ?, ?)`,
      )
      .bind(inst, nowIso(), nowIso())
      .run();
    for (const f of DEMO_FEE_SCHEDULES) {
      await d1
        .prepare(
          `INSERT INTO fee_schedules (id, name, rate_bps, flat_cents, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, NULL)`,
        )
        .bind(f.id, f.name, f.rate_bps, f.flat_cents, f.effective_from)
        .run();
    }
    snap = newId("snap");
    await d1
      .prepare(`INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json) VALUES (?, 'demo-scenario', '1', ?, ?, '{}')`)
      .bind(snap, nowIso(), bars.length)
      .run();
    const stmt = d1.prepare(
      `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, adj_factor, snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 10000, ?)`,
    );
    for (const b of acceptanceBarsThroughSellSignal()) {
      await stmt
        .bind(inst, b.trade_date, b.open_cents, b.high_cents, b.low_cents, b.close_cents, b.volume, snap)
        .run();
    }
  });

  it("buy then sell: cash and position move correctly", async () => {
    const cash0 = (await d1.prepare("SELECT cash_cents FROM paper_accounts WHERE user_id = ?").bind(uid).first<{ cash_cents: number }>())!
      .cash_cents;

    await confirmPaperOrder(
      d1,
      {
        userId: uid,
        instrumentId: inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: ACCEPTANCE_SIGNAL_DATE,
        idempotencyKey: "buy-sell-1",
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    await processPendingPaperOrdersOnEod(d1, ACCEPTANCE_NEXT_SESSION, DEMO_FEE_SCHEDULES);
    const cash1 = (await d1.prepare("SELECT cash_cents FROM paper_accounts WHERE user_id = ?").bind(uid).first<{ cash_cents: number }>())!
      .cash_cents;
    expect(cash1).toBeLessThan(cash0);
    const pos1 = await d1
      .prepare("SELECT quantity FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
      .bind(uid, inst)
      .first<{ quantity: number }>();
    expect(pos1!.quantity).toBe(100);

    await confirmPaperOrder(
      d1,
      {
        userId: uid,
        instrumentId: inst,
        side: "sell",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: ACCEPTANCE_SELL_SIGNAL_DATE,
        idempotencyKey: "buy-sell-sell",
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    const sellBar = acceptanceSellNextSessionBar();
    await d1
      .prepare(
        `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, adj_factor, snapshot_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 10000, ?)`,
      )
      .bind(
        inst,
        sellBar!.trade_date,
        sellBar!.open_cents,
        sellBar!.high_cents,
        sellBar!.low_cents,
        sellBar!.close_cents,
        sellBar!.volume,
        snap,
      )
      .run();

    await processPendingPaperOrdersOnEod(d1, ACCEPTANCE_SELL_NEXT_SESSION, DEMO_FEE_SCHEDULES);
    const cash2 = (await d1.prepare("SELECT cash_cents FROM paper_accounts WHERE user_id = ?").bind(uid).first<{ cash_cents: number }>())!
      .cash_cents;
    expect(cash2).toBeGreaterThan(cash1);
    const pos2 = await d1
      .prepare("SELECT quantity FROM paper_positions WHERE user_id = ? AND instrument_id = ?")
      .bind(uid, inst)
      .first<{ quantity: number }>();
    expect(pos2?.quantity ?? 0).toBe(0);

    const sellTrade = await d1
      .prepare("SELECT side, trade_date, price_cents FROM paper_trades WHERE user_id = ? AND side = 'sell'")
      .bind(uid)
      .first<{ side: string; trade_date: string; price_cents: number }>();
    expect(sellTrade!.trade_date).toBe(ACCEPTANCE_SELL_NEXT_SESSION);
    expect(sellTrade!.trade_date > ACCEPTANCE_SELL_SIGNAL_DATE).toBe(true);
  });
});
