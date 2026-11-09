import { DemoMarketDataProvider } from "../providers/demo";
import {
  acceptanceBarsThroughSignal,
  ACCEPTANCE_INSTRUMENT_ID,
  ACCEPTANCE_SCENARIO_LABEL,
  ACCEPTANCE_SIGNAL_DATE,
} from "../providers/demo-scenario";
import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import { seedBuiltinCalendar, seedCalendarRange } from "../calendar/hk";
import { runEodPipeline } from "./eod";
import type { Env } from "../env";

/** 开发/验收：可重复买入信号 + 信号日为止的 K 线（下一 session 需单独导入） */
export async function seedAcceptanceScenario(env: Env): Promise<{
  signalDate: string;
  label: string;
  eod: Awaited<ReturnType<typeof runEodPipeline>>;
}> {
  await seedBuiltinCalendar(env.DB);
  await seedCalendarRange(env.DB, "2024-07-01", "2024-09-15");

  const demo = new DemoMarketDataProvider();
  const snapAccept = newId("snap");
  await env.DB.prepare(
    `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
     VALUES (?, 'demo-scenario', 'acceptance-v1', ?, ?, ?)`,
  )
    .bind(
      snapAccept,
      nowIso(),
      acceptanceBarsThroughSignal().length,
      JSON.stringify({ label: ACCEPTANCE_SCENARIO_LABEL, scenario: "acceptance" }),
    )
    .run();

  for (const inst of demo.exportInstruments()) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO instruments (id, symbol, name_zh, name_en, currency, board_lot, exchange, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        inst.id,
        inst.symbol,
        inst.id === ACCEPTANCE_INSTRUMENT_ID ? "演示科技·验收" : inst.name_zh,
        inst.name_en ?? null,
        inst.currency,
        inst.board_lot,
        inst.exchange,
        inst.status,
        nowIso(),
        nowIso(),
      )
      .run();
  }

  await env.DB.prepare("DELETE FROM bars_daily WHERE instrument_id = ?")
    .bind(ACCEPTANCE_INSTRUMENT_ID)
    .run();

  const acceptBars = acceptanceBarsThroughSignal();
  const stmt = env.DB.prepare(
    `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, turnover_cents, adj_factor, snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await env.DB.batch(
    acceptBars.map((b) =>
      stmt.bind(
        b.instrument_id,
        b.trade_date,
        b.open_cents,
        b.high_cents,
        b.low_cents,
        b.close_cents,
        b.volume,
        b.turnover_cents ?? null,
        b.adj_factor,
        snapAccept,
      ),
    ),
  );

  const snapOther = newId("snap");
  const otherBars = demo.exportBarsForSeed().filter((b) => b.instrument_id !== ACCEPTANCE_INSTRUMENT_ID);
  await env.DB.prepare(
    `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
     VALUES (?, 'demo', 'v1', ?, ?, ?)`,
  )
    .bind(snapOther, nowIso(), otherBars.length, JSON.stringify({ demo: true }))
    .run();
  const stmt2 = env.DB.prepare(
    `INSERT OR IGNORE INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, turnover_cents, adj_factor, snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  if (otherBars.length) {
    await env.DB.batch(
      otherBars.map((b) =>
        stmt2.bind(
          b.instrument_id,
          b.trade_date,
          b.open_cents,
          b.high_cents,
          b.low_cents,
          b.close_cents,
          b.volume,
          b.turnover_cents ?? null,
          b.adj_factor,
          snapOther,
        ),
      ),
    );
  }

  const eod = await runEodPipeline(env, ACCEPTANCE_SIGNAL_DATE);
  return { signalDate: ACCEPTANCE_SIGNAL_DATE, label: ACCEPTANCE_SCENARIO_LABEL, eod };
}
