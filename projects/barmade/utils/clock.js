/**
 * Central clock for the application.
 *
 * Every piece of code that needs "the current time" (expiration checks,
 * timestamps, mock data generation) calls clock.now() instead of new Date().
 * That lets tests (or a demo) freeze time in one place:
 *
 *   - Tests call setNow('2026-10-06T12:00:00').
 *   - A demo can start the server with MOCK_NOW=2026-10-06T12:00:00.
 *
 * Demo clock: the 60-day dataset ends at a fixed moment (Day 60, 6:30 PM).
 * After a demo reset the clock starts at that moment and then ticks forward in
 * real time, so live orders always land "right after" the generated history,
 * whatever the real date is. Priority: setNow() > MOCK_NOW > demo clock > real time.
 */

let frozenNow = null;
let demoOffsetMs = null;

function now() {
  if (frozenNow) return new Date(frozenNow);
  if (process.env.MOCK_NOW) return new Date(process.env.MOCK_NOW);
  if (demoOffsetMs !== null) return new Date(Date.now() + demoOffsetMs);
  return new Date();
}

/** Freeze the clock at a given date. Pass null to return to real time. */
function setNow(date) {
  frozenNow = date ? new Date(date) : null;
}

/** Start the ticking demo clock at `date`. Pass null to go back to real time. */
function startDemoClock(date) {
  demoOffsetMs = date ? new Date(date).getTime() - Date.now() : null;
}

module.exports = { now, setNow, startDemoClock };
