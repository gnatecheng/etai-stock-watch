import { describe, expect, it } from "vitest";
import { evaluateMaCrossover } from "../src/strategy/ma-crossover";
import type { DailyBar } from "../src/providers/types";

function bars(closes: number[], start = "2024-07-01"): DailyBar[] {
  return closes.map((c, i) => {
    const d = new Date(start + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return {
      instrument_id: "x",
      trade_date: d.toISOString().slice(0, 10),
      open_cents: c,
      high_cents: c + 10,
      low_cents: c - 10,
      close_cents: c,
      volume: 500_000,
      adj_factor: 10000,
    };
  });
}

describe("evaluateMaCrossover", () => {
  it("returns null when insufficient bars", () => {
    const b = bars(Array(10).fill(10000));
    expect(evaluateMaCrossover(b, b[b.length - 1].trade_date)).toBeNull();
  });

  it("does not signal without enough history on trade date", () => {
    const values = [...Array(30).fill(10000), 12000];
    const b = bars(values);
    const last = b[b.length - 1].trade_date;
    const sig = evaluateMaCrossover(b, last, {
      maPeriod: 20,
      minBars: 25,
      minAvgVolume: 100_000,
      liquidityLookback: 20,
    });
    expect(sig).toBeTruthy();
    expect(sig!.reasons.some((r) => r.includes("不构成投资建议"))).toBe(true);
  });
});
