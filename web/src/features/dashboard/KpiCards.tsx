import type { SummaryPayload } from "../../api/types";
import { fmtDuration } from "../../lib/time";

export function KpiCards({ summary }: { summary: SummaryPayload }) {
  const items = [
    ["today", "Heute", summary.totals.today_minutes],
    ["week", "Woche", summary.totals.week_minutes],
    ["month", "Monat", summary.totals.month_minutes],
    ["all", "Gesamt", summary.totals.all_minutes],
  ] as const;
  return (
    <div className="kpis">
      {items.map(([id, label, minutes]) => (
        <article key={id} data-testid={`kpi-${id}`}>
          <span>{label}</span>
          <strong>{fmtDuration(minutes)}</strong>
        </article>
      ))}
    </div>
  );
}
