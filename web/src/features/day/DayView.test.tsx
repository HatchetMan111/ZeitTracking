import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, Category, DayPayload, Entry } from "../../api/types";
import { api } from "../../api/client";
import { localDateStr } from "../../lib/time";
import { DayView } from "./DayView";
import { EntrySheet } from "./EntrySheet";
import { Timeline } from "./Timeline";
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

if (!window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    constructor(type: string, init?: PointerEventInit) {
      super(type, init as MouseEventInit);
    }
  }
  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    writable: true,
  });
}

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

const durationEntry: Entry = {
  id: 11,
  category_id: 1,
  kind: "duration",
  started_at: day.start_ms + 3600000,
  ended_at: null,
  effective_end: day.start_ms + 3600000,
  minutes: 45,
  note: "Podcast",
  updated_at: 0,
  category_name: "Filme",
  category_color: "#FF6482",
  overlap_minutes: 45,
};

const runningTimelineEntry: Entry = {
  ...completedEntry,
  id: 12,
  ended_at: null,
  effective_end: completedEntry.started_at,
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

  it("does not send ended_at when saving a running entry", async () => {
    vi.mocked(api.patch).mockResolvedValue(undefined);
    const running: Entry = {
      ...completedEntry,
      id: 9,
      ended_at: null,
      effective_end: completedEntry.started_at,
      minutes: null,
    };

    render(
      <EntrySheet
        open
        categories={[category]}
        initial={{ mode: "edit", entry: running }}
        timezone="Europe/Berlin"
        onClose={() => {}}
        onSaved={() => {}}
        onDelete={() => {}}
        onError={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("sheet-save"));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    const [path, body] = vi.mocked(api.patch).mock.calls[0];
    expect(path).toBe("/entries/9");
    expect(body).not.toHaveProperty("ended_at");
    expect(body).toMatchObject({ category_id: 1, note: "Blade Runner" });
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

  it("reports a failed delete without showing the undo toast", async () => {
    vi.mocked(api.del).mockRejectedValue(new Error("Löschen fehlgeschlagen"));
    const onError = vi.fn();

    render(
      <DayView
        state={state}
        day={{ ...day, entries: [completedEntry] }}
        nowMs={day.start_ms}
        setDate={() => {}}
        onChanged={() => {}}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByLabelText("Löschen"));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Löschen fehlgeschlagen"),
    );
    expect(screen.queryByTestId("toast")).toBeNull();
  });

  it("reports a failed undo and clears the toast", async () => {
    vi.mocked(api.del).mockResolvedValue(undefined);
    vi.mocked(api.post).mockRejectedValue(new Error("Wiederherstellen fehlgeschlagen"));
    const onError = vi.fn();

    render(
      <DayView
        state={state}
        day={{ ...day, entries: [completedEntry] }}
        nowMs={day.start_ms}
        setDate={() => {}}
        onChanged={() => {}}
        onError={onError}
      />,
    );

    fireEvent.click(screen.getByLabelText("Löschen"));
    await waitFor(() => expect(screen.getByTestId("toast")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Wiederherstellen fehlgeschlagen"),
    );
    await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
  });

  it("deletes a duration entry and recreates it via /entries/duration on undo", async () => {
    vi.mocked(api.del).mockResolvedValue(undefined);
    vi.mocked(api.post).mockResolvedValue(undefined);

    render(
      <DayView
        state={state}
        day={{ ...day, entries: [durationEntry] }}
        nowMs={day.start_ms}
        setDate={() => {}}
        onChanged={() => {}}
        onError={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Löschen"));

    await waitFor(() =>
      expect(api.del).toHaveBeenCalledWith(`/entries/${durationEntry.id}`),
    );
    expect(screen.getByTestId("toast")).toHaveTextContent("Eintrag gelöscht");

    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/entries/duration", {
        category_id: durationEntry.category_id,
        date: localDateStr(durationEntry.started_at, "Europe/Berlin"),
        minutes: durationEntry.minutes,
        note: durationEntry.note,
      }),
    );
  });

  it("hides the row delete button for a running timeline entry", () => {
    render(
      <DayView
        state={state}
        day={{ ...day, entries: [runningTimelineEntry] }}
        nowMs={day.start_ms}
        setDate={() => {}}
        onChanged={() => {}}
        onError={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Löschen")).toBeNull();
  });

  it("keeps the sheet delete button for duration entries", () => {
    render(
      <EntrySheet
        open
        categories={[category]}
        initial={{ mode: "edit", entry: durationEntry }}
        timezone="Europe/Berlin"
        onClose={() => {}}
        onSaved={() => {}}
        onDelete={() => {}}
        onError={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Löschen" })).toBeInTheDocument();
  });
});

describe("timeline drag", () => {
  const draggableDay: DayPayload = { ...day, entries: [completedEntry] };

  function renderTimeline() {
    const onPatch = vi.fn();
    const onOpen = vi.fn();
    render(
      <Timeline
        day={draggableDay}
        now={day.start_ms}
        timezone="Europe/Berlin"
        onOpen={onOpen}
        onPatch={onPatch}
        onDelete={() => {}}
        onCreate={() => {}}
      />,
    );
    return { onPatch, onOpen };
  }

  it("applies the pointer delta once across multiple pointermove events", () => {
    const { onPatch } = renderTimeline();
    const block = screen.getByTestId(`timeline-block-${completedEntry.id}`);

    fireEvent.pointerDown(block, { clientY: 100 });
    fireEvent.pointerMove(window, { clientY: 100 + 56 });
    fireEvent.pointerMove(window, { clientY: 100 + 112 });
    fireEvent.pointerUp(window);

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith(completedEntry.id, {
      started_at: completedEntry.started_at + 2 * 3600000,
      ended_at: completedEntry.effective_end + 2 * 3600000,
    });
  });

  it("does not open the sheet for a click that follows a real drag", () => {
    const { onOpen } = renderTimeline();
    const block = screen.getByTestId(`timeline-block-${completedEntry.id}`);

    fireEvent.pointerDown(block, { clientY: 100 });
    fireEvent.pointerMove(window, { clientY: 156 });
    fireEvent.pointerUp(window);
    fireEvent.click(block);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("resets a cancelled drag without patching or suppressing clicks", () => {
    const { onPatch, onOpen } = renderTimeline();
    const block = screen.getByTestId(`timeline-block-${completedEntry.id}`);

    fireEvent.pointerDown(block, { clientY: 100 });
    fireEvent.pointerMove(window, { clientY: 156 });
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window);

    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.click(block);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
