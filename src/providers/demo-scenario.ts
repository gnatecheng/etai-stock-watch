import type { DailyBar } from "./types";

/**
 * 合成演示 / 验收行情 — 非真实数据，仅供 20MA 工程策略可重复验收。
 * 标的 DEMO:00700；在 2024-08-28 设计为收盘价上穿 20 日均线 → buy 信号。
 */

export const ACCEPTANCE_SIGNAL_DATE = "2024-08-28";
export const ACCEPTANCE_NEXT_SESSION = "2024-08-29";
export const ACCEPTANCE_SELL_SIGNAL_DATE = "2024-09-06";
export const ACCEPTANCE_SELL_NEXT_SESSION = "2024-09-09";
export const ACCEPTANCE_INSTRUMENT_ID = "inst_demo_00700";

/** 收盘价（分）序列：前段在均线下方横盘，末两日上穿 */
const CLOSE_CENTS_SEQUENCE: { date: string; close: number; open: number; vol: number }[] = [
  { date: "2024-07-15", close: 28000, open: 27950, vol: 400000 },
  { date: "2024-07-16", close: 27900, open: 28000, vol: 410000 },
  { date: "2024-07-17", close: 27850, open: 27900, vol: 420000 },
  { date: "2024-07-18", close: 27800, open: 27850, vol: 430000 },
  { date: "2024-07-19", close: 27750, open: 27800, vol: 440000 },
  { date: "2024-07-22", close: 27700, open: 27750, vol: 450000 },
  { date: "2024-07-23", close: 27650, open: 27700, vol: 460000 },
  { date: "2024-07-24", close: 27600, open: 27650, vol: 470000 },
  { date: "2024-07-25", close: 27550, open: 27600, vol: 480000 },
  { date: "2024-07-26", close: 27500, open: 27550, vol: 490000 },
  { date: "2024-07-29", close: 27480, open: 27500, vol: 500000 },
  { date: "2024-07-30", close: 27460, open: 27480, vol: 510000 },
  { date: "2024-07-31", close: 27440, open: 27460, vol: 520000 },
  { date: "2024-08-01", close: 27420, open: 27440, vol: 530000 },
  { date: "2024-08-02", close: 27400, open: 27420, vol: 540000 },
  { date: "2024-08-05", close: 27380, open: 27400, vol: 550000 },
  { date: "2024-08-06", close: 27360, open: 27380, vol: 560000 },
  { date: "2024-08-07", close: 27340, open: 27360, vol: 570000 },
  { date: "2024-08-08", close: 27320, open: 27340, vol: 580000 },
  { date: "2024-08-09", close: 27300, open: 27320, vol: 590000 },
  { date: "2024-08-12", close: 27290, open: 27300, vol: 600000 },
  { date: "2024-08-13", close: 27285, open: 27290, vol: 610000 },
  { date: "2024-08-14", close: 27280, open: 27285, vol: 620000 },
  { date: "2024-08-15", close: 27275, open: 27280, vol: 630000 },
  { date: "2024-08-16", close: 27270, open: 27275, vol: 640000 },
  { date: "2024-08-19", close: 27265, open: 27270, vol: 650000 },
  { date: "2024-08-20", close: 27260, open: 27265, vol: 660000 },
  { date: "2024-08-21", close: 27255, open: 27260, vol: 670000 },
  { date: "2024-08-22", close: 27250, open: 27255, vol: 680000 },
  { date: "2024-08-23", close: 27350, open: 27250, vol: 690000 },
  { date: "2024-08-26", close: 27500, open: 27350, vol: 700000 },
  { date: "2024-08-27", close: 27295, open: 27290, vol: 710000 },
  { date: "2024-08-28", close: 28500, open: 27300, vol: 720000 },
];

export function acceptanceBarsThroughSignal(): DailyBar[] {
  return CLOSE_CENTS_SEQUENCE.map((r) => ({
    instrument_id: ACCEPTANCE_INSTRUMENT_ID,
    trade_date: r.date,
    open_cents: r.open,
    high_cents: r.close + 50,
    low_cents: r.open - 50,
    close_cents: r.close,
    volume: r.vol,
    turnover_cents: undefined,
    adj_factor: 10000,
  }));
}

/** 买入信号后至卖出信号日（含）的合成 K 线；延续高位后急跌下穿均线 */
const POST_BUY_SEQUENCE: { date: string; close: number; open: number; vol: number }[] = [
  { date: "2024-08-29", close: 28050, open: 27900, vol: 650000 },
  { date: "2024-08-30", close: 28300, open: 28050, vol: 660000 },
  { date: "2024-09-02", close: 28600, open: 28300, vol: 670000 },
  { date: "2024-09-03", close: 28800, open: 28600, vol: 680000 },
  { date: "2024-09-04", close: 28900, open: 28800, vol: 690000 },
  { date: "2024-09-05", close: 28950, open: 28900, vol: 700000 },
  { date: "2024-09-06", close: 26800, open: 28900, vol: 750000 },
];

function mapSequence(seq: typeof CLOSE_CENTS_SEQUENCE): DailyBar[] {
  return seq.map((r) => ({
    instrument_id: ACCEPTANCE_INSTRUMENT_ID,
    trade_date: r.date,
    open_cents: r.open,
    high_cents: Math.max(r.open, r.close) + 50,
    low_cents: Math.min(r.open, r.close) - 50,
    close_cents: r.close,
    volume: r.vol,
    turnover_cents: undefined,
    adj_factor: 10000,
  }));
}

export function acceptanceBarsThroughSellSignal(): DailyBar[] {
  return [...mapSequence(CLOSE_CENTS_SEQUENCE), ...mapSequence(POST_BUY_SEQUENCE)];
}

export function acceptanceNextSessionBar(): DailyBar {
  return mapSequence([{ date: ACCEPTANCE_NEXT_SESSION, close: 28050, open: 27900, vol: 650000 }])[0]!;
}

export function acceptanceSellNextSessionBar(): DailyBar {
  return mapSequence([
    { date: ACCEPTANCE_SELL_NEXT_SESSION, close: 26750, open: 26800, vol: 720000 },
  ])[0]!;
}

export const ACCEPTANCE_SCENARIO_LABEL =
  "合成演示行情（ACCEPTANCE_SCENARIO）— 非真实港股数据，用于 20MA 验收";
