import type { DailyBar } from "../providers/types";

export interface MaCrossoverConfig {
  maPeriod: number;
  minBars: number;
  minAvgVolume: number;
  liquidityLookback: number;
}

export const DEFAULT_MA_CONFIG: MaCrossoverConfig = {
  maPeriod: 20,
  minBars: 25,
  minAvgVolume: 200_000,
  liquidityLookback: 20,
};

export type SignalDirection = "buy" | "sell" | "watch";

export interface StrategySignal {
  direction: SignalDirection;
  trade_date: string;
  reasons: string[];
}

function sma(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function evaluateMaCrossover(
  bars: DailyBar[],
  tradeDate: string,
  config: MaCrossoverConfig = DEFAULT_MA_CONFIG,
): StrategySignal | null {
  const sorted = [...bars].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const idx = sorted.findIndex((b) => b.trade_date === tradeDate);
  if (idx < 0) return null;
  if (idx < config.minBars - 1) {
    return null;
  }
  const window = sorted.slice(0, idx + 1);
  const closes = window.map((b) => b.close_cents);
  const vols = window.slice(-config.liquidityLookback).map((b) => b.volume);
  const avgVol = sma(vols);
  if (avgVol < config.minAvgVolume) {
    return null;
  }
  if (closes.length < config.maPeriod + 1) return null;

  const maToday = sma(closes.slice(-config.maPeriod));
  const maPrev = sma(closes.slice(-config.maPeriod - 1, -1));
  const closeToday = closes[closes.length - 1];
  const closePrev = closes[closes.length - 2];

  const crossUp = closePrev <= maPrev && closeToday > maToday;
  const crossDown = closePrev >= maPrev && closeToday < maToday;

  const reasons: string[] = [
    `收盘价 ${(closeToday / 100).toFixed(2)} HKD，${config.maPeriod}日均线 ${(maToday / 100).toFixed(2)}`,
    `近${config.liquidityLookback}日平均成交量 ${Math.round(avgVol).toLocaleString("zh-Hans")}`,
    "工程演示策略，不构成投资建议",
  ];

  if (crossUp) {
    return { direction: "buy", trade_date: tradeDate, reasons: [...reasons, "收盘价上穿均线"] };
  }
  if (crossDown) {
    return { direction: "sell", trade_date: tradeDate, reasons: [...reasons, "收盘价下穿均线"] };
  }
  if (Math.abs(closeToday - maToday) / maToday < 0.005) {
    return { direction: "watch", trade_date: tradeDate, reasons: [...reasons, "价格贴近均线，观察"] };
  }
  return null;
}
