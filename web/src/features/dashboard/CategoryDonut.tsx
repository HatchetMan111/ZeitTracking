import type { StatRow } from "../../api/types";
import { percentages } from "../../lib/charts";
import { fmtDuration } from "../../lib/time";

export function CategoryDonut({ rows, total }: { rows: StatRow[]; total: number }) {
  const sum = rows.reduce((acc, row) => acc + row.minutes, 0);
  const denom = sum > 0 ? sum : total;
  const parts = percentages(rows.map((row) => row.minutes));
  const size = 220;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut" data-testid="donut">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Kategorien, ${fmtDuration(denom)}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--panel-2)" strokeWidth={stroke} />
        {rows.map((row) => {
          const length = denom > 0 ? (row.minutes / denom) * circumference : 0;
          const element = (
            <circle
              key={row.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={row.color}
              strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += length;
          return element;
        })}
      </svg>
      <div className="donut-center">
        <strong>{fmtDuration(denom)}</strong>
        <span>gesamt</span>
      </div>
      <ul className="legend">
        {rows.map((row, index) => (
          <li key={row.key}>
            <span className="dot" style={{ background: row.color }} />
            <span>{row.label}</span>
            <b>{fmtDuration(row.minutes)}</b>
            <em>{parts[index].toFixed(1)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
