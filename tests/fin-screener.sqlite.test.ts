import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import { publishBatch, createImportBatch, stageBatchRows, validateBatch } from "../src/import/batch-service";
import { financialScreenerCapabilities } from "../src/screener/financial";
import { runFinancialScreener, validateFinScreenerRequest } from "../src/screener/financial-run";
import { financialScreeningAllowed } from "../src/env";
import type { Env } from "../src/env";
import { seedCalendarRange } from "../src/calendar/hk";
import { newId } from "../src/lib/id";
import { nowIso } from "../src/lib/time";

const demoEnv = {
  APP_ENV: "development",
  DATA_PROVIDER: "demo",
  DEMO_WATERMARK: "DEMO",
  EOD_CRON_ENABLED: "false",
  SESSION_COOKIE_NAME: "esw",
  HK_TIMEZONE: "Asia/Hong_Kong",
} as unknown as Env;

const prodEnv = {
  ...demoEnv,
  APP_ENV: "production",
  DATA_DISTRIBUTION_LICENSED: "false",
} as unknown as Env;

describe("financial screener local", () => {
  let d1: D1Database;
  const inst = "inst_demo_00700";
  const symbol = "DEMO:00700";

  beforeAll(async () => {
    ({ d1 } = freshMigratedDb());
    await seedCalendarRange(d1, "2024-01-01", "2024-12-31");
    await d1
      .prepare(
        `INSERT INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
         VALUES (?, ?, 'T', 'HKD', 100, 'XHKG', 'active', ?, ?)`,
      )
      .bind(inst, symbol, nowIso(), nowIso())
      .run();

    const { batchId } = await createImportBatch(d1, {
      batchType: "financial",
      source: "test",
      idempotencyKey: newId("fin"),
    });
    await stageBatchRows(d1, batchId, [
      {
        seq: 1,
        payloadType: "financial",
        payload: {
          symbol,
          report_family: "akshare_hk_analysis_indicator_em",
          period_end: "2023-12-31",
          period_type: "annual",
          currency: "HKD",
          unit_label: "百万港元",
          announced_at: "2024-03-01",
          metrics: { operating_revenue: 5000, net_profit_attr_parent: 100, basic_eps: 1, roe: 12, gross_margin: 35 },
        },
      },
    ]);
    await validateBatch(d1, batchId);
    await publishBatch(d1, batchId, { provider: "test", provenance: { synthetic: true } });
  });

  it("capabilities supported when fin data published", async () => {
    const caps = await financialScreenerCapabilities(demoEnv, d1);
    expect(caps.supported).toBe(true);
    expect(caps.publishedFinVersions).toBeGreaterThan(0);
  });

  it("excludes null announced_at for historical screen", async () => {
    const { batchId } = await createImportBatch(d1, {
      batchType: "financial",
      source: "test",
      idempotencyKey: newId("fin2"),
    });
    await d1
      .prepare(
        `INSERT INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
         VALUES ('inst_x', 'DEMO:X', 'X', 'HKD', 100, 'XHKG', 'active', ?, ?)`,
      )
      .bind(nowIso(), nowIso())
      .run();
    await stageBatchRows(d1, batchId, [
      {
        seq: 1,
        payloadType: "financial",
        payload: {
          symbol: "DEMO:X",
          report_family: "akshare_hk_analysis_indicator_em",
          period_end: "2023-12-31",
          period_type: "annual",
          currency: "HKD",
          unit_label: "百万港元",
          announced_at: null,
          metrics: { operating_revenue: 9000 },
        },
      },
    ]);
    await validateBatch(d1, batchId);
    await publishBatch(d1, batchId, { provider: "test", provenance: {} });
    const r = await runFinancialScreener(demoEnv, d1, {
      asOfDate: "2024-06-01",
      conditions: [{ metric: "operating_revenue", min: 100 }],
    });
    expect(r.hits.some((h) => h.symbol === "DEMO:X")).toBe(false);
  });

  it("hits when announced before asOf", async () => {
    const r = await runFinancialScreener(demoEnv, d1, {
      asOfDate: "2024-06-01",
      conditions: [{ metric: "operating_revenue", min: 1000 }],
    });
    expect(r.hits.some((h) => h.symbol === symbol)).toBe(true);
  });

  it("production without license blocked", () => {
    const v = validateFinScreenerRequest(
      { asOfDate: "2024-06-01", conditions: [{ metric: "operating_revenue", min: 1 }] },
      financialScreeningAllowed(prodEnv),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("FIN_SCREEN_BLOCKED");
  });

  it("rejects unmapped PE", () => {
    const v = validateFinScreenerRequest(
      { asOfDate: "2024-06-01", conditions: [{ metric: "pe_ttm", min: 1 }] },
      financialScreeningAllowed(demoEnv),
    );
    expect(v.ok).toBe(false);
  });
});
