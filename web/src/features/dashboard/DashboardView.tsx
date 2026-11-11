import type { DayPoint, StatsPayload, SummaryPayload } from "../../api/types";
import { trendPoints } from "../../lib/charts";
import type { Period, Range } from "../../lib/ranges";
import { CategoryDonut } from "./CategoryDonut";
import { DayTable } from "./DayTable";
import { Heatmap } from "./Heatmap";
import { KpiCards } from "./KpiCards";
import { PeriodPicker } from "./PeriodPicker";
import { TopCategories } from "./TopCategories";
import { TrendChart } from "./TrendChart";

export function DashboardView({
  summary,
  stats,
  heatmap,
  timezone,
  period,
  range,
  onPeriod,
  onExport,
  onGoDay,
}: {
  summary: SummaryPayload;
  stats: StatsPayload;
  heatmap: DayPoint[];
  timezone: string;
  period: Period;
  range: Range;
  onPeriod: (period: Period, custom?: Range) => void;
  onExport: () => void;
  onGoDay: () => void;
}) {
  const points = trendPoints(stats.days, period, stats.days.length);
  return (
    <section className="dashboard">
      <header className="dashboard-head">
        <PeriodPicker period={period} range={range} onPeriod={onPeriod} />
        <button type="button" data-testid="export-csv" onClick={onExport}>
          CSV exportieren
        </button>
      </header>
      {stats.total_minutes === 0 ? (
        <div className="empty">
          <p>Noch keine Zeit im gewählten Zeitraum.</p>
          <button type="button" onClick={onGoDay}>
            Zum Tag
          </button>
        </div>
      ) : (
        <>
          <KpiCards summary={summary} />
          <div className="dashboard-grid">
            <CategoryDonut rows={stats.rows} total={stats.total_minutes} />
            <TopCategories rows={stats.rows} />
          </div>
          <TrendChart points={points} />
          <Heatmap days={heatmap} />
          <DayTable entries={stats.entries} timezone={timezone} />
        </>
      )}
    </section>
  );
}
