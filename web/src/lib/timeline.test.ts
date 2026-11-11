import { describe, expect, it } from "vitest";
import { SNAP_MS, clampRange, snapMs, yToMs } from "./timeline";

const dayStart = Date.UTC(2026, 10, 10, 0, 0);

describe("timeline math", () => {
  it("snaps to five minutes relative to the day", () => {
    expect(snapMs(dayStart + 8 * 3600000 + 3 * 60000, dayStart)).toBe(
      dayStart + 8 * 3600000 + 5 * 60000,
    );
    expect(snapMs(dayStart + 8 * 3600000 + 2 * 60000, dayStart)).toBe(dayStart + 8 * 3600000);
  });

  it("clamps ranges into the day and enforces five minutes", () => {
    const dayEnd = dayStart + 24 * 3600000;
    expect(clampRange(dayStart - 3600000, dayStart + 3600000, dayStart, dayEnd)).toEqual({
      start: dayStart,
      end: dayStart + 3600000,
    });
    expect(clampRange(dayEnd - 60000, dayEnd + 3600000, dayStart, dayEnd)).toEqual({
      start: dayEnd - SNAP_MS,
      end: dayEnd,
    });
  });

  it("maps pixels to milliseconds", () => {
    expect(yToMs(56, dayStart, 56)).toBe(dayStart + 3600000);
  });
});
