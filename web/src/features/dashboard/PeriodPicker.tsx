import type { Period, Range } from "../../lib/ranges";

export function PeriodPicker({
  period,
  range,
  onPeriod,
}: {
  period: Period;
  range: Range;
  onPeriod: (period: Period, custom?: Range) => void;
}) {
  const emitCustom = (next: Range) => {
    if (!next.from || !next.to) return;
    onPeriod("custom", next);
  };

  return (
    <div className="period-picker">
      {(["week", "month", "year"] as const).map((value) => (
        <button
          key={value}
          type="button"
          data-testid={`period-${value}`}
          aria-pressed={period === value}
          onClick={() => onPeriod(value, undefined)}
        >
          {value === "week" ? "Woche" : value === "month" ? "Monat" : "Jahr"}
        </button>
      ))}
      <label>
        Von
        <input
          type="date"
          value={range.from}
          onChange={(event) => emitCustom({ from: event.target.value, to: range.to })}
        />
      </label>
      <label>
        Bis
        <input
          type="date"
          value={range.to}
          onChange={(event) => emitCustom({ from: range.from, to: event.target.value })}
        />
      </label>
    </div>
  );
}
