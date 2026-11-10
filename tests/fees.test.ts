import { describe, expect, it } from "vitest";
import { computeTradeFees, DEMO_FEE_SCHEDULES } from "../src/paper/fees";

describe("fee schedules", () => {
  it("applies effective-dated demo fees", () => {
    const { total } = computeTradeFees(1_000_000, DEMO_FEE_SCHEDULES, "2024-08-01");
    expect(total).toBeGreaterThan(0);
  });

  it("excludes expired schedules", () => {
    const expired = [
      {
        ...DEMO_FEE_SCHEDULES[0],
        effective_to: "2020-01-01",
      },
    ];
    const { total } = computeTradeFees(1_000_000, expired, "2024-08-01");
    expect(total).toBe(0);
  });
});
