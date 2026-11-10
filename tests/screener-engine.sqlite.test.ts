import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { runScreener } from "../src/screener/engine";
import { newId } from "../src/lib/id";
import { nowIso } from "../src/lib/time";
import type { Env } from "../src/env";

const demoEnv = {
  APP_ENV: "development",
  DATA_PROVIDER: "demo",
  DEMO_WATERMARK: "合成DEMO",
  EOD_CRON_ENABLED: "false",
  SESSION_COOKIE_NAME: "esw_session",
  HK_TIMEZONE: "Asia/Hong_Kong",
} as unknown as Env;

describe("screener engine", () => {
  let d1: D1Database;

  beforeAll(async () => {
    ({ d1 } = freshMigratedDb());
    const inst = "inst_s1";
    await d1
      .prepare(
        `INSERT INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
         VALUES (?, 'DEMO:T', '测试', 'HKD', 100, 'XHKG', 'active', ?, ?)`,
      )
      .bind(inst, nowIso(), nowIso())
      .run();
    const snap = newId("snap");
    await d1
      .prepare(
        `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
         VALUES (?, 'demo', '1', ?, 3, ?)`,
      )
      .bind(snap, nowIso(), JSON.stringify({ demo: true }))
      .run();
    const days = [
      { d: "2024-08-01", c: 10000 },
      { d: "2024-08-02", c: 10200 },
      { d: "2024-08-05", c: 10500 },
    ];
    for (const row of days) {
      await d1
        .prepare(
          `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, turnover_cents, adj_factor, snapshot_id)
           VALUES (?, ?, ?, ?, ?, ?, 500000, NULL, 10000, ?)`,
        )
        .bind(inst, row.d, row.c, row.c + 50, row.c - 50, row.c, snap)
        .run();
    }
  });

  it("AND: price + change hit on latest date", async () => {
    const result = await runScreener(demoEnv, d1, {
      asOfDate: "2024-08-05",
      conditions: [
        { type: "price_close", minHkd: 100, maxHkd: 110 },
        { type: "change_pct", minPct: 0, maxPct: 10 },
      ],
    });
    expect(result.hits.length).toBe(1);
    expect(result.hits[0]!.conditionResults.every((c) => c.status === "pass")).toBe(true);
  });

  it("excludes change when no prior close", async () => {
    const result = await runScreener(demoEnv, d1, {
      asOfDate: "2024-08-01",
      conditions: [{ type: "change_pct", minPct: -5, maxPct: 5 }],
    });
    expect(result.hits.length).toBe(0);
  });

  it("excludes ma when history insufficient", async () => {
    const result = await runScreener(demoEnv, d1, {
      asOfDate: "2024-08-02",
      conditions: [{ type: "ma_relation", period: 20, relation: "above" }],
    });
    expect(result.hits.length).toBe(0);
  });

  it("turnover condition marks excluded in demo (engine level)", async () => {
    const vendorEnv = {
      ...demoEnv,
      DATA_PROVIDER: "vendor",
      MARKET_DATA_API_KEY: "x",
    } as unknown as Env;
    const snap2 = newId("snap2");
    await d1
      .prepare(
        `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
         VALUES (?, 'vendor', '1', ?, 1, ?)`,
      )
      .bind(snap2, nowIso(), JSON.stringify({ turnover_trustworthy: true, turnover_source: "vendor_reported" }))
      .run();
    await d1
      .prepare(
        `UPDATE bars_daily SET snapshot_id = ?, turnover_cents = 500000000 WHERE trade_date = '2024-08-05'`,
      )
      .bind(snap2)
      .run();
    const result = await runScreener(vendorEnv, d1, {
      asOfDate: "2024-08-05",
      conditions: [{ type: "turnover", minHkd: 1000 }],
    });
    expect(result.hits.length).toBe(1);
  });
});
