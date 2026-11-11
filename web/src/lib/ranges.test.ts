import { describe, expect, it } from "vitest";
import { periodRange } from "./ranges";

describe("period ranges", () => {
  it("uses Monday to Sunday for weeks", () => {
    expect(periodRange("week", "2026-11-10")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
  });
  it("handles month and leap years", () => {
    expect(periodRange("month", "2024-02-12")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodRange("month", "2026-11-10")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });
  it("handles years and custom ranges", () => {
    expect(periodRange("year", "2026-11-10")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("custom", "2026-11-10", { from: "2026-01-02", to: "2026-02-03" })).toEqual({
      from: "2026-01-02",
      to: "2026-02-03",
    });
    expect(() =>
      periodRange("custom", "2026-11-10", { from: "2026-02-03", to: "2026-01-02" }),
    ).toThrow();
  });
});
