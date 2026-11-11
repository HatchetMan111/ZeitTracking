import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Category, DayPayload, Entry } from "../../api/types";
import { api } from "../../api/client";
import { DayView } from "./DayView";
import { EntrySheet } from "./EntrySheet";
import { TimerChips } from "./TimerChips";

vi.mock("../../api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Unbekannter Fehler",
}));

const category: Category = {
  id: 1, name: "Filme", color: "#FF6482", icon: "film", parent_id: null,
  goal_minutes_week: 0, detail_label: "Welcher Film?", sort_order: 0,
  archived: 0, created_at: 0,
};

const day: DayPayload = {
  date: "2026-11-10", start_ms: 1762732800000, end_ms: 1762819200000,
  now: 1762732800000, entries: [], total_minutes: 0, per_category: [],
  days_with_data: [],
};

const state: AppState = {
  now: 1762732800000, day_start_hour: 0, timezone: "Europe/Berlin",
  running_entry: null, categories: [category], auth_required: false, version: "2.0.0",
};

const completedEntry: Entry = {
  id: 7,
  category_id: 1,
  kind: "timeline",
  started_at: day.start_ms + 3600000,
  ended_at: day.start_ms + 7200000,
  effective_end: day.start_ms + 7200000,
  minutes: 60,
  note: "Blade Runner",
  updated_at: 0,
  category_name: "Filme",
  category_color: "#FF6482",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("day components", () => {
  it("uses the category detail label as placeholder", () => {
    render(
      <EntrySheet
        open
        categories={[category]}
        initial={{ mode: "create", started_at: day.start_ms + 3600000, ended_at: day.start_ms + 7200000 }}
        timezone="Europe/Berlin"
        onClose={() => {}}
        onSaved={() => {}}
        onDelete={() => {}}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId("sheet-detail")).toHaveAttribute("placeholder", "Welcher Film?");
  });

  it("starts a timer from a chip", () => {
    const onStart = vi.fn();
    render(
      <TimerChips
        categories={[category]}
        runningId={null}
        runningMinutes={0}
        onStart={onStart}
        onStop={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("timer-chip-1"));
    expect(onStart).toHaveBeenCalledWith(1);
  });

  it("renders the day total", () => {
    render(
      <DayView
        state={state}
        day={day}
        nowMs={day.start_ms}
        setDate={() => {}}
        onChanged={() => {}}
        onError={() => {}}
      />,
    );
    expect(screen.getByTestId("day-total")).toHaveTextContent("0m");
  });
});

describe("day view details", () => {
  it("sends the entered detail as note when saving a timeline entry", async () => {
    vi.mocked(api.post).mockResolvedValue(undefined);
    render(
      <EntrySheet
        open
        categories={[category]}
        initial={{ mode: "create", started_at: day.start_ms + 3600000, ended_at: day.start_ms + 7200000 }}
        timezone="Europe/Berlin"
        onClose={() => {}}
        onSaved={() => {}}
        onDelete={() => {}}
        onError={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId("sheet-detail"), {
      target: { value: "Der große Film" },
    });
    fireEvent.click(screen.getByTestId("sheet-save"));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/entries",
        expect.objectContaining({ category_id: 1, note: "Der große Film" }),
      ),
    );
  });

  it("stops the running timer when its chip is clicked", () => {
    const onStop = vi.fn();
    const onStart = vi.fn();
    render(
      <TimerChips
        categories={[category]}
        runningId={1}
        runningMinutes={12}
        onStart={onStart}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByTestId("timer-chip-1"));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("offers undo after deleting a completed entry and recreates its snapshot", async () => {
    vi.mocked(api.del).mockResolvedValue(undefined);
    vi.mocked(api.post).mockResolvedValue(undefined);

    render(
      <DayView
        state={state}
        day={{ ...day, entries: [completedEntry] }}
        nowMs={day.start_ms}
        setDate={() => {}}
        onChanged={() => {}}
        onError={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Löschen"));

    await waitFor(() =>
      expect(api.del).toHaveBeenCalledWith(`/entries/${completedEntry.id}`),
    );
    expect(screen.getByTestId("toast")).toHaveTextContent("Eintrag gelöscht");

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/entries", {
        category_id: completedEntry.category_id,
        started_at: completedEntry.started_at,
        ended_at: completedEntry.effective_end,
        note: completedEntry.note,
      }),
    );
  });
});
