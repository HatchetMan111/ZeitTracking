import type { DayPoint } from "../../api/types";
import { heatLevel, heatmapWeeks } from "../../lib/charts";
import { fmtDuration } from "../../lib/time";

export function Heatmap({ days }: { days: DayPoint[] }) {
  const weeks = heatmapWeeks(days);
  const firstReal = days[0]?.date;
  const lastReal = days[days.length - 1]?.date;
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
            {week.map((day) => {
              const fill =
                !firstReal || !lastReal || day.date < firstReal || day.date > lastReal;
              return (
                <span
                  key={day.date}
                  className={`heat ${fill ? "heat-fill" : `heat-${heatLevel(day.minutes)}`}`}
                  title={fill ? undefined : `${day.date}: ${fmtDuration(day.minutes)}`}
                  aria-hidden={fill ? "true" : undefined}
                />
              );
            })}
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
