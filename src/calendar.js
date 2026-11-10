// Date-only values stay date-only; UTC is used for arithmetic, not service times.
export function dateFromKey(key) {
  return new Date(`${key}T12:00:00Z`);
}
export function addDays(key, count) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function monthFromKey(key) {
  return `${key.slice(0, 7)}-01`;
}
export function moveMonth(key, step) {
  const date = dateFromKey(key);
  date.setUTCMonth(date.getUTCMonth() + step);
  return date.toISOString().slice(0, 10);
}
export function dayLabel(
  key,
  options = { weekday: "long", month: "long", day: "numeric" },
) {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(dateFromKey(key));
}
export function timeLabel(instant, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(instant));
}
export function slotLabel(slot, timezone) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(slot.starts_at));
}
export function calendarCells(month, today, lastDate, slots) {
  const first = dateFromKey(month);
  const days = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const available = new Set(slots.map((slot) => slot.day));
  return [
    ...Array.from({ length: first.getUTCDay() }, () => null),
    ...Array.from({ length: days }, (_, i) => {
      const key = addDays(month, i);
      return {
        key,
        day: i + 1,
        available: key >= today && key <= lastDate && available.has(key),
      };
    }),
  ];
}
