import type { StatRow } from "../../api/types";
import { fmtDuration } from "../../lib/time";

export function TopCategories({ rows }: { rows: StatRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.minutes));
  return (
    <ol className="top-categories">
      {rows.slice(0, 5).map((row) => (
        <li key={row.key}>
          <span>{row.label}</span>
          <i style={{ width: `${(row.minutes / max) * 100}%`, background: row.color }} />
          <b>{fmtDuration(row.minutes)}</b>
        </li>
      ))}
    </ol>
  );
}
