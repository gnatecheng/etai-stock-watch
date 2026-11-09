import { describe, expect, it } from "vitest";
import { findFillBarAfterDate } from "../src/paper/fill";
import { addDays } from "../src/lib/time";

describe("paper fill discipline", () => {
  const bars = [
    { trade_date: "2024-07-10", open_cents: 1000, close_cents: 1010, volume: 1000 },
    { trade_date: "2024-07-11", open_cents: 1020, close_cents: 1030, volume: 1000 },
  ];

  it("fills only on session after signal date", () => {
    const fill = findFillBarAfterDate(bars, "2024-07-10");
    expect(fill?.trade_date).toBe("2024-07-11");
    expect(fill?.trade_date).not.toBe("2024-07-10");
  });

  it("does not use same-day close as fill", () => {
    const sameDay = findFillBarAfterDate(bars, "2024-07-11");
    expect(sameDay).toBeNull();
  });

  it("next session helper moves forward", () => {
    expect(addDays("2024-07-10", 1)).toBe("2024-07-11");
  });
});
