import type { Env } from "../env";
import { providerReady, isCronEnabled, isDemoProvider } from "../env";
import { getProvider } from "../providers/registry";
import { getSessionType, assertCalendarCoverage } from "../calendar/hk";
import { evaluateMaCrossover, DEFAULT_MA_CONFIG } from "../strategy/ma-crossover";
import { newId } from "../lib/id";
import { nowIso, formatHkDate } from "../lib/time";
import { DemoMarketDataProvider } from "../providers/demo";

const STRATEGY_SLUG = "ma_crossover_v1";

export interface EodResult {
  status: "skipped" | "failed" | "completed";
  tradeDate: string;
  message: string;
  signalsCreated?: number;
}

export async function runEodPipeline(env: Env, tradeDate?: string): Promise<EodResult> {
  const date = tradeDate ?? formatHkDate();
  const idempotencyKey = `HK|${date}|${STRATEGY_SLUG}|1`;

  const existing = await env.DB.prepare(
    "SELECT status FROM job_runs WHERE idempotency_key = ?",
  )
    .bind(idempotencyKey)
    .first<{ status: string }>();
  if (existing?.status === "completed") {
    return { status: "skipped", tradeDate: date, message: "本日批次已完成（幂等）" };
  }

  const { session, source } = await getSessionType(env.DB, date);
  const calCheck = assertCalendarCoverage(date, source);
  if (!calCheck.ok) {
    await recordJob(env.DB, idempotencyKey, date, "failed", { reason: calCheck.reason });
    return { status: "failed", tradeDate: date, message: calCheck.reason! };
  }
  if (session === "closed") {
    await recordJob(env.DB, idempotencyKey, date, "skipped", { reason: "休市" });
    return { status: "skipped", tradeDate: date, message: "休市日跳过" };
  }

  const ready = providerReady(env);
  if (!ready.ready) {
    await recordJob(env.DB, idempotencyKey, date, "failed", { reason: ready.reason });
    return { status: "failed", tradeDate: date, message: ready.reason! };
  }

  const provider = getProvider(env);
  if (!provider) {
    await recordJob(env.DB, idempotencyKey, date, "failed", { reason: "provider_null" });
    return { status: "failed", tradeDate: date, message: "行情供应商未配置" };
  }

  const eodReady = await provider.isEodReady(date);
  if (!eodReady) {
    await recordJob(env.DB, idempotencyKey, date, "failed", { reason: "eod_not_ready" });
    return { status: "failed", tradeDate: date, message: "供应商当日数据未就绪" };
  }

  await recordJob(env.DB, idempotencyKey, date, "running", { started: true });

  if (isDemoProvider(env)) {
    await seedDemoMarketData(env.DB);
  }

  const strategyId = await ensureStrategy(env.DB);
  const instruments = await env.DB.prepare(
    "SELECT id, status, symbol FROM instruments WHERE status = 'active'",
  ).all<{ id: string; status: string; symbol: string }>();

  let signalsCreated = 0;
  for (const inst of instruments.results ?? []) {
    const bars = await env.DB.prepare(
      `SELECT trade_date, open_cents, high_cents, low_cents, close_cents, volume, turnover_cents, adj_factor, instrument_id
       FROM bars_daily WHERE instrument_id = ? ORDER BY trade_date`,
    )
      .bind(inst.id)
      .all();
    const barList = (bars.results ?? []) as {
      trade_date: string;
      close_cents: number;
      volume: number;
      instrument_id: string;
      open_cents: number;
      high_cents: number;
      low_cents: number;
      turnover_cents: number | null;
      adj_factor: number;
    }[];

    const hasToday = barList.some((b) => b.trade_date === date);
    if (!hasToday) continue;

    const sig = evaluateMaCrossover(
      barList.map((b) => ({
        instrument_id: b.instrument_id,
        trade_date: b.trade_date,
        open_cents: b.open_cents,
        high_cents: b.high_cents,
        low_cents: b.low_cents,
        close_cents: b.close_cents,
        volume: b.volume,
        turnover_cents: b.turnover_cents ?? undefined,
        adj_factor: b.adj_factor,
      })),
      date,
      DEFAULT_MA_CONFIG,
    );
    if (!sig) continue;

    const signalId = newId("sig");
    try {
      await env.DB.prepare(
        `INSERT INTO signals (id, instrument_id, strategy_id, strategy_version, trade_date, direction, reasons_json, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      )
        .bind(
          signalId,
          inst.id,
          strategyId,
          date,
          sig.direction,
          JSON.stringify(sig.reasons),
          nowIso(),
        )
        .run();
      signalsCreated++;

      const users = await env.DB.prepare(
        "SELECT id FROM users WHERE status = 'active'",
      ).all<{ id: string }>();
      for (const u of users.results ?? []) {
        const dedupe = `${u.id}|${inst.id}|${STRATEGY_SLUG}|1|${date}|${sig.direction}`;
        await env.DB.prepare(
          `INSERT OR IGNORE INTO notifications (id, user_id, dedupe_key, title, body, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            newId("ntf"),
            u.id,
            dedupe,
            `${inst.symbol} · 信号 ${sig.direction} · ${date}`,
            sig.reasons.join("；"),
            nowIso(),
          )
          .run();
      }
    } catch {
      /* unique constraint — 幂等 */
    }
  }

  await recordJob(env.DB, idempotencyKey, date, "completed", { signalsCreated });
  return { status: "completed", tradeDate: date, message: "EOD 完成", signalsCreated };
}

