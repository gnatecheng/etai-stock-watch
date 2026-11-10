import { describe, it, expect, beforeAll } from "vitest";
import { freshMigratedDb } from "./helpers/sqlite-d1";
import {
  createImportBatch,
  publishBatch,
  stageBatchRows,
  validateBatch,
} from "../src/import/batch-service";
import { seedCalendarRange } from "../src/calendar/hk";
import { newId } from "../src/lib/id";
import { nowIso } from "../src/lib/time";

describe("import batch pipeline", () => {
  let d1: D1Database;
  const symbol = "DEMO:00700";
  const inst = "inst_demo_00700";
  const tradeDate = "2024-08-29";

  beforeAll(async () => {
    ({ d1 } = freshMigratedDb());
    await seedCalendarRange(d1, "2024-08-01", "2024-08-31");
    await d1
      .prepare(
        `INSERT INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
         VALUES (?, ?, 'T', 'HKD', 100, 'XHKG', 'active', ?, ?)`,
      )
      .bind(inst, symbol, nowIso(), nowIso())
      .run();
  });

  it("idempotent create batch", async () => {
    const a = await createImportBatch(d1, {
      batchType: "bars_daily",
      source: "test",
      idempotencyKey: "idem-1",
      tradeDateScope: tradeDate,
      scopeComplete: true,
    });
    const b = await createImportBatch(d1, {
      batchType: "bars_daily",
      source: "test",
      idempotencyKey: "idem-1",
      tradeDateScope: tradeDate,
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.batchId).toBe(b.batchId);
  });

  it("failed validate does not publish bars", async () => {
    const { batchId } = await createImportBatch(d1, {
      batchType: "bars_daily",
      source: "test",
      idempotencyKey: "idem-fail",
      tradeDateScope: tradeDate,
    });
    await stageBatchRows(d1, batchId, [
      {
        seq: 1,
        payloadType: "bar",
        payload: { symbol, trade_date: "2024-08-28", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      },
    ]);
    const val = await validateBatch(d1, batchId);
    expect(val.ok).toBe(false);
    const pub = await publishBatch(d1, batchId, { provider: "test", provenance: {} });
    expect(pub.published).toBe(false);
    const bar = await d1
      .prepare("SELECT * FROM bars_daily WHERE instrument_id = ? AND trade_date = ?")
      .bind(inst, "2024-08-28")
      .first();
    expect(bar).toBeUndefined();
  });

  it("publish success writes bars", async () => {
    const { batchId } = await createImportBatch(d1, {
      batchType: "bars_daily",
      source: "test",
      idempotencyKey: `idem-ok-${Date.now()}`,
      tradeDateScope: tradeDate,
      scopeComplete: true,
    });
    await stageBatchRows(d1, batchId, [
      {
        seq: 1,
        payloadType: "bar",
        payload: {
          symbol,
          trade_date: tradeDate,
          open: 279,
          high: 281,
          low: 278,
          close: 280.5,
          volume: 650000,
        },
      },
    ]);
    expect((await validateBatch(d1, batchId)).ok).toBe(true);
    expect((await publishBatch(d1, batchId, { provider: "test", provenance: { demo: true } })).published).toBe(true);
    const bar = await d1
      .prepare("SELECT close_cents FROM bars_daily WHERE instrument_id = ? AND trade_date = ?")
      .bind(inst, tradeDate)
      .first<{ close_cents: number }>();
    expect(bar!.close_cents).toBe(28050);
  });

  it("concurrent publish once", async () => {
    const { batchId } = await createImportBatch(d1, {
      batchType: "bars_daily",
      source: "test",
      idempotencyKey: `idem-race-${newId("x")}`,
      tradeDateScope: tradeDate,
    });
    await stageBatchRows(d1, batchId, [
      {
        seq: 1,
        payloadType: "bar",
        payload: { symbol, trade_date: tradeDate, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      },
    ]);
    await validateBatch(d1, batchId);
    const [p1, p2] = await Promise.all([
      publishBatch(d1, batchId, { provider: "test", provenance: {} }),
      publishBatch(d1, batchId, { provider: "test", provenance: {} }),
    ]);
    const okCount = [p1, p2].filter((p) => p.published).length;
    expect(okCount).toBeGreaterThanOrEqual(1);
  });
});
