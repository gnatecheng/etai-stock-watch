/**
 * 对 SQLite（模拟 D1）应用容量种子并报告行数/文件大小
 */
import Database from "better-sqlite3";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const OUT = "/opt/cursor/artifacts/capacity-benchmark.json";
const SAMPLE_SYMBOLS = Number(process.env.CAP_BENCH_SYMBOLS ?? "50");
const SAMPLE_DAYS = Number(process.env.CAP_BENCH_DAYS ?? "60");

async function loadLines(limit) {
  const path = resolve("/opt/cursor/artifacts/capacity-synthetic-bars.jsonl");
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
    if (rows.length >= limit) break;
  }
  return rows;
}

async function main() {
  const db = new Database(":memory:");
  const dir = resolve("migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(dir, f), "utf8"));
  }
  const snap = "snap_cap_bench";
  db.prepare(
    `INSERT INTO data_snapshots (id, provider, provider_version, imported_at, row_count, provenance_json)
     VALUES (?, 'synthetic-capacity', '1', datetime('now'), 0, ?)`,
  ).run(snap, JSON.stringify({ synthetic_capacity: true, demo: true }));
  const ins = db.prepare(
    `INSERT OR IGNORE INTO instruments (id, symbol, name_zh, currency, board_lot, exchange, status, created_at, updated_at)
     VALUES (?, ?, 'cap', 'HKD', 100, 'XHKG', 'active', datetime('now'), datetime('now'))`,
  );
  const bar = db.prepare(
    `INSERT INTO bars_daily (instrument_id, trade_date, open_cents, high_cents, low_cents, close_cents, volume, turnover_cents, adj_factor, snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 10000, ?)`,
  );
  const maxRows = SAMPLE_SYMBOLS * SAMPLE_DAYS;
  const lines = await loadLines(maxRows);
  const symToId = new Map();
  let inserted = 0;
  const t0 = Date.now();
  const tx = db.transaction(() => {
    for (const r of lines) {
      if (!symToId.has(r.symbol)) {
        const id = `inst_${r.symbol.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`;
        ins.run(id, r.symbol);
        symToId.set(r.symbol, id);
      }
      const cid = symToId.get(r.symbol);
      bar.run(
        cid,
        r.trade_date,
        Math.round(r.open * 100),
        Math.round(r.high * 100),
        Math.round(r.low * 100),
        Math.round(r.close * 100),
        r.volume,
        snap,
      );
      inserted++;
    }
  });
  tx();
  const ms = Date.now() - t0;
  const counts = {
    instruments: db.prepare("SELECT COUNT(*) as n FROM instruments").get().n,
    bars: db.prepare("SELECT COUNT(*) as n FROM bars_daily").get().n,
  };
  const report = {
    environment: "better-sqlite3 in-memory (D1 行为近似，非 remote D1)",
    sampleSymbols: SAMPLE_SYMBOLS,
    sampleDays: SAMPLE_DAYS,
    rowsInserted: inserted,
    insertMs: ms,
    counts,
    indexes: ["idx_bars_daily_date", "bars_daily PRIMARY KEY(instrument_id, trade_date)"],
    note: "全量 500×3y 见 capacity-synthetic-meta.json；本基准为可重复子样本",
  };
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir("/opt/cursor/artifacts", { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  try {
    const st = statSync(resolve("/opt/cursor/artifacts/capacity-synthetic-bars.jsonl"));
    report.jsonlBytes = st.size;
  } catch {
    /* optional */
  }
  console.log(JSON.stringify(report));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
