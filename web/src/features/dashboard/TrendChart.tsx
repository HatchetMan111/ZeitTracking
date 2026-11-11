import { fmtDuration } from "../../lib/time";

export function TrendChart({ points }: { points: { label: string; minutes: number }[] }) {
  const width = 640;
  const height = 180;
  const pad = 8;
  const max = Math.max(1, ...points.map((point) => point.minutes));
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const x = (index: number) =>
    points.length === 1 ? width / 2 : pad + index * step;
  const y = (minutes: number) =>
    height - pad - (minutes / max) * (height - pad * 2);
  const coords = points.map((point, index) => `${x(index)},${y(point.minutes)}`);
  const line = coords.join(" ");
  const area = points.length
    ? `${x(0)},${height} ${line} ${x(points.length - 1)},${height}`
    : `0,${height} ${width},${height}`;

  return (
    <figure className="trend" data-testid="trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Zeitverlauf">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0A84FF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#trend-fill)" />
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
        {points.length === 1 ? (
          <circle cx={x(0)} cy={y(points[0].minutes)} r={4} fill="var(--accent)" />
        ) : null}
      </svg>
      <figcaption>
        <span>{points[0]?.label}</span>
        <span>{points.length === 0 ? "keine Daten" : `max. ${fmtDuration(max)}`}</span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}
