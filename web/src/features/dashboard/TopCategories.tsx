import type { StatRow } from "../../api/types";
import { fmtDuration } from "../../lib/time";

export function TopCategories({ rows }: { rows: StatRow[] }) {
  const sorted = [...rows].sort((a, b) => b.minutes - a.minutes);
  const max = Math.max(1, ...sorted.map((row) => row.minutes));
  return (
    <ol className="top-categories">
      {sorted.slice(0, 5).map((row) => (
        <li key={row.key}>
          <span>{row.label}</span>
          <i style={{ width: `${(row.minutes / max) * 100}%`, background: row.color }} />
          <b>{fmtDuration(row.minutes)}</b>
        </li>
      ))}
    </ol>
  );
}
