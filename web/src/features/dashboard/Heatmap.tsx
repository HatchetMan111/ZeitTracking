import type { DayPoint } from "../../api/types";
import { heatLevel, heatmapWeeks } from "../../lib/charts";
import { fmtDuration } from "../../lib/time";

export function Heatmap({ days }: { days: DayPoint[] }) {
  const weeks = heatmapWeeks(days);
  return (
    <div className="heatmap-block">
      <div
        className="heatmap"
        data-testid="heatmap"
        role="img"
        aria-label="Aktivität der letzten 365 Tage"
      >
        {weeks.map((week) => (
          <div className="heat-week" key={week[0].date}>
            {week.map((day) => (
              <span
                key={day.date}
                className={`heat heat-${heatLevel(day.minutes)}`}
                title={`${day.date}: ${fmtDuration(day.minutes)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heat-legend">
        <span>wenig</span>
        <i className="hl hl-0" />
        <i className="hl hl-1" />
        <i className="hl hl-2" />
        <i className="hl hl-3" />
        <i className="hl hl-4" />
        <span>viel</span>
      </div>
    </div>
  );
}
