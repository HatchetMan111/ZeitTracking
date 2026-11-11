export type Period = "week" | "month" | "year" | "custom";
export type Range = { from: string; to: string };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const noon = (value: string) => new Date(`${value}T12:00:00Z`);

export function addDays(date: string, days: number): string {
  const value = noon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return iso(value);
}

export function periodRange(period: Period, anchor: string, custom?: Range): Range {
  const date = noon(anchor);
  if (period === "week") {
    const offset = (date.getUTCDay() + 6) % 7;
    const from = addDays(anchor, -offset);
    return { from, to: addDays(from, 6) };
  }
  if (period === "month") {
    const from = `${anchor.slice(0, 7)}-01`;
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    return { from, to: iso(last) };
  }
  if (period === "year") {
    return { from: `${date.getUTCFullYear()}-01-01`, to: `${date.getUTCFullYear()}-12-31` };
  }
  if (!custom) throw new Error("Eigener Zeitraum fehlt");
  if (custom.to < custom.from) throw new Error("Das Enddatum liegt vor dem Startdatum");
  return custom;
}
