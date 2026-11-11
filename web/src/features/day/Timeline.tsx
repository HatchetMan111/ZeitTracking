import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DayPayload, Entry } from "../../api/types";
import { fmtClock } from "../../lib/time";
import { clampRange, msToY, yToMs } from "../../lib/timeline";

const PX_PER_HOUR = 56;

type Drag = {
  entry: Entry;
  mode: "move" | "start" | "end";
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

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const delta = ((event.clientY - drag.originY) / PX_PER_HOUR) * 3600000;
      if (drag.mode === "move") {
        const next = clampRange(drag.start + delta, drag.end + delta, day.start_ms, day.end_ms);
        setDrag({ ...drag, start: next.start, end: next.end });
      } else if (drag.mode === "start") {
        const next = clampRange(drag.start + delta, drag.end, day.start_ms, day.end_ms);
        setDrag({ ...drag, start: next.start, end: next.end });
      } else {
        const next = clampRange(drag.start, drag.end + delta, day.start_ms, day.end_ms);
        setDrag({ ...drag, start: next.start, end: next.end });
      }
    };
    const up = () => {
      const changed =
        drag.start !== drag.entry.started_at || drag.end !== drag.entry.effective_end;
      if (changed) {
        onPatch(drag.entry.id, { started_at: drag.start, ended_at: drag.end });
      }
      suppressClickRef.current = changed;
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, day, onPatch]);

  return (
    <div className="timeline" style={{ height: 24 * PX_PER_HOUR }} ref={trackRef}>
      {Array.from({ length: 24 }, (_, hour) => (
        <div key={hour} className="hour" style={{ top: hour * PX_PER_HOUR }}>
          <span>{String(hour).padStart(2, "0")}:00</span>
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
                suppressClickRef.current = false;
                setDrag({
                  entry, mode: "move", originY: event.clientY,
                  start: entry.started_at, end: entry.effective_end,
                });
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
                    suppressClickRef.current = false;
                    setDrag({ entry, mode: "start", originY: event.clientY, start: entry.started_at, end: entry.effective_end });
                  }} />
                  <i className="handle bottom" onPointerDown={(event) => {
                    event.stopPropagation();
                    suppressClickRef.current = false;
                    setDrag({ entry, mode: "end", originY: event.clientY, start: entry.started_at, end: entry.effective_end });
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
