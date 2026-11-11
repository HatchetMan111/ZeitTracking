import type { CSSProperties } from "react";
import type { Category } from "../../api/types";
import { fmtDuration } from "../../lib/time";

export function TimerChips({
  categories,
  runningId,
  runningMinutes,
  onStart,
  onStop,
}: {
  categories: Category[];
  runningId: number | null;
  runningMinutes: number;
  onStart: (id: number) => void;
  onStop: () => void;
}) {
  return (
    <div className="chips" role="list">
      {categories.map((category) => {
        const running = category.id === runningId;
        return (
          <button
            key={category.id}
            type="button"
            role="listitem"
            data-testid={`timer-chip-${category.id}`}
            className={running ? "chip running" : "chip"}
            style={{ "--chip": category.color } as CSSProperties}
            onClick={() => (running ? onStop() : onStart(category.id))}
          >
            <span className="dot" aria-hidden="true" />
            {category.name}
            {running ? <b>{fmtDuration(runningMinutes)}</b> : null}
          </button>
        );
      })}
    </div>
  );
}
