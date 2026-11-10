/**
 * 合成容量情景：500 标的 × 约 3 年日线（仅 DEMO:CAP*，非真实行情）
 * 输出 JSONL 供 import batch stage / 本地基准
 */
import { writeFile, mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";

const OUT = "/opt/cursor/artifacts";
const SYMBOLS = 500;
const START = new Date("2021-01-04");
const END = new Date("2024-06-28");

function tradingDays() {
  const days = [];
  const d = new Date(START);
  while (d <= END) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      days.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const days = tradingDays();
  const path = resolve(OUT, "capacity-synthetic-bars.jsonl");
  const ws = createWriteStream(path);
  let rows = 0;
  for (let i = 1; i <= SYMBOLS; i++) {
    const symbol = `DEMO:CAP${String(i).padStart(5, "0")}`;
    for (const trade_date of days) {
      const close = 10 + (i % 50) * 0.1 + (days.indexOf(trade_date) % 10) * 0.01;
      const row = { symbol, trade_date, open: close - 0.1, high: close + 0.2, low: close - 0.3, close, volume: 100000 };
      ws.write(`${JSON.stringify(row)}\n`);
      rows++;
    }
  }
  ws.end();
  await new Promise((r) => ws.on("finish", r));
  const jsonlBytesActual = statSync(path).size;
  const meta = {
    label: "合成容量情景 — 非真实行情",
    symbols: SYMBOLS,
    scenarioTradingDays: days.length,
    scenarioNote: "工作日计数 2021-01-04..2024-06-28，非港交所官方历",
    totalRows: rows,
    jsonlBytesActual,
    output: path,
    nextStep: "node scripts/capacity-full-load.mjs",
  };
  await writeFile(resolve(OUT, "capacity-synthetic-meta.json"), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
