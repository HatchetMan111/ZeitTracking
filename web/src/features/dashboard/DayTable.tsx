import type { StatsEntry } from "../../api/types";
import { fmtClock, fmtDuration, localDateStr } from "../../lib/time";

export function DayTable({ entries, timezone }: { entries: StatsEntry[]; timezone: string }) {
  if (entries.length === 0) {
    return <p className="empty">Noch keine Einträge im gewählten Zeitraum.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="day-table" data-testid="day-table">
        <thead>
          <tr>
            <th>Tag</th>
            <th>Zeit</th>
            <th>Kategorie</th>
            <th>Detail</th>
            <th>Dauer</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{localDateStr(entry.started_at, timezone)}</td>
              <td>
                {fmtClock(entry.started_at, timezone)}–{fmtClock(entry.effective_end, timezone)}
              </td>
              <td>
                <span className="dot" style={{ background: entry.color }} />
                {entry.label}
              </td>
              <td className="detail-cell" title={entry.note}>{entry.note || "–"}</td>
              <td>{fmtDuration(entry.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
