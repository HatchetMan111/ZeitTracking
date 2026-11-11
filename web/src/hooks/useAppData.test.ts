import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, DayPayload } from "../api/types";
import { useAppData } from "./useAppData";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const statePayload: AppState = {
  now: 1762830000000,
  day_start_hour: 0,
  timezone: "Europe/Berlin",
  running_entry: null,
  categories: [],
  auth_required: true,
  version: "2.0.0",
};

const dayPayload: DayPayload = {
  date: "2026-11-11",
  start_ms: 1762815600000,
  end_ms: 1762902000000,
  now: 1762830000000,
  entries: [],
  total_minutes: 0,
  per_category: [],
  days_with_data: ["2026-11-11"],
};

afterEach(() => vi.unstubAllGlobals());

describe("useAppData", () => {
  it("starts with empty date, loads queryless /day first and adopts the server date", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/state") return Promise.resolve(jsonResponse(statePayload));
      if (url === "/api/day" || url.startsWith("/api/day?")) {
        return Promise.resolve(jsonResponse(dayPayload));
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAppData());
    expect(result.current.date).toBe("");

    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.date).toBe("2026-11-11");
    expect(result.current.day?.date).toBe("2026-11-11");

    const dayCalls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith("/api/day"));
    expect(dayCalls[0]).toBe("/api/day");
  });

  it("reports auth status when /state returns 401", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: "Nicht angemeldet" }, 401)),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAppData());

    await waitFor(() => expect(result.current.status).toBe("auth"));

    expect(result.current.date).toBe("");
    expect(result.current.state).toBeNull();
    expect(result.current.day).toBeNull();
  });
});
