import { describe, it, expect } from "vitest";
import { finRowEligibleForScreen, finVisibleForHistoricalScreen } from "../src/import/fin-point-in-time";

describe("financial point-in-time", () => {
  it("blocks unknown announced_at for historical screen", () => {
    const r = finVisibleForHistoricalScreen(null, "2024-06-01", "2024-05-01");
    expect(r.visible).toBe(false);
  });

  it("allows announced before asOf", () => {
    const r = finVisibleForHistoricalScreen("2024-03-01", "2024-06-01", "");
    expect(r.visible).toBe(true);
  });

  it("blocks future announcement", () => {
    const r = finVisibleForHistoricalScreen("2024-12-01", "2024-06-01", "");
    expect(r.visible).toBe(false);
  });

  it("fin metric screen respects visibility", () => {
    const row = {
      announced_at: null,
      metrics_json: JSON.stringify({ operating_revenue: 100 }),
    };
    expect(finRowEligibleForScreen(row, "2024-06-01", "operating_revenue", 50).pass).toBe(false);
    const row2 = {
      announced_at: "2024-02-01",
      metrics_json: JSON.stringify({ operating_revenue: 100 }),
    };
    expect(finRowEligibleForScreen(row2, "2024-06-01", "operating_revenue", 50).pass).toBe(true);
  });
});
