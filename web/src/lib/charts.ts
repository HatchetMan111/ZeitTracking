import type { DayPoint } from "../api/types";
import { addDays, type Period } from "./ranges";

export function percentages(values: number[], decimals = 1): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const factor = 10 ** decimals;
  const raw = values.map((value) => (value / total) * 100 * factor);
  const floors = raw.map(Math.floor);
  const missing = Math.round(100 * factor) - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < missing; index += 1) {
    floors[order[index % order.length].index] += 1;
  }
  return floors.map((value) => value / factor);
}

export function heatLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  if (minutes < 120) return 3;
  return 4;
}

export function trendPoints(
  days: DayPoint[],
  period: Period,
  spanDays: number,
): { label: string; minutes: number }[] {
  if (period !== "year" && !(period === "custom" && spanDays > 62)) {
    return days.map((day) => ({ label: day.date.slice(5), minutes: day.minutes }));
  }
  const months = new Map<string, number>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + day.minutes);
  }
  return [...months.entries()].map(([label, minutes]) => ({ label, minutes }));
}

export function heatmapWeeks(days: DayPoint[]): DayPoint[][] {
  if (days.length === 0) return [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const anchor = new Date(`${days[0].date}T12:00:00Z`);
  let cursor = addDays(days[0].date, -((anchor.getUTCDay() + 6) % 7));
  const last = days[days.length - 1].date;
  const weeks: DayPoint[][] = [];
  let week: DayPoint[] = [];
  while (cursor <= last) {
    week.push(byDate.get(cursor) ?? { date: cursor, minutes: 0 });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
    cursor = addDays(cursor, 1);
  }
  while (week.length > 0 && week.length < 7) {
    week.push({ date: cursor, minutes: 0 });
    cursor = addDays(cursor, 1);
  }
  if (week.length > 0) weeks.push(week);
  return weeks;
}
