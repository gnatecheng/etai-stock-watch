import { describe, expect, it } from "vitest";
import { evaluateMaCrossover } from "../src/strategy/ma-crossover";
import {
  acceptanceBarsThroughSignal,
  acceptanceBarsThroughSellSignal,
  ACCEPTANCE_SIGNAL_DATE,
  ACCEPTANCE_SELL_SIGNAL_DATE,
} from "../src/providers/demo-scenario";

describe("acceptance synthetic bars", () => {
  it("triggers buy signal on acceptance signal date", () => {
    const bars = acceptanceBarsThroughSignal();
    const sig = evaluateMaCrossover(bars, ACCEPTANCE_SIGNAL_DATE);
    expect(sig).not.toBeNull();
    expect(sig!.direction).toBe("buy");
    expect(sig!.reasons.some((r) => r.includes("上穿"))).toBe(true);
  });

  it("triggers sell signal on acceptance sell date", () => {
    const bars = acceptanceBarsThroughSellSignal();
    const sig = evaluateMaCrossover(bars, ACCEPTANCE_SELL_SIGNAL_DATE);
    expect(sig).not.toBeNull();
    expect(sig!.direction).toBe("sell");
    expect(sig!.reasons.some((r) => r.includes("下穿"))).toBe(true);
  });
});
