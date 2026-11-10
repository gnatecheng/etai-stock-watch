import { describe, expect, it } from "vitest";
import { assertCalendarCoverage, weekdaySessionForSeed } from "../src/calendar/hk";

describe("HK calendar fail-closed", () => {
  it("rejects missing explicit calendar", () => {
    const r = assertCalendarCoverage("2024-07-15", "missing");
    expect(r.ok).toBe(false);
  });

  it("accepts explicit db calendar", () => {
    const r = assertCalendarCoverage("2024-07-15", "db");
    expect(r.ok).toBe(true);
  });

  it("seed helper marks weekends closed (seed only)", () => {
    expect(weekdaySessionForSeed("2024-07-13")).toBe("closed");
  });
});
