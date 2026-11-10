/**
 * 全量 500 标的 × 情景交易日 落库实测（SQLite 文件，模拟 D1 schema）
 * 910 日 = 2021-01-04..2024-06-28 工作日计数，非港交所官方历
 */
import Database from "better-sqlite3";
import { createReadStream, statSync, readFileSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

const OUT = "/opt/cursor/artifacts";
const JSONL = resolve(OUT, "capacity-synthetic-bars.jsonl");
const DB_WORK = resolve("/workspace/.capacity-out", "capacity-500x3y.sqlite");
const DB_PATH = resolve(OUT, "capacity-500x3y.sqlite");

async function main() {
  await mkdir(OUT, { recursive: true });
  if (!statSync(JSONL, { throwIfNoent: true })) {
    throw new Error("先运行 node scripts/capacity-synthetic.mjs");
  }
  const jsonlBytes = statSync(JSONL).size;

  const db = new Database(DB_WORK);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  const migDir = resolve("migrations");
  for (const f of readdirSync(migDir).filter((x) => x.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(migDir, f), "utf8"));
  }

  const snap = "snap_capacity_full";
  db.prepare(
    `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
     VALUES (?, 'synthetic-capacity', 'full-load-v1', datetime('now'), 0, ?)`,
  ).run(snap, JSON.stringify({ synthetic_capacity: true, demo: true, label: "非真实行情" }));

  const insInst = db.prepare(
    `INSERT INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
     VALUES (?, ?, ?, 'HKD', 100, 'XHKG', 'active', datetime('now'), datetime('now'))`,
  );
  const insBar = db.prepare(
    `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, turnover_cents, adj_factor, snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 10000, ?)`,
  );
  const insFin = db.prepare(
    `INSERT INTO fin_report_versions (id, instrument_id, report_family, statement_type, period_end, period_type, accounting_standard, currency, unit_label, source, collected_at, announced_at, revision, import_batch_id, published_at, metrics_json)
     VALUES (?, ?, 'akshare_hk_analysis_indicator_em', NULL, '2023-12-31', 'annual', 'HKFRS', 'HKD', '百万港元', 'synthetic-capacity', datetime('now'), '2024-03-01', 1, ?, datetime('now'), ?)`,
  );
  const insBatch = db.prepare(
    `INSERT INTO import_batches (id, batch_type, source, status, idempotency_key, created_at, updated_at, published_at)
     VALUES (?, 'financial', 'synthetic-capacity', 'published', ?, datetime('now'), datetime('now'), datetime('now'))`,
  );

  const symToId = new Map();
  let barRows = 0;
  let lineNo = 0;
  const t0 = Date.now();

  const rl = createInterface({ input: createReadStream(JSONL), crlfDelay: Infinity });
  const tx = db.transaction(() => {
    /* filled in loop */
  });

  db.exec("BEGIN");
  for await (const line of rl) {
    if (!line.trim()) continue;
    lineNo++;
    const r = JSON.parse(line);
    if (!symToId.has(r.symbol)) {
      const idx = parseInt(r.symbol.replace(/\D/g, ""), 10) || symToId.size + 1;
      const id = `inst_cap_${String(idx).padStart(5, "0")}`;
      insInst.run(id, r.symbol, `合成容量${idx}`);
      symToId.set(r.symbol, id);
    }
    const iid = symToId.get(r.symbol);
    insBar.run(
      iid,
      r.trade_date,
      Math.round(r.open * 100),
      Math.round(r.high * 100),
      Math.round(r.low * 100),
      Math.round(r.close * 100),
      r.volume,
      snap,
    );
    barRows++;
    if (barRows % 50000 === 0) console.error(`bars ${barRows}...`);
  }
  db.exec("COMMIT");

  const finBatchId = "ibat_capacity_fin";
  insBatch.run(finBatchId, "capacity-fin-once");
  for (const [sym, iid] of symToId) {
    const finId = `fin_${iid}`;
    insFin.run(
      finId,
      iid,
      finBatchId,
      JSON.stringify({
        operating_revenue: 1000,
        net_profit_attr_parent: 100,
        basic_eps: 1.0,
        roe: 10,
        gross_margin: 30,
      }),
    );
  }

  const ms = Date.now() - t0;
  db.exec("ANALYZE");
  const pageSize = db.pragma("page_size", { simple: true });
  const pageCount = db.pragma("page_count", { simple: true });
  const { copyFileSync } = await import("node:fs");
  copyFileSync(DB_WORK, DB_PATH);
  const dbFileBytes = statSync(DB_PATH).size;

  const counts = {
    instruments: db.prepare("SELECT COUNT(*) as n FROM instruments").get().n,
    bars_daily: db.prepare("SELECT COUNT(*) as n FROM bars_daily").get().n,
    fin_report_versions: db.prepare("SELECT COUNT(*) as n FROM fin_report_versions").get().n,
    import_batches: db.prepare("SELECT COUNT(*) as n FROM import_batches").get().n,
    data_snapshots: db.prepare("SELECT COUNT(*) as n FROM data_snapshots").get().n,
  };

  const indexes = db
    .prepare(
      `SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND tbl_name IN ('bars_daily','fin_report_versions','instruments')`,
    )
    .all();

  db.close();

  const report = {
    label: "合成容量情景 — 非真实行情；非港交所官方交易日历",
    scenario: {
      symbolCount: 500,
      scenarioTradingDays: 910,
      scenarioDateRange: "2021-01-04 至 2024-06-28（工作日计数）",
      disclaimer: "910 为生成脚本工作日计数，不冒充真实三年港股交易日",
    },
    measured: {
      jsonlBytesActual: jsonlBytes,
      jsonlLinesRead: lineNo,
      sqliteFileBytes: dbFileBytes,
      sqlitePageSize: pageSize,
      sqlitePageCount: pageCount,
      sqliteSizeFromPages: pageSize * pageCount,
      loadDurationMs: ms,
      counts,
    },
    schemaCoverage: {
      tested: ["instruments", "bars_daily", "data_snapshots", "fin_report_versions", "import_batches", "idx_bars_daily_date"],
      notFullyStressTested: [
        "import_batch_rows staging 大批量",
        "远程 D1 多副本",
        "paper/signals 与 455k bars 联合 EOD",
      ],
    },
    indexesListed: indexes,
    artifacts: {
      jsonl: JSONL,
      sqlite: DB_PATH,
    },
  };

  await writeFile(resolve(OUT, "capacity-500x3y-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
