import { isTradableSession } from "../calendar/hk";
import type { BarRow } from "./engine";

/**
 * 信号日之后、在日历上可交易且行情有效的最近一根 bar；用下一 session 开盘价成交。
 */
export async function findNextValidFillBar(
  db: D1Database,
  bars: BarRow[],
  signalTradeDate: string,
): Promise<BarRow | null> {
  const sorted = [...bars]
    .filter((b) => b.trade_date > signalTradeDate)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

  for (const bar of sorted) {
    if (!(await isTradableSession(db, bar.trade_date))) continue;
    if (bar.volume <= 0) continue;
    if (!Number.isFinite(bar.open_cents) || bar.open_cents <= 0) continue;
    return bar;
  }
  return null;
}

/** 同步近似（无日历）— 仅供单元测试快速校验日期先后 */
export function findFillBarAfterDate(bars: BarRow[], afterDate: string): BarRow | null {
  const sorted = [...bars].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  return sorted.find((b) => b.trade_date > afterDate && b.volume > 0) ?? null;
}
