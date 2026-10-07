/**
 * Restaurant timezone helpers.
 *
 * Timestamps are stored in UTC (ISO strings ending in "Z"). Reports group
 * orders by the restaurant's *business date*: the calendar date in the
 * restaurant's timezone (config.restaurant.timezone, America/New_York by default).
 *
 * Business dates are plain 'YYYY-MM-DD' strings so they compare and sort as text.
 */

const config = require('../config');

const DAY_MS = 24 * 60 * 60 * 1000;
const formatters = new Map();

function getFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return formatters.get(timeZone);
}

/** Wall-clock parts of `date` in a timezone: { year, month, day, hour, minute, second }. */
function zonedParts(date, timeZone = config.restaurant.timezone) {
  const parts = {};
  for (const { type, value } of getFormatter(timeZone).formatToParts(new Date(date))) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

/** Offset of the timezone from UTC at `date`, in ms (New York in summer: -4h). */
function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(new Date(date).getTime() / 1000) * 1000;
}

/**
 * Convert a local wall-clock time in the restaurant timezone to a UTC Date.
 * zonedToUtc('2026-10-07', '18:30') -> 2026-10-07T22:30:00.000Z
 */
function zonedToUtc(businessDate, time = '00:00:00', timeZone = config.restaurant.timezone) {
  const [y, m, d] = businessDate.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let result = guess - offsetMs(guess, timeZone);
  // Re-check once in case the guess and the result fall on different sides of a DST change.
  result = guess - offsetMs(result, timeZone);
  return new Date(result);
}

const pad = (n) => String(n).padStart(2, '0');

/** Restaurant business date ('YYYY-MM-DD') of a timestamp. */
function businessDate(date, timeZone = config.restaurant.timezone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local time of day in the restaurant as 'HH:mm'. */
function localTime(date, timeZone = config.restaurant.timezone) {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Add whole days to a 'YYYY-MM-DD' string. */
function addDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday for a 'YYYY-MM-DD' string. */
function weekdayOf(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Whole days from one 'YYYY-MM-DD' to another (can be negative). */
function daysBetween(from, to) {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / DAY_MS);
}

const isBusinessDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

module.exports = {
  DAY_MS, WEEKDAY_NAMES, zonedParts, zonedToUtc, businessDate, localTime,
  addDays, weekdayOf, daysBetween, isBusinessDate,
};
