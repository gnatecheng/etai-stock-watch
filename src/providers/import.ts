import type { CsvBarRow, DailyBar } from "./types";
import { newId } from "../lib/id";
import { nowIso } from "../lib/time";

const SYMBOL_RE = /^[A-Z0-9:]+$/;

export function parseCsv(content: string): CsvBarRow[] {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV 无数据行");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const required = ["symbol", "trade_date", "open", "high", "low", "close", "volume"];
  for (const r of required) {
    if (!header.includes(r)) throw new Error(`CSV 缺少列: ${r}`);
  }
  const rows: CsvBarRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < header.length) continue;
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = cols[idx];
    });
    rows.push(obj as unknown as CsvBarRow);
  }
  return rows;
}

export function validateAndMapRows(
  rows: CsvBarRow[],
  symbolToId: Map<string, string>,
  snapshotId: string,
): DailyBar[] {
  const out: DailyBar[] = [];
  for (const row of rows) {
    if (!SYMBOL_RE.test(row.symbol)) throw new Error(`非法代码: ${row.symbol}`);
    const id = symbolToId.get(row.symbol);
    if (!id) throw new Error(`未知标的: ${row.symbol}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.trade_date)) {
      throw new Error(`非法日期: ${row.trade_date}`);
    }
    const o = Math.round(parseFloat(row.open) * 100);
    const h = Math.round(parseFloat(row.high) * 100);
    const l = Math.round(parseFloat(row.low) * 100);
    const c = Math.round(parseFloat(row.close) * 100);
    const v = parseInt(row.volume, 10);
    if ([o, h, l, c].some((x) => !Number.isFinite(x) || x <= 0)) {
      throw new Error(`OHLC 无效: ${row.symbol} ${row.trade_date}`);
    }
    if (l > h || o > h || c > h || l > o || l > c) {
      throw new Error(`OHLC 关系错误: ${row.symbol} ${row.trade_date}`);
    }
    if (!Number.isFinite(v) || v < 0) throw new Error(`成交量无效`);
    out.push({
      instrument_id: id,
      trade_date: row.trade_date,
      open_cents: o,
      high_cents: h,
      low_cents: l,
      close_cents: c,
      volume: v,
      adj_factor: 10000,
    });
  }
  return out;
}

export async function persistBars(
  db: D1Database,
  bars: DailyBar[],
  snapshotId: string,
): Promise<void> {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO bars_daily
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
      snapshotId,
    ),
  );
  if (batch.length) await db.batch(batch);
}

export function newSnapshotMeta(provider: string, rowCount: number) {
  return {
    id: newId("snap"),
    provider,
    provider_version: "import-v1",
    imported_at: nowIso(),
    row_count: rowCount,
    provenance_json: JSON.stringify({ source: "admin_csv_import" }),
  };
}
