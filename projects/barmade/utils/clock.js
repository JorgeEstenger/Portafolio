/**
 * Central clock for the application.
 *
 * Every piece of code that needs "the current time" (expiration checks,
 * timestamps, mock data generation) calls clock.now() instead of new Date().
 * That lets tests (or a demo) freeze time in one place:
 *
 *   - Tests call setNow('2026-10-06T12:00:00').
 *   - A demo can start the server with MOCK_NOW=2026-10-06T12:00:00.
 */

let frozenNow = null;

function now() {
  if (frozenNow) return new Date(frozenNow);
  if (process.env.MOCK_NOW) return new Date(process.env.MOCK_NOW);
  return new Date();
}

/** Freeze the clock at a given date. Pass null to return to real time. */
function setNow(date) {
  frozenNow = date ? new Date(date) : null;
}

module.exports = { now, setNow };
