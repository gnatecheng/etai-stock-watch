import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { confirmPaperOrder } from "../src/paper/engine";
import { processPendingPaperOrdersOnEod } from "../src/paper/pending-eod";
import { DEMO_FEE_SCHEDULES } from "../src/paper/fees";
import { seedCalendarRange } from "../src/calendar/hk";
import { newId } from "../src/lib/id";
import { nowIso } from "../src/lib/time";

describe("EOD pending concurrency and isolation", () => {
  let d1: D1Database;
  let uidA: string;
  let uidB: string;
  const inst = "inst_demo_00700";
  const signalDate = "2024-08-28";
  const fillDate = "2024-08-29";

  beforeAll(async () => {
    ({ d1 } = freshMigratedDb());
    await seedCalendarRange(d1, "2024-08-01", "2024-08-31");
    uidA = newId("usr");
    uidB = newId("usr2");
    for (const [uid, email] of [
      [uidA, "a@l"],
      [uidB, "b@l"],
    ] as const) {
      await d1
        .prepare(
          `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
           VALUES (?, ?, 'U', 'x', 'user', 'active', ?, ?)`,
        )
        .bind(uid, email, nowIso(), nowIso())
        .run();
      await d1
        .prepare(`INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, ?, 'HKD', ?)`)
        .bind(uid, 3_000_000, nowIso())
        .run();
    }
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
      .prepare(`INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json) VALUES (?, 't', '1', ?, 2, '{}')`)
      .bind(snap, nowIso())
      .run();
    for (const d of [signalDate, fillDate]) {
      await d1
        .prepare(
          `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, adj_factor, snapshot_id)
           VALUES (?, ?, 27900, 28100, 27800, 28050, 500000, 10000, ?)`,
        )
        .bind(inst, d, snap)
        .run();
    }
  });

  const bars = [
    { trade_date: signalDate, open_cents: 27900, close_cents: 28050, volume: 500000 },
    { trade_date: fillDate, open_cents: 27900, close_cents: 28050, volume: 500000 },
  ];

  it("same pending order: parallel EOD fills at most once", async () => {
    const key = "same-order";
    const c = await confirmPaperOrder(
      d1,
      {
        userId: uidA,
        instrumentId: inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: signalDate,
        idempotencyKey: key,
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    expect(c.ok && c.status).toBe("pending");
    const [r1, r2] = await Promise.all([
      processPendingPaperOrdersOnEod(d1, fillDate, DEMO_FEE_SCHEDULES),
      processPendingPaperOrdersOnEod(d1, fillDate, DEMO_FEE_SCHEDULES),
    ]);
    const filledTotal = r1.filled + r2.filled;
    expect(filledTotal).toBe(1);
    const n = await d1.prepare("SELECT COUNT(*) as n FROM paper_trades WHERE user_id = ?").bind(uidA).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("competing buys: second order rejected for insufficient funds on EOD", async () => {
    await d1.prepare("UPDATE paper_accounts SET cash_cents = 3_000_000 WHERE user_id = ?").bind(uidB).run();
    await confirmPaperOrder(
      d1,
      {
        userId: uidB,
        instrumentId: inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: signalDate,
        idempotencyKey: "race-a",
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    await confirmPaperOrder(
      d1,
      {
        userId: uidB,
        instrumentId: inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: signalDate,
        idempotencyKey: "race-b",
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    const r = await processPendingPaperOrdersOnEod(d1, fillDate, DEMO_FEE_SCHEDULES);
    expect(r.filled).toBe(1);
    expect(r.rejected.some((x) => x.code === "INSUFFICIENT_FUNDS")).toBe(true);
  });

  it("sell rejects insufficient shares", async () => {
    const uidC = newId("usrC");
    await d1
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, 'c@l', 'C', 'x', 'user', 'active', ?, ?)`,
      )
      .bind(uidC, nowIso(), nowIso())
      .run();
    await d1
      .prepare(`INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, 1e7, 'HKD', ?)`)
      .bind(uidC, nowIso())
      .run();
    await confirmPaperOrder(
      d1,
      {
        userId: uidC,
        instrumentId: inst,
        side: "sell",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: signalDate,
        idempotencyKey: "sell-no-pos",
      },
      bars,
      DEMO_FEE_SCHEDULES,
    );
    const r = await processPendingPaperOrdersOnEod(d1, fillDate, DEMO_FEE_SCHEDULES);
    expect(r.rejected.some((x) => x.code === "INSUFFICIENT_SHARES")).toBe(true);
  });
});
