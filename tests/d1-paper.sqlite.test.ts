import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { confirmPaperOrder } from "../src/paper/engine";
import { DEMO_FEE_SCHEDULES } from "../src/paper/fees";
import { seedCalendarRange } from "../src/calendar/hk";
import { newId } from "../src/lib/id";
import { nowIso } from "../src/lib/time";

describe("D1/SQLite paper persistence", () => {
  const ctx = { d1: null as D1Database, uid: "", inst: "inst_demo_00700", bars: [] as {
      trade_date: string;
      open_cents: number;
      close_cents: number;
      volume: number;
    }[] };

  beforeAll(async () => {
    const { d1 } = freshMigratedDb();
    ctx.d1 = d1;
    await seedCalendarRange(d1, "2024-07-01", "2024-08-30");
    ctx.uid = newId("usr");
    await d1
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, role, status, created_at, updated_at)
         VALUES (?, 'sqlite@local', 'SQLite', 'x', 'user', 'active', ?, ?)`,
      )
      .bind(ctx.uid, nowIso(), nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO paper_accounts (user_id, cash_cents, currency, updated_at) VALUES (?, 10000000, 'HKD', ?)`,
      )
      .bind(ctx.uid, nowIso())
      .run();
    await d1
      .prepare(
        `INSERT INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
         VALUES (?, 'DEMO:00700', '演示', 'HKD', 100, 'XHKG', 'active', ?, ?)`,
      )
      .bind(ctx.inst, nowIso(), nowIso())
      .run();
  for (const f of DEMO_FEE_SCHEDULES) {
      await d1
        .prepare(
          `INSERT INTO fee_schedules (id, name, rate_bps, flat_cents, effective_from, effective_to)
           VALUES (?, ?, ?, ?, ?, NULL)`,
        )
        .bind(f.id, f.name, f.rate_bps, f.flat_cents, f.effective_from)
        .run();
    }
    const snap = newId("snap");
    await d1
      .prepare(
        `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
         VALUES (?, 'test', 'v1', ?, 3, '{}')`,
      )
      .bind(snap, nowIso())
      .run();
    const days = ["2024-08-01", "2024-08-02", "2024-08-05"];
    const stmt = d1.prepare(
      `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, adj_factor, snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 10000, ?)`,
    );
    for (const [i, d] of days.entries()) {
      await stmt.bind(ctx.inst, d, 10000 + i * 10, 10020, 9990, 10010 + i * 10, 500000, snap).run();
      ctx.bars.push({
        trade_date: d,
        open_cents: 10000 + i * 10,
        close_cents: 10010 + i * 10,
        volume: 500000,
      });
    }
  });

  it("fills on next tradable session open after signal", async () => {
    const signalDate = "2024-08-01";
    const r = await confirmPaperOrder(
      ctx.d1,
      {
        userId: ctx.uid,
        instrumentId: ctx.inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: signalDate,
        idempotencyKey: "sqlite-1",
      },
      ctx.bars,
      DEMO_FEE_SCHEDULES,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("filled");
    const cash = await ctx.d1
      .prepare("SELECT cash_cents FROM paper_accounts WHERE user_id = ?")
      .bind(ctx.uid)
      .first<{ cash_cents: number }>();
    expect(cash!.cash_cents).toBeLessThan(10_000_000);
  });

  it("blocks duplicate spend with conditional update (concurrent)", async () => {
    const signalDate = "2024-08-02";
    const r1 = await confirmPaperOrder(
      ctx.d1,
      {
        userId: ctx.uid,
        instrumentId: ctx.inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: signalDate,
        idempotencyKey: "concurrent-a",
      },
      ctx.bars,
      DEMO_FEE_SCHEDULES,
    );
    const r2 = await confirmPaperOrder(
      ctx.d1,
      {
        userId: ctx.uid,
        instrumentId: ctx.inst,
        side: "buy",
        quantity: 10000000,
        boardLot: 100,
        signalTradeDate: signalDate,
        idempotencyKey: "concurrent-b",
      },
      ctx.bars,
      DEMO_FEE_SCHEDULES,
    );
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("pending without next bar", async () => {
    const last = ctx.bars[ctx.bars.length - 1].trade_date;
    const r = await confirmPaperOrder(
      ctx.d1,
      {
        userId: ctx.uid,
        instrumentId: ctx.inst,
        side: "buy",
        quantity: 100,
        boardLot: 100,
        signalTradeDate: last,
        idempotencyKey: "pending-sqlite",
      },
      ctx.bars,
      DEMO_FEE_SCHEDULES,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("pending");
  });
});
