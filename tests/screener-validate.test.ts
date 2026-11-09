import { describe, it, expect } from "vitest";
import { validateScreenerRequest } from "../src/screener/validate";
import type { ScreenerCapabilities } from "../src/screener/types";

const caps: ScreenerCapabilities = {
  demo: true,
  demoWatermark: "DEMO",
  units: { price: "", changePct: "", turnover: "", ma: "" },
  turnoverSupported: false,
  turnoverUnsupportedReason: "demo",
  disclaimer: "",
  signalDisclaimer: "",
  maxMaPeriod: 120,
  minMaPeriod: 2,
};

describe("screener validate", () => {
  it("rejects empty conditions", () => {
    const r = validateScreenerRequest({ conditions: [] }, caps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_CONDITIONS");
  });

  it("rejects turnover when unsupported", () => {
    const r = validateScreenerRequest(
      { conditions: [{ type: "turnover", minHkd: 1 }] },
      caps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TURNOVER_NOT_SUPPORTED");
  });

  it("rejects invalid ma period", () => {
    const r = validateScreenerRequest(
      { conditions: [{ type: "ma_relation", period: 1, relation: "above" }] },
      caps,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects min > max on price", () => {
    const r = validateScreenerRequest(
      { conditions: [{ type: "price_close", minHkd: 100, maxHkd: 50 }] },
      caps,
    );
    expect(r.ok).toBe(false);
  });

  it("accepts valid AND body", () => {
    const r = validateScreenerRequest(
      {
        conditions: [
          { type: "price_close", minHkd: 10, maxHkd: 500 },
          { type: "change_pct", minPct: -10, maxPct: 10 },
        ],
      },
      caps,
    );
    expect(r.ok).toBe(true);
  });
});
