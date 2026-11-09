import { describe, expect, it } from "vitest";
import { assertCalendarCoverage, weekdaySession } from "../src/calendar/hk";

describe("HK calendar fail-closed", () => {
  it("rejects weekday inference for production coverage", () => {
    const r = assertCalendarCoverage("2024-07-15", "weekday");
    expect(r.ok).toBe(false);
  });

  it("accepts explicit db calendar", () => {
    const r = assertCalendarCoverage("2024-07-15", "db");
    expect(r.ok).toBe(true);
  });

  it("marks weekends closed", () => {
    expect(weekdaySession("2024-07-13")).toBe("closed");
  });
});
