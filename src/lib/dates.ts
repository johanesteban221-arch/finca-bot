// Single source of truth for calendar dates.
//
// The farm operates on Colombian time (America/Bogota, UTC-5, no DST) while the
// container runs in UTC. A naive `new Date().toISOString().slice(0, 10)` therefore
// rolls the date over at 7 PM local — precisely when the afternoon ordeño and
// evening health events get recorded, stamping them a day into the future.
//
// Two rules keep this correct:
//   1. "What day is it on the farm?" always goes through `today()`.
//   2. Day arithmetic runs on the YYYY-MM-DD string via UTC midnight, never by
//      mutating a wall-clock Date. Mixing local getters (`setDate`/`getDate`) with
//      UTC serialization (`toISOString`) is what produced the original off-by-one.
//
// Timestamps that answer "when did this happen" — `whatsapp_sessions.updated_at`,
// the backup's `generated_at` — are instants, not calendar days, and correctly
// stay as UTC ISO strings. Do not route those through here.

export const FARM_TIMEZONE = 'America/Bogota';

// 'en-CA' formats as YYYY-MM-DD, exactly the shape a Postgres `date` column wants.
const farmDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: FARM_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date on the farm, as YYYY-MM-DD. */
export const today = (): string => farmDate.format(new Date());

// Accepts a plain date or a full timestamp; only the calendar part is used.
const utcMidnight = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** `n` days from an ISO date, as YYYY-MM-DD. Negative `n` goes back. */
export function shiftDate(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  // Date.UTC normalizes overflow (day 94 lands in the right month) with no
  // timezone offset in play, because both ends of the round trip are UTC.
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** `n` days from today on the farm, as YYYY-MM-DD. Negative `n` goes back. */
export const addDays = (n: number): string => shiftDate(today(), n);

/** Whole days from ISO date `a` to ISO date `b`. Negative when `b` precedes `a`. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((utcMidnight(b) - utcMidnight(a)) / 86_400_000);
