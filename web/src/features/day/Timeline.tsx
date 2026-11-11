import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DayPayload, Entry } from "../../api/types";
import { fmtClock } from "../../lib/time";
import { clampRange, msToY, yToMs } from "../../lib/timeline";

const PX_PER_HOUR = 56;

type DragMode = "move" | "start" | "end";

type Drag = {
  entry: Entry;
  mode: DragMode;
  start: number;
  end: number;
};

type DragBase = {
  entry: Entry;
  mode: DragMode;
  originY: number;
  start: number;
  end: number;
};

export function Timeline({
  day,
  now,
  timezone,
  onOpen,
  onPatch,
  onDelete,
  onCreate,
}: {
  day: DayPayload;
  now: number;
  timezone: string;
  onOpen: (entry: Entry) => void;
  onPatch: (id: number, range: { started_at: number; ended_at: number }) => void;
  onDelete: (entry: Entry) => void;
  onCreate: (startedAt: number, endedAt: number) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const baseRef = useRef<DragBase | null>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const base = baseRef.current;
      if (!base) return;
      const delta = ((event.clientY - base.originY) / PX_PER_HOUR) * 3600000;
      let next;
      if (base.mode === "move") {
        next = clampRange(base.start + delta, base.end + delta, day.start_ms, day.end_ms);
      } else if (base.mode === "start") {
        next = clampRange(base.start + delta, base.end, day.start_ms, day.end_ms);
      } else {
        next = clampRange(base.start, base.end + delta, day.start_ms, day.end_ms);
      }
      const current: Drag = {
        entry: base.entry,
        mode: base.mode,
        start: next.start,
        end: next.end,
      };
      dragRef.current = current;
      setDrag(current);
    };
    const finish = (commit: boolean) => {
      const base = baseRef.current;
      const current = dragRef.current;
      baseRef.current = null;
      dragRef.current = null;
      if (!base || !current) {
        suppressClickRef.current = false;
        setDrag(null);
        return;
      }
      const changed = current.start !== base.start || current.end !== base.end;
      if (commit && changed) {
        onPatch(base.entry.id, { started_at: current.start, ended_at: current.end });
      }
      suppressClickRef.current = commit && changed;
      setDrag(null);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", cancel, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [drag, day, onPatch]);

  function beginDrag(entry: Entry, mode: DragMode, originY: number) {
    if (entry.ended_at === null) return;
    suppressClickRef.current = false;
    const base: DragBase = {
      entry,
      mode,
      originY,
      start: entry.started_at,
      end: entry.effective_end,
    };
    baseRef.current = base;
    const current: Drag = {
      entry,
      mode,
      start: base.start,
      end: base.end,
    };
    dragRef.current = current;
    setDrag(current);
  }

  return (
    <div className="timeline" style={{ height: 24 * PX_PER_HOUR }} ref={trackRef}>
      {Array.from({ length: 24 }, (_, hour) => (
        <div key={hour} className="hour" style={{ top: hour * PX_PER_HOUR }}>
          <span>{fmtClock(day.start_ms + hour * 3600000, timezone)}</span>
        </div>
      ))}
      <div
        className="now-line"
        style={{ top: msToY(now, day.start_ms, PX_PER_HOUR) }}
        aria-hidden="true"
      />
      {day.entries
        .filter((entry) => entry.kind === "timeline")
        .map((entry) => {
          const active = drag?.entry.id === entry.id ? drag : null;
          const start = active?.start ?? entry.started_at;
          const end = active?.end ?? entry.effective_end;
          const top = msToY(start, day.start_ms, PX_PER_HOUR);
          const height = Math.max(6, msToY(end, day.start_ms, PX_PER_HOUR) - top);
          return (
            <button
              key={entry.id}
              type="button"
              data-testid={`timeline-block-${entry.id}`}
              className="block"
              style={{ top, height, "--block": entry.category_color ?? "#0A84FF" } as CSSProperties}
              onPointerDown={(event) => {
                if (entry.ended_at === null) return;
                event.preventDefault();
                beginDrag(entry, "move", event.clientY);
              }}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                onOpen(entry);
              }}
              onKeyDown={(event) => {
                if (entry.ended_at === null) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(entry);
                } else if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  onDelete(entry);
                } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const step = (event.shiftKey ? 30 : 5) * 60000;
                  const delta = event.key === "ArrowUp" ? -step : step;
                  const next = clampRange(
                    entry.started_at + delta,
                    entry.effective_end + delta,
                    day.start_ms,
                    day.end_ms,
                  );
                  onPatch(entry.id, { started_at: next.start, ended_at: next.end });
                }
              }}
              aria-label={`${entry.category_name}, ${fmtClock(entry.started_at, timezone)}`}
            >
              <span>{entry.category_name}</span>
              {entry.note ? <em>{entry.note}</em> : null}
              {entry.ended_at !== null ? (
                <>
                  <i className="handle top" onPointerDown={(event) => {
                    event.stopPropagation();
                    beginDrag(entry, "start", event.clientY);
                  }} />
                  <i className="handle bottom" onPointerDown={(event) => {
                    event.stopPropagation();
                    beginDrag(entry, "end", event.clientY);
                  }} />
                </>
              ) : null}
            </button>
          );
        })}
      <div
        className="timeline-create"
        onClick={(event) => {
          const rect = trackRef.current?.getBoundingClientRect();
          if (!rect) return;
          const raw = yToMs(event.clientY - rect.top, day.start_ms, PX_PER_HOUR);
          const start = Math.round(raw / (15 * 60000)) * 15 * 60000;
          const range = clampRange(start, start + 30 * 60000, day.start_ms, day.end_ms);
          onCreate(range.start, range.end);
        }}
      />
    </div>
  );
}
