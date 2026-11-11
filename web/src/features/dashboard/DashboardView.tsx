import type { StatsPayload, SummaryPayload } from "../../api/types";
import type { Period, Range } from "../../lib/ranges";
import { CategoryDonut } from "./CategoryDonut";
import { KpiCards } from "./KpiCards";
import { PeriodPicker } from "./PeriodPicker";
import { TopCategories } from "./TopCategories";

export function DashboardView({
  summary,
  stats,
  period,
  range,
  onPeriod,
}: {
  summary: SummaryPayload;
  stats: StatsPayload;
  period: Period;
  range: Range;
  onPeriod: (period: Period, custom?: Range) => void;
}) {
  if (stats.total_minutes === 0) {
    return (
      <section className="dashboard">
        <PeriodPicker period={period} range={range} onPeriod={onPeriod} />
        <p className="empty">Noch keine Zeit im gewählten Zeitraum.</p>
      </section>
    );
  }
  return (
    <section className="dashboard">
      <PeriodPicker period={period} range={range} onPeriod={onPeriod} />
      <KpiCards summary={summary} />
      <CategoryDonut rows={stats.rows} total={stats.total_minutes} />
      <TopCategories rows={stats.rows} />
    </section>
  );
}
