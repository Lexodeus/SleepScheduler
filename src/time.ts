/** Picker value for a time of day, in 12-hour form like the Steam clock. */
export interface TimeOfDay {
  hour: number; // 1-12
  minute: number; // 0-59
  pm: boolean;
}

export function toTimeOfDay(date: Date): TimeOfDay {
  const h = date.getHours();
  return { hour: h % 12 || 12, minute: date.getMinutes(), pm: h >= 12 };
}

/** Unix time (seconds) of the next time the clock shows this time: today if it's still ahead, otherwise tomorrow. */
export function nextOccurrence(time: TimeOfDay, now = new Date()): number {
  const date = new Date(now);
  date.setHours((time.hour % 12) + (time.pm ? 12 : 0), time.minute, 0, 0);
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  return Math.floor(date.getTime() / 1000);
}

/** A starting time for a new event: 30 minutes from now, rounded up to 5 minutes. */
export function defaultTime(): TimeOfDay {
  const date = new Date(Date.now() + 30 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  return toTimeOfDay(date);
}

export function formatClock(at: number): string {
  return new Date(at * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatDay(at: number, now: number): string {
  const day = new Date(at * 1000);
  const today = new Date(now * 1000);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (day.toDateString() === today.toDateString()) return "Today";
  if (day.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return day.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

/** "in 2h 14m", "in 9m 05s", "in 40s" */
export function formatRelative(at: number, now: number): string {
  const total = Math.max(0, Math.round(at - now));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (total === 0) return "now";
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m ${String(s).padStart(2, "0")}s`;
  return `in ${s}s`;
}
