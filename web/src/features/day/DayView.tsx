import { useMemo, useState } from "react";
import { api, errorMessage } from "../../api/client";
import type { AppState, DayPayload, Entry } from "../../api/types";
import Toast from "../../components/Toast";
import { fmtClock, fmtDateLong, fmtDuration, localDateStr, shiftDate } from "../../lib/time";
import { EntrySheet, type SheetDraft } from "./EntrySheet";
import { Timeline } from "./Timeline";
import { TimerChips } from "./TimerChips";

export function DayView({
  state,
  day,
  nowMs,
  setDate,
  onChanged,
  onError,
}: {
  state: AppState;
  day: DayPayload;
  nowMs: number;
  setDate: (date: string) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [sheet, setSheet] = useState<SheetDraft | null>(null);
  const [deleted, setDeleted] = useState<{ entry: Entry; undo: () => Promise<void> } | null>(null);
  const running = state.running_entry;
  const runningMinutes = running
    ? (nowMs - running.started_at) / 60000
    : 0;

  const rows = useMemo(
    () => [...day.entries].sort((a, b) => a.started_at - b.started_at),
    [day.entries],
  );

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      onChanged();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function remove(entry: Entry) {
    if (entry.ended_at === null) return;
    const snapshot =
      entry.kind === "duration"
        ? {
            category_id: entry.category_id,
            date: localDateStr(entry.started_at, state.timezone),
            minutes: entry.minutes ?? 0,
            note: entry.note,
          }
        : {
            category_id: entry.category_id,
            started_at: entry.started_at,
            ended_at: entry.effective_end,
            note: entry.note,
          };
    try {
      await api.del(`/entries/${entry.id}`);
    } catch (error) {
      onError(errorMessage(error));
      return;
    }
    onChanged();
    setDeleted({
      entry,
      undo: async () => {
        if (entry.kind === "duration") await api.post("/entries/duration", snapshot);
        else await api.post("/entries", snapshot);
        onChanged();
      },
    });
  }

  return (
    <section className="day-view">
      <header className="day-header">
        <button type="button" onClick={() => setDate(shiftDate(day.date, -1))} aria-label="Vorheriger Tag">‹</button>
        <div>
          <h1>{fmtDateLong(day.date)}</h1>
          <p data-testid="day-total">{fmtDuration(day.total_minutes)}</p>
        </div>
        <button type="button" onClick={() => setDate(shiftDate(day.date, 1))} aria-label="Nächster Tag">›</button>
        <button type="button" onClick={() => setDate(localDateStr(nowMs, state.timezone))}>Heute</button>
        <button
          type="button"
          data-testid="add-duration"
          onClick={() => setSheet({ mode: "create-duration", date: day.date })}
        >
          Dauer
        </button>
      </header>

      <TimerChips
        categories={state.categories}
        runningId={running?.category_id ?? null}
        runningMinutes={runningMinutes}
        onStart={(id) => void run(() => api.post(`/timers/${id}/start`))}
        onStop={() => void run(() => api.post("/timers/stop"))}
      />

      <Timeline
        day={day}
        now={nowMs}
        timezone={state.timezone}
        onOpen={(entry) => setSheet({ mode: "edit", entry })}
        onPatch={(id, range) =>
          void run(() => api.patch(`/entries/${id}`, range))
        }
        onDelete={(entry) => void remove(entry)}
        onCreate={(started_at, ended_at) =>
          setSheet({ mode: "create", started_at, ended_at })
        }
      />

      <ul className="entry-list">
        {rows.map((entry) => (
          <li key={entry.id} data-testid={`entry-${entry.id}`}>
            <button type="button" onClick={() => setSheet({ mode: "edit", entry })}>
              <span className="dot" style={{ background: entry.category_color }} />
              <span>{entry.category_name}</span>
              <span>{fmtClock(entry.started_at, state.timezone)}</span>
              <span>{fmtDuration(entry.overlap_minutes ?? entry.minutes ?? 0)}</span>
              {entry.note ? <em>{entry.note}</em> : null}
            </button>
            {entry.ended_at !== null ? (
              <button type="button" aria-label="Löschen" onClick={() => void remove(entry)}>×</button>
            ) : null}
          </li>
        ))}
      </ul>

      <EntrySheet
        open={sheet !== null}
        categories={state.categories}
        initial={sheet}
        timezone={state.timezone}
        onClose={() => setSheet(null)}
        onSaved={onChanged}
        onDelete={(entry) => {
          setSheet(null);
          void remove(entry);
        }}
        onError={onError}
      />

      {deleted ? (
        <Toast
          message="Eintrag gelöscht"
          actionLabel="Rückgängig"
          onAction={() => {
            void deleted
              .undo()
              .catch((error) => onError(errorMessage(error)))
              .finally(() => setDeleted(null));
          }}
          onClose={() => setDeleted(null)}
        />
      ) : null}
    </section>
  );
}
