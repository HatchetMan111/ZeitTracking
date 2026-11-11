import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StatsPayload, SummaryPayload } from "../api/types";
import { ApiError } from "../api/client";
import { useDashboardData } from "./useDashboardData";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, get } };
});

const summary: SummaryPayload = {
  now: 0,
  totals: { today_minutes: 30, week_minutes: 90, month_minutes: 120, all_minutes: 600 },
  lifetime_by_category: [],
  first_entry_date: "2026-01-01",
};

const categoryStats: StatsPayload = {
  from: "2026-11-09",
  to: "2026-11-15",
  group_by: "category",
  total_minutes: 100,
  rows: [{ key: "1", label: "Arbeit", color: "#FF375F", minutes: 100 }],
  days: [],
  entries: [],
};

const heatStats: StatsPayload = {
  from: "2025-11-11",
  to: "2026-11-10",
  group_by: "day",
  total_minutes: 100,
  rows: [],
  days: [{ date: "2026-11-10", minutes: 100 }],
  entries: [],
};

const range = { from: "2026-11-09", to: "2026-11-15" };
const nextRange = { from: "2026-11-16", to: "2026-11-22" };

const props = {
  enabled: true,
  today: "2026-11-10",
  range,
  refreshKey: 1,
  onAuth: vi.fn(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  get.mockReset();
});

describe("useDashboardData", () => {
  it("does not fetch while disabled", async () => {
    renderHook(() => useDashboardData({ ...props, enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("fetches summary, period stats and the 365-day heatmap", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/summary") return Promise.resolve(summary);
      if (path.includes("group_by=day")) return Promise.resolve(heatStats);
      return Promise.resolve(categoryStats);
    });
    const { result } = renderHook(() => useDashboardData(props));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(get).toHaveBeenCalledWith("/summary");
    expect(get).toHaveBeenCalledWith(
      "/stats?from=2026-11-09&to=2026-11-15&group_by=category",
    );
    expect(get).toHaveBeenCalledWith(
      "/stats?from=2025-11-11&to=2026-11-10&group_by=day",
    );
    expect(result.current.data?.heatmap).toEqual(heatStats.days);
    expect(result.current.loading).toBe(false);
  });

  it("ignores a stale response from an older range", async () => {
    const oldSummary = deferred<SummaryPayload>();
    const oldStats = deferred<StatsPayload>();
    const oldHeat = deferred<StatsPayload>();
    let phase: "old" | "new" = "old";
    get.mockImplementation((path: string) => {
      if (phase === "old") {
        if (path === "/summary") return oldSummary.promise;
        if (path.includes("group_by=day")) return oldHeat.promise;
        return oldStats.promise;
      }
      if (path === "/summary") return Promise.resolve(summary);
      if (path.includes("group_by=day")) return Promise.resolve(heatStats);
      return Promise.resolve({ ...categoryStats, from: nextRange.from, to: nextRange.to });
    });

    const { result, rerender } = renderHook((current) => useDashboardData(current), {
      initialProps: props,
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));

    phase = "new";
    rerender({ ...props, range: nextRange, refreshKey: 2 });
    await waitFor(() => expect(result.current.data?.from).toBe(nextRange.from));

    oldSummary.resolve(summary);
    oldStats.resolve(categoryStats);
    oldHeat.resolve(heatStats);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data?.from).toBe(nextRange.from);
    expect(result.current.data?.to).toBe(nextRange.to);
  });

  it("calls onAuth once for a 401 and reports a calm error on the retry", async () => {
    const onAuth = vi.fn();
    get.mockRejectedValue(new ApiError("unauthorized", 401));
    const { result, rerender } = renderHook((current) => useDashboardData(current), {
      initialProps: { ...props, onAuth },
    });

    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBe("");

    rerender({ ...props, onAuth, refreshKey: 2 });
    await waitFor(() => expect(result.current.error).not.toBe(""));
    expect(onAuth).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/erneut anmelden/);
  });

  it("clear resets data and error", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/summary") return Promise.resolve(summary);
      if (path.includes("group_by=day")) return Promise.resolve(heatStats);
      return Promise.resolve(categoryStats);
    });
    const { result } = renderHook(() => useDashboardData(props));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    act(() => result.current.clear());

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("");
    expect(result.current.loading).toBe(false);
  });

  it("clear during an in-flight request prevents the response from writing", async () => {
    const pendingSummary = deferred<SummaryPayload>();
    const pendingStats = deferred<StatsPayload>();
    const pendingHeat = deferred<StatsPayload>();
    get.mockImplementation((path: string) => {
      if (path === "/summary") return pendingSummary.promise;
      if (path.includes("group_by=day")) return pendingHeat.promise;
      return pendingStats.promise;
    });
    const { result } = renderHook(() => useDashboardData(props));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));

    act(() => result.current.clear());

    pendingSummary.resolve(summary);
    pendingStats.resolve(categoryStats);
    pendingHeat.resolve(heatStats);
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("resets the 401 guard after a successful load", async () => {
    const onAuth = vi.fn();
    let mode: "401" | "ok" = "401";
    get.mockImplementation((path: string) => {
      if (mode === "401") return Promise.reject(new ApiError("unauthorized", 401));
      if (path === "/summary") return Promise.resolve(summary);
      if (path.includes("group_by=day")) return Promise.resolve(heatStats);
      return Promise.resolve(categoryStats);
    });
    const { result, rerender } = renderHook((current) => useDashboardData(current), {
      initialProps: { ...props, onAuth },
    });

    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(1));

    mode = "ok";
    rerender({ ...props, onAuth, refreshKey: 2 });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    mode = "401";
    rerender({ ...props, onAuth, refreshKey: 3 });
    await waitFor(() => expect(onAuth).toHaveBeenCalledTimes(2));
  });
});
