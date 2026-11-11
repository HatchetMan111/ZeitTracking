import { describe, expect, it } from "vitest";
import { heatLevel, heatmapWeeks, percentages, trendPoints } from "./charts";

describe("chart math", () => {
  it("distributes percentages with largest remainder", () => {
    const values = percentages([1, 1, 1]);
    expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
    expect(values).toEqual([33.4, 33.3, 33.3]);
  });
  it("handles empty and zero values", () => {
    expect(percentages([])).toEqual([]);
    expect(percentages([0, 0])).toEqual([0, 0]);
  });
  it("maps heat levels", () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(1)).toBe(1);
    expect(heatLevel(29)).toBe(1);
    expect(heatLevel(30)).toBe(2);
    expect(heatLevel(60)).toBe(3);
    expect(heatLevel(120)).toBe(4);
  });
  it("aggregates long ranges by month", () => {
    const points = trendPoints(
      [
        { date: "2026-01-05", minutes: 30 },
        { date: "2026-01-20", minutes: 30 },
        { date: "2026-02-01", minutes: 60 },
      ],
      "year",
      365,
    );
    expect(points).toEqual([
      { label: "2026-01", minutes: 60 },
      { label: "2026-02", minutes: 60 },
    ]);
  });
  it("uses daily labels for short ranges", () => {
    expect(trendPoints([{ date: "2026-11-09", minutes: 45 }], "week", 7)).toEqual([
      { label: "11-09", minutes: 45 },
    ]);
    expect(trendPoints([{ date: "2026-11-09", minutes: 45 }], "custom", 62)).toEqual([
      { label: "11-09", minutes: 45 },
    ]);
  });
  it("aggregates custom ranges longer than 62 days by month", () => {
    expect(trendPoints([{ date: "2026-11-09", minutes: 45 }], "custom", 63)).toEqual([
      { label: "2026-11", minutes: 45 },
    ]);
  });
  it("returns no heatmap weeks for no days", () => {
    expect(heatmapWeeks([])).toEqual([]);
  });
  it("groups heatmap days into Monday-starting weeks", () => {
    const weeks = heatmapWeeks([
      { date: "2026-11-09", minutes: 10 },
      { date: "2026-11-10", minutes: 20 },
    ]);
    expect(weeks[0][0]).toEqual({ date: "2026-11-09", minutes: 10 });
    expect(weeks[0][1]).toEqual({ date: "2026-11-10", minutes: 20 });
    expect(weeks[0]).toHaveLength(7);
  });
});
