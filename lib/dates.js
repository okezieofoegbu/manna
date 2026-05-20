// =============================================================================
// Manna — dates
// =============================================================================
// "Today" must always mean the owner's local day, never UTC. The devotional
// auto-generates on the first page load of a new day, and the "is there
// already a devotional for today?" check must use the owner's calendar day.
// (From v0.1.5 the Cron job will need the same care — Vercel Cron runs in UTC.)
//
// See PITFALLS.md Section 5 ("Dates and the morning job").
// =============================================================================

// The owner's time zone. White Oak, Maryland → America/New_York. Overridable
// via the MANNA_TIMEZONE environment variable if the owner ever relocates.
export const OWNER_TIMEZONE = process.env.MANNA_TIMEZONE || 'America/New_York';

// Returns today's date in the owner's time zone as a 'YYYY-MM-DD' string —
// the exact form a Postgres `date` column expects.
export function ownerToday() {
  // 'en-CA' formats as YYYY-MM-DD, which is what we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OWNER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// A human, long-form rendering of today in the owner's time zone — for the
// page header. e.g. "Tuesday, May 19, 2026".
export function ownerTodayLong() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: OWNER_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}
