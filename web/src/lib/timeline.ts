export const SNAP_MS = 5 * 60000;

export function snapMs(ms: number, origin: number): number {
  return origin + Math.round((ms - origin) / SNAP_MS) * SNAP_MS;
}

export function clampRange(
  start: number,
  end: number,
  dayStart: number,
  dayEnd: number,
): { start: number; end: number } {
  const latestStart = dayEnd - SNAP_MS;
  const clampedStart = Math.max(dayStart, Math.min(snapMs(start, dayStart), latestStart));
  const clampedEnd = Math.max(
    clampedStart + SNAP_MS,
    Math.min(snapMs(end, dayStart), dayEnd),
  );
  return { start: clampedStart, end: clampedEnd };
}

export function msToY(ms: number, dayStart: number, pxPerHour: number): number {
  return ((ms - dayStart) / 3600000) * pxPerHour;
}

export function yToMs(y: number, dayStart: number, pxPerHour: number): number {
  return dayStart + (y / pxPerHour) * 3600000;
}
