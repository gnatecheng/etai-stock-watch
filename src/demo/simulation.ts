import type { Env } from "../env";
import { isStagingDemo } from "../env";
import { nowIso } from "../lib/time";
import { ACCEPTANCE_SIGNAL_DATE } from "../providers/demo-scenario";

const STATE_ID = "default";

export async function getDemoSimulationState(db: D1Database): Promise<{
  currentTradeDate: string;
  scenarioLabel: string;
} | null> {
  const row = await db
    .prepare(
      `SELECT current_trade_date, scenario_label FROM demo_simulation_state WHERE id = ?`,
    )
    .bind(STATE_ID)
    .first<{ current_trade_date: string; scenario_label: string }>();
  if (!row) return null;
  return { currentTradeDate: row.current_trade_date, scenarioLabel: row.scenario_label };
}

export async function ensureDemoSimulationState(
  db: D1Database,
  initialDate: string,
  label: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO demo_simulation_state (id, current_trade_date, scenario_label, updated_at, updated_by_user_id)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .bind(STATE_ID, initialDate, label, nowIso())
    .run();
}

export async function resolveEodTradeDate(env: Env, db: D1Database, explicit?: string): Promise<string> {
  if (explicit?.match(/^\d{4}-\d{2}-\d{2}$/)) return explicit;
  if (isStagingDemo(env)) {
    const sim = await getDemoSimulationState(db);
    if (sim) return sim.currentTradeDate;
  }
  const { formatHkDate } = await import("../lib/time");
  return formatHkDate();
}

export async function advanceDemoTradingDay(
  env: Env,
  db: D1Database,
  userId: string,
): Promise<{ ok: true; from: string; to: string } | { ok: false; message: string }> {
  if (!isStagingDemo(env)) {
    return { ok: false, message: "仅 STAGING DEMO 可推进模拟交易日" };
  }
  const sim = await getDemoSimulationState(db);
  if (!sim) {
    return { ok: false, message: "模拟状态未初始化，请先执行 staging demo seed" };
  }
  const next = await db
    .prepare(
      `SELECT trade_date FROM calendar_hk
       WHERE trade_date > ? AND session_type != 'closed'
       ORDER BY trade_date ASC LIMIT 1`,
    )
    .bind(sim.currentTradeDate)
    .first<{ trade_date: string }>();
  if (!next) {
    return { ok: false, message: "已无后续交易日（合成日历尽头）" };
  }
  const ts = nowIso();
  const r = await db
    .prepare(
      `UPDATE demo_simulation_state SET current_trade_date = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?`,
    )
    .bind(next.trade_date, ts, userId, STATE_ID)
    .run();
  if ((r.meta?.changes ?? 0) !== 1) {
    return { ok: false, message: "更新模拟日失败" };
  }
  return { ok: true, from: sim.currentTradeDate, to: next.trade_date };
}

export const DEFAULT_SIM_START = ACCEPTANCE_SIGNAL_DATE;