async function recordJob(
  db: D1Database,
  idempotencyKey: string,
  tradeDate: string,
  status: string,
  detail: Record<string, unknown>,
) {
  const existing = await db
    .prepare("SELECT id FROM job_runs WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first<{ id: string }>();
  if (existing) {
    await db
      .prepare(
        "UPDATE job_runs SET status = ?, finished_at = ?, detail_json = ? WHERE idempotency_key = ?",
      )
      .bind(status, nowIso(), JSON.stringify(detail), idempotencyKey)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO job_runs (id, job_type, market, trade_date, strategy_slug, strategy_version, status, started_at, finished_at, detail_json, idempotency_key)
       VALUES (?, 'eod', 'HK', ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("job"),
      tradeDate,
      STRATEGY_SLUG,
      status,
      nowIso(),
      status !== "running" ? nowIso() : null,
      JSON.stringify(detail),
      idempotencyKey,
    )
    .run();
}

async function ensureStrategy(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT id FROM strategies WHERE slug = ? AND version = 1")
    .bind(STRATEGY_SLUG)
    .first<{ id: string }>();
  if (row) return row.id;
  const id = newId("str");
  await db
    .prepare(
      `INSERT INTO strategies (id, slug, name_zh, version, config_json, is_active, created_at)
       VALUES (?, ?, '均线交叉演示策略', 1, ?, 1, ?)`,
    )
    .bind(id, STRATEGY_SLUG, JSON.stringify(DEFAULT_MA_CONFIG), nowIso())
    .run();
  return id;
}

export async function seedDemoMarketData(db: D1Database): Promise<void> {
  const demo = new DemoMarketDataProvider();
  const snapId = newId("snap");
  await db
    .prepare(
      `INSERT OR IGNORE INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
       VALUES (?, 'demo', 'v1', ?, ?, ?)`,
    )
    .bind(snapId, nowIso(), demo.exportBarsForSeed().length, JSON.stringify({ demo: true }))
    .run();

  for (const inst of demo.exportInstruments()) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO instruments (id, symbol, name_zh, name_en, currency, board_lot, exchange, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        inst.id,
        inst.symbol,
        inst.name_zh,
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

  const bars = demo.exportBarsForSeed();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO bars_daily
    (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, turnover_cents, adj_factor, snapshot_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const batch = bars.map((b) =>
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
      snapId,
    ),
  );
  if (batch.length) await db.batch(batch);
}

export async function scheduledEod(env: Env): Promise<void> {
  if (!isCronEnabled(env)) return;
  await runEodPipeline(env);
}
