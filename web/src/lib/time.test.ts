import { describe, expect, it } from "vitest";
import { fmtDuration, shiftDate } from "./time";

describe("time helpers", () => {
  it("formats durations", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(59)).toBe("59m");
    expect(fmtDuration(60)).toBe("1h 00m");
    expect(fmtDuration(125)).toBe("2h 05m");
  });

  it("shifts ISO dates across month boundaries", () => {
    expect(shiftDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
  });
});
