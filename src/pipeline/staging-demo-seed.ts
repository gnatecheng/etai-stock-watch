import type { Env } from "../env";
import { seedAcceptanceScenario } from "./acceptance-seed";
import { ensureDemoSimulationState, DEFAULT_SIM_START } from "../demo/simulation";
import { newId } from "../lib/id";
import { nowIso } from "../lib/time";
import { ACCEPTANCE_INSTRUMENT_ID } from "../providers/demo-scenario";
import { DEMO_FEE_SCHEDULES } from "../paper/fees";

const STAGING_SCENARIO_LABEL =
  "STAGING DEMO 合成行情·非真实港股 — 模拟交易日推进，非 Cron 日更";

/**
 * 幂等：重复执行不重复插入已发布财务版本（按 instrument+period_end 去重检查）
 */
export async function seedStagingDemoFixture(env: Env): Promise<{
  scenario: Awaited<ReturnType<typeof seedAcceptanceScenario>>;
  financialRows: number;
  simulationStart: string;
}> {
  for (const f of DEMO_FEE_SCHEDULES) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO fee_schedules (id, name, rate_bps, flat_cents, effective_from, effective_to)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
      .bind(f.id, f.name, f.rate_bps, f.flat_cents, f.effective_from)
      .run();
  }

  await ensureDemoSimulationState(env.DB, DEFAULT_SIM_START, STAGING_SCENARIO_LABEL);

  const scenario = await seedAcceptanceScenario(env);

  const existing = await env.DB.prepare(
    `SELECT id FROM fin_report_versions WHERE instrument_id = ? AND period_end = '2023-12-31' LIMIT 1`,
  )
    .bind(ACCEPTANCE_INSTRUMENT_ID)
    .first();

  let financialRows = 0;
  if (!existing) {
    const finId = newId("fin");
    const batchId = newId("ibat");
    const ts = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO import_batches (id, batch_type, source, status, idempotency_key, created_at, updated_at, published_at)
         VALUES (?, 'financial', 'staging-demo-fixture', 'published', 'staging-demo-fin-fixture-v1', ?, ?, ?)`,
      ).bind(batchId, ts, ts, ts),
      env.DB.prepare(
        `INSERT INTO fin_report_versions (id, instrument_id, report_family, statement_type, period_end, period_type, accounting_standard, currency, unit_label, source, collected_at, announced_at, revision, import_batch_id, published_at, metrics_json)
         VALUES (?, ?, 'akshare_hk_analysis_indicator_em', NULL, '2023-12-31', 'annual', 'HKFRS', 'HKD', '百万港元', 'staging-demo-fixture', ?, '2024-03-01', 1, ?, ?, ?)`,
      ).bind(
        finId,
        ACCEPTANCE_INSTRUMENT_ID,
        ts,
        batchId,
        ts,
        JSON.stringify({
          operating_revenue: 5200,
          net_profit_attr_parent: 880,
          basic_eps: 3.2,
          roe: 14,
          gross_margin: 38,
        }),
      ),
    ]);
    financialRows = 1;
  }

  return {
    scenario,
    financialRows,
    simulationStart: DEFAULT_SIM_START,
  };
}
