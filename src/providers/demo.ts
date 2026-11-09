import type { DailyBar, InstrumentMeta, MarketDataProvider } from "./types";

/**
 * 演示用 fictional / 合成数据 — 非真实行情。
 * 标的代码为 DEMO 前缀，仅供本地与测试。
 */

const INSTRUMENTS: InstrumentMeta[] = [
  {
    id: "inst_demo_00700",
    symbol: "DEMO:00700",
    name_zh: "演示科技",
    name_en: "Demo Tech",
    currency: "HKD",
    board_lot: 100,
    exchange: "XHKG",
    status: "active",
  },
  {
    id: "inst_demo_00005",
    symbol: "DEMO:00005",
    name_zh: "演示银行",
    name_en: "Demo Bank",
    currency: "HKD",
    board_lot: 100,
    exchange: "XHKG",
    status: "active",
  },
  {
    id: "inst_demo_09988",
    symbol: "DEMO:09988",
    name_zh: "演示电商",
    name_en: "Demo Commerce",
    currency: "HKD",
    board_lot: 100,
    exchange: "XHKG",
    status: "active",
  },
];

function genBars(inst: InstrumentMeta, base: number, seed: number): DailyBar[] {
  const bars: DailyBar[] = [];
  let price = base;
  let d = new Date("2024-06-01T00:00:00Z");
  for (let i = 0; i < 80; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const drift = Math.sin((i + seed) * 0.15) * 2 + ((i % 7) - 3) * 0.3;
      const open = price;
      const close = Math.max(100, Math.round((price + drift) * 100));
      const high = close + Math.round(Math.abs(drift) * 50) + 20;
      const low = Math.max(50, close - Math.round(Math.abs(drift) * 50) - 20);
      const vol = 500_000 + ((i * seed * 17) % 200_000);
      bars.push({
        instrument_id: inst.id,
        trade_date: d.toISOString().slice(0, 10),
        open_cents: Math.round(open * 100),
        high_cents: high,
        low_cents: low,
        close_cents: close,
        volume: vol,
        /** 演示数据不提供可信成交额；筛选引擎禁止用收盘价×成交量推算 */
        turnover_cents: undefined,
        adj_factor: 10000,
      });
      price = close / 100;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return bars;
}

const BAR_CACHE: Map<string, DailyBar[]> = new Map();

function barsFor(instId: string): DailyBar[] {
  if (!BAR_CACHE.has(instId)) {
    const inst = INSTRUMENTS.find((x) => x.id === instId);
    if (!inst) return [];
    const seed = inst.symbol.charCodeAt(inst.symbol.length - 1);
    const base = instId.includes("00005") ? 55 : instId.includes("09988") ? 85 : 320;
    BAR_CACHE.set(instId, genBars(inst, base, seed));
  }
  return BAR_CACHE.get(instId) ?? [];
}

export class DemoMarketDataProvider implements MarketDataProvider {
  name = "demo";
  isDemo = true;

  async listInstruments(): Promise<InstrumentMeta[]> {
    return INSTRUMENTS;
  }

  async getBars(instrumentId: string, from: string, to: string): Promise<DailyBar[]> {
    return barsFor(instrumentId).filter((b) => b.trade_date >= from && b.trade_date <= to);
  }

  async isEodReady(_tradeDate: string): Promise<boolean> {
    return true;
  }

  exportBarsForSeed(): DailyBar[] {
    return INSTRUMENTS.flatMap((i) => barsFor(i.id));
  }

  exportInstruments(): InstrumentMeta[] {
    return INSTRUMENTS;
  }
}
