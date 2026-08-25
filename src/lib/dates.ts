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

// ---------------------------------------------------------------------
// Instantes en hora de finca
//
// Lo de arriba son fechas de CALENDARIO. Esto es lo otro: un instante UTC
// (`created_at`) mostrado en la hora que el operario tenía en el reloj. Sigue
// valiendo la regla — el instante se GUARDA en UTC y nunca pasa por today() —
// pero para pintarlo hay que traducirlo, y sin esto cada pantalla improvisaría
// su propio `toLocaleString`, que en el servidor corre en UTC y mostraría las
// 6:42 de la mañana como las 11:42.
// ---------------------------------------------------------------------

const farmClock = new Intl.DateTimeFormat('es-CO', {
  timeZone: FARM_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const farmStamp = new Intl.DateTimeFormat('es-CO', {
  timeZone: FARM_TIMEZONE,
  day: '2-digit',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** Hora de finca de un instante ISO, p. ej. "6:42 a. m.". */
export const horaEnFinca = (iso: string): string => farmClock.format(new Date(iso));

/** Fecha corta + hora de finca, p. ej. "24 ago, 6:42 a. m.". */
export const selloEnFinca = (iso: string): string => farmStamp.format(new Date(iso));

export type Ordeno = 'manana' | 'tarde';

export const ORDENO_LABEL: Record<Ordeno, string> = {
  manana: 'Mañana',
  tarde: 'Tarde',
};

/**
 * Qué ordeño proponer según la hora de la finca.
 *
 * Antes del mediodía, mañana. Es una sugerencia para que el operario no tenga
 * que tocar nada en el caso normal — el selector sigue estando y manda él, que
 * es lo que permite registrar la mañana a las 2 de la tarde cuando hubo que
 * salir a arreglar una cerca.
 */
export function ordenoSugerido(): Ordeno {
  const hora = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: FARM_TIMEZONE,
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  );
  return hora < 12 ? 'manana' : 'tarde';
}
