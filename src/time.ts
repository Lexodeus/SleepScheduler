/** Days ahead the date picker offers, counting today as 0 */
export const DAYS_AHEAD = 30;

/** Picker values for a date and a time of day, in 12-hour form like the Steam clock. */
export interface DateTime {
  day: number; // days from today, 0 = today
  hour: number; // 1-12
  minute: number; // 0-59
  pm: boolean;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Calendar days from today to the given date (DST-safe). */
function daysFromToday(date: Date, now: Date) {
  return Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86400000);
}

export function toDateTime(at: number, now = new Date()): DateTime {
  const date = new Date(at * 1000);
  const h = date.getHours();
  return { day: Math.max(0, daysFromToday(date, now)), hour: h % 12 || 12, minute: date.getMinutes(), pm: h >= 12 };
}

function rawTime(value: DateTime, now: Date): number {
  const date = new Date(now);
  date.setDate(date.getDate() + value.day);
  date.setHours((value.hour % 12) + (value.pm ? 12 : 0), value.minute, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

/** Today's date with a time that has already passed means tomorrow. */
export function normalize(value: DateTime, now = new Date()): DateTime {
  if (value.day === 0 && rawTime(value, now) <= Math.floor(now.getTime() / 1000)) return { ...value, day: 1 };
  return value;
}

/** Unix time (seconds) for the picked date and time. */
export function toUnix(value: DateTime, now = new Date()): number {
  return rawTime(normalize(value, now), now);
}

/** A starting point for a new event: today, 30 minutes from now, rounded up to 5 minutes. */
export function defaultDateTime(now = new Date()): DateTime {
  const date = new Date(now.getTime() + 30 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  return toDateTime(Math.floor(date.getTime() / 1000), now);
}

export function dayOptions(now = new Date()) {
  return Array.from({ length: DAYS_AHEAD }, (_, day) => {
    const date = new Date(now);
    date.setDate(date.getDate() + day);
    const short = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const label = day === 0 ? `Today, ${short}` : day === 1 ? `Tomorrow, ${short}` : short;
    return { data: day, label };
  });
}

export function formatClock(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDay(at: number, now: number): string {
  const day = daysFromToday(new Date(at * 1000), new Date(now * 1000));
  if (day === 0) return "Today";
  if (day === 1) return "Tomorrow";
  return new Date(at * 1000).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/** "in 2d 3h", "in 2h 14m", "in 9m 05s", "in 40s" */
export function formatRelative(at: number, now: number): string {
  const total = Math.max(0, Math.round(at - now));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (total === 0) return "now";
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m ${String(s).padStart(2, "0")}s`;
  return `in ${s}s`;
}
