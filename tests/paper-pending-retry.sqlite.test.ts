import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { confirmPaperOrder } from "../src/paper/engine";
import { processPendingPaperOrdersOnEod } from "../src/paper/pending-eod";
import { DEMO_FEE_SCHEDULES } from "../src/paper/fees";
import { seedCalendarRange } from "../src/calendar/hk";
import { newId } from "../src/lib/id";
import { nowIso } from "../src/lib/time";
import {
  ACCEPTANCE_INSTRUMENT_ID,
  ACCEPTANCE_SIGNAL_DATE,
  ACCEPTANCE_NEXT_SESSION,
} from "../src/providers/demo-scenario";

describe("pending filled by EOD when next session ready", () => {
  let d1: D1Database;
  let uid: string;
  const inst = ACCEPTANCE_INSTRUMENT_ID;
  let bars: { trade_date: string; open_cents: number; close_cents: number; volume: number }[] = [];

  beforeAll(async () => {
    ({ d1 } = freshMigratedDb());
    await seedCalendarRange(d1, "2024-08-01", "2024-08-31");
    uid = newId("usr");
    await d1
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, 'p@l', 'P', 'x', 'user', 'active', ?, ?)`,
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
    const snap = newId("snap");
    await d1
      .prepare(`INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json) VALUES (?, 't', '1', ?, 1, '{}')`)
      .bind(snap, nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, adj_factor, snapshot_id)
         VALUES (?, ?, 27600, 27800, 27500, 27700, 500000, 10000, ?)`,
      )
      .bind(inst, ACCEPTANCE_SIGNAL_DATE, snap)
      .run();
    bars = [{ trade_date: ACCEPTANCE_SIGNAL_DATE, open_cents: 27600, close_cents: 27700, volume: 500000 }];
  });

  it("confirm stays pending; API re-confirm does not fill; EOD fills once", async () => {
    const key = "retry-key";
    const p1 = await confirmPaperOrder(
      d1,
      {
        userId: uid,
        instrumentId: inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: ACCEPTANCE_SIGNAL_DATE,
        idempotencyKey: key,
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    expect(p1.ok && p1.status).toBe("pending");

    const snap2 = newId("snap2");
    await d1
      .prepare(`INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json) VALUES (?, 't', '1', ?, 1, '{}')`)
      .bind(snap2, nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, adj_factor, snapshot_id)
         VALUES (?, ?, 27900, 28100, 27800, 28050, 650000, 10000, ?)`,
      )
      .bind(inst, ACCEPTANCE_NEXT_SESSION, snap2)
      .run();
    bars.push({
      trade_date: ACCEPTANCE_NEXT_SESSION,
      open_cents: 27900,
      close_cents: 28050,
      volume: 650000,
    });

    const p2 = await confirmPaperOrder(
      d1,
      {
        userId: uid,
        instrumentId: inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: ACCEPTANCE_SIGNAL_DATE,
        idempotencyKey: key,
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    expect(p2.ok && p2.status).toBe("pending");

    const eod1 = await processPendingPaperOrdersOnEod(d1, ACCEPTANCE_NEXT_SESSION, DEMO_FEE_SCHEDULES);
    expect(eod1.filled).toBe(1);
    const eod2 = await processPendingPaperOrdersOnEod(d1, ACCEPTANCE_NEXT_SESSION, DEMO_FEE_SCHEDULES);
    expect(eod2.filled).toBe(0);

    if (p1.ok && p2.ok) expect(p1.orderId).toBe(p2.orderId);
    const trade = await d1
      .prepare("SELECT trade_date, price_cents FROM paper_trades WHERE order_id = ?")
      .bind(p2.ok ? p2.orderId : "")
      .first<{ trade_date: string; price_cents: number }>();
    expect(trade!.trade_date).toBe(ACCEPTANCE_NEXT_SESSION);
    expect(trade!.trade_date > ACCEPTANCE_SIGNAL_DATE).toBe(true);
    expect(trade!.price_cents).toBe(27900);

    const tradeCount = await d1
      .prepare("SELECT COUNT(*) as n FROM paper_trades WHERE order_id = ?")
      .bind(p2.ok ? p2.orderId : "")
      .first<{ n: number }>();
    expect(tradeCount!.n).toBe(1);
  });
});
