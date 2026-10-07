/**
 * Small date helpers. Dates are stored as local-time ISO strings
 * (e.g. "2026-10-06T08:00:00"), matching the format restaurant staff
 * would type in a restock request.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const pad = (n) => String(n).padStart(2, '0');

/** Format a Date as a local ISO string without timezone: YYYY-MM-DDTHH:mm:ss */
function toLocalISO(date) {
  const d = new Date(date);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * Return a local ISO string for `days` days away from `base`, at a given time of day.
 * Example: atDayOffset(today, -2, '08:00:00') -> two days ago at 8 AM.
 */
function atDayOffset(base, days, time = '00:00:00') {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  const [h, m, s] = time.split(':').map(Number);
  d.setHours(h, m, s, 0);
  return toLocalISO(d);
}

/** True if the value can be parsed into a real date. */
function isValidDate(value) {
  if (value === undefined || value === null || value === '') return false;
  return !Number.isNaN(new Date(value).getTime());
}

module.exports = { HOUR_MS, DAY_MS, toLocalISO, atDayOffset, isValidDate };
