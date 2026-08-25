// In-memory stand-in for the Supabase client, covering only the query surface the
// bot actually uses:
//   from().select().eq().order()             -> list
//   from().select().eq().maybeSingle()       -> row | null
//   from().select().in()                     -> list (bulk arete lookup)
//   from().insert().select().single()        -> created row
//   from().update().eq()                     -> patch matching rows
//   from().upsert()                          -> insert-or-merge on the table's PK
//   from().delete().eq()                     -> drop matching rows
//
// Deliberately NOT simulated: column projection (`select('id, arete')` returns the
// whole row) and RLS. Projection is irrelevant to flow logic, and RLS is bypassed in
// production anyway because the app connects with the service_role key.
//
// Rows are JSON-cloned on the way in and out so tests cannot accidentally share
// object identity with the code under test — a real round-trip through Postgres
// serializes, and `temp_data` aliasing bugs only show up when the fake does too.

export type Row = Record<string, any>;
export type SeedTables = Record<string, Row[]>;

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// Conflict target for upsert, per table. Anything not listed appends.
const PRIMARY_KEYS: Record<string, string> = {
  whatsapp_sessions: 'telefono',
  whatsapp_users: 'telefono',
};

// Índices únicos que el fake SÍ hace cumplir, espejo de los de db/.
//
// Se añadieron porque su ausencia escondía dos bugs reales del control lechero:
// sin unicidad, un doble envío duplicaba los litros y el test lo daba por bueno.
// Un fake que acepta lo que Postgres rechaza no es un fake optimista, es un test
// que miente. Cuando una tabla gane un unique en db/, va también aquí.
// PostgREST corta TODA respuesta en `max-rows` — 1000 por defecto en Supabase —
// y no lo dice: llegan 1000 filas con `error: null`, idénticas a si fueran
// todas. Se simula aquí porque sin esto una consulta sin paginar pasa los tests
// y trunca en producción, que es justo el fallo que `paginar()` viene a evitar.
const MAX_FILAS = 1000;

const UNIQUE: Record<string, string[][]> = {
  produccion_leche: [['animal_id', 'fecha', 'ordeno']],       // uq_leche_animal_fecha_ordeno
  // Incluye `tipo`: desde db/07 el total de cantina y el conteo individual del
  // MISMO ordeño conviven, y son dos registros distintos, no un doble envío.
  controles_leche: [['finca_id', 'fecha', 'ordeno', 'tipo']], // uq_control_finca_fecha_ordeno_tipo
  chequeos_reproductivos: [['animal_id', 'fecha']],           // uq_chequeo_animal_fecha
  protocolo_aplicaciones: [['protocolo_id', 'dia_numero']],   // uq_aplicacion_paso
  usuarios: [['email']],
};

/**
 * Mensaje idéntico en forma al de Postgres, porque el código de producción lo
 * inspecciona: domain/leche.ts distingue una violación de unicidad del resto de
 * fallos para poder decirle al operario "ese ordeño ya está registrado" en vez
 * de escupirle un error de base de datos.
 */
const violaUnico = (tabla: string, existentes: Row[], fila: Row): string | null => {
  for (const cols of UNIQUE[tabla] ?? []) {
    if (cols.some((c) => fila[c] === undefined || fila[c] === null)) continue;
    const choca = existentes.some((r) => cols.every((c) => r[c] === fila[c]));
    if (choca) {
      const valores = cols.map((c) => `${c})=(${fila[c]}`).join(', ');
      return `duplicate key value violates unique constraint on ${tabla} (${valores})`;
    }
  }
  return null;
};

export type InsertLog = { table: string; rows: Row[] };
export type UpdateLog = { table: string; patch: Row; filters: [string, any][] };
export type DeleteLog = { table: string; filters: [string, any][]; rows: Row[] };

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  /** Every insert performed, in order — the main assertion target for write tests. */
  readonly inserts: InsertLog[] = [];
  /** Every update performed, in order. */
  readonly updates: UpdateLog[] = [];
  /** Every delete performed, in order — used to assert compensating cleanups. */
  readonly deletes: DeleteLog[] = [];
  /** Tables configured to fail, for exercising error paths. */
  readonly failures = new Map<string, string>();
  private seq = 0;

  constructor(seed: SeedTables = {}) {
    for (const [name, rows] of Object.entries(seed)) this.tables[name] = clone(rows);
  }

  /** Makes every query against `table` return a Supabase error instead of rows. */
  failOn(table: string, message = 'conexión rechazada'): this {
    this.failures.set(table, message);
    return this;
  }

  rows(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  /**
   * Deterministic but validly-shaped uuid. Postgres generates real uuids via
   * gen_random_uuid(), and the domain schemas validate ids as uuid, so a
   * readable fake id like `animales-1` would make the fake diverge from
   * production in a way that hides real failures. The sequence keeps it stable
   * across runs; tests compare ids by reference, not by literal.
   */
  nextId(_table: string): string {
    return `00000000-0000-4000-8000-${(++this.seq).toString(16).padStart(12, '0')}`;
  }

  from(name: string): Builder {
    return new Builder(this, name);
  }

  // ---------- assertion helpers ----------
  insertsInto(table: string): Row[] {
    return this.inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
  }

  updatesTo(table: string): UpdateLog[] {
    return this.updates.filter((u) => u.table === table);
  }

  deletesFrom(table: string): DeleteLog[] {
    return this.deletes.filter((d) => d.table === table);
  }
}

type Result = { data: any; error: { message: string } | null };

// Range/negation filters. Kept separate from the `eq` tuples so UpdateLog keeps
// its simple shape, which tests assert against directly.
type RangeFilter = { op: 'gte' | 'lte' | 'gt' | 'lt' | 'notNull' | 'in'; column: string; value: any };

class Builder implements PromiseLike<Result> {
  private filters: [string, any][] = [];
  private ranges: RangeFilter[] = [];
  private orderBy: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  private ventana: [number, number] | null = null;
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row[] = [];
  private shape: 'list' | 'one' | 'maybe' = 'list';
  private pending: Promise<Result> | null = null;

  constructor(private db: FakeSupabase, private name: string) {}

  // Column projection is not simulated — the whole row comes back.
  select(_columns?: string): this {
    return this;
  }

  eq(column: string, value: any): this {
    this.filters.push([column, value]);
    return this;
  }

  // ISO date strings compare correctly with the relational operators, which is
  // all these are used for (date windows).
  gte(column: string, value: any): this { return this.filtroRango('gte', column, value); }
  lte(column: string, value: any): this { return this.filtroRango('lte', column, value); }
  gt(column: string, value: any): this { return this.filtroRango('gt', column, value); }
  lt(column: string, value: any): this { return this.filtroRango('lt', column, value); }

  /** Bulk membership, as the milk-control lookup uses to resolve many aretes at once. */
  in(column: string, values: any[]): this {
    return this.filtroRango('in', column, values);
  }

  /** Only the `.not(col, 'is', null)` form the alert queries use is supported. */
  not(column: string, operator: string, value: any): this {
    if (operator !== 'is' || value !== null) {
      throw new Error(`fake-supabase: not(${operator}) no está soportado; agrégalo si lo necesitas`);
    }
    return this.filtroRango('notNull', column, null);
  }

  private filtroRango(op: RangeFilter['op'], column: string, value: any): this {
    this.ranges.push({ op, column, value });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy.push({ column, ascending: opts?.ascending !== false });
    return this;
  }

  limit(n: number): this {
    this.max = n;
    return this;
  }

  /**
   * `range(desde, hasta)` de PostgREST, ambos inclusive.
   *
   * Se recorta de verdad, no se ignora: `paginar()` en src/lib/supabase.ts pide
   * otra página según CUÁNTAS filas volvieron, así que un fake que devolviera
   * siempre la tabla entera dejaría el bucle de paginación sin ejercer — y ese
   * bucle existe porque PostgREST trunca en silencio.
   */
  range(desde: number, hasta: number): this {
    this.ventana = [desde, hasta];
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.op = 'insert';
    this.payload = (Array.isArray(rows) ? rows : [rows]).map(clone);
    return this;
  }

  update(patch: Row): this {
    this.op = 'update';
    this.payload = [clone(patch)];
    return this;
  }

  upsert(rows: Row | Row[]): this {
    this.op = 'upsert';
    this.payload = (Array.isArray(rows) ? rows : [rows]).map(clone);
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  maybeSingle(): Promise<Result> {
    this.shape = 'maybe';
    return this.run();
  }

  single(): Promise<Result> {
    this.shape = 'one';
    return this.run();
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: any) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }

  // Guarded so awaiting the same builder twice cannot double-write.
  private run(): Promise<Result> {
    if (!this.pending) this.pending = Promise.resolve(this.exec());
    return this.pending;
  }

  // Resolves `animales.estado_reproductivo` against an embedded resource, the way
  // PostgREST filters on a joined table. Seed such rows with the nested object.
  private valueAt = (row: Row, path: string): any =>
    path.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), row);

  private matches = (row: Row): boolean =>
    this.filters.every(([c, v]) => this.valueAt(row, c) === v) &&
    this.ranges.every(({ op, column, value }) => {
      const cell = this.valueAt(row, column);
      if (op === 'notNull') return cell !== null && cell !== undefined;
      if (op === 'in') return (value as any[]).includes(cell);
      if (cell === null || cell === undefined) return false;
      if (op === 'gte') return cell >= value;
      if (op === 'lte') return cell <= value;
      if (op === 'gt') return cell > value;
      return cell < value;
    });

  private exec(): Result {
    const failure = this.db.failures.get(this.name);
    if (failure) return { data: null, error: { message: failure } };

    const table = this.db.rows(this.name);

    if (this.op === 'insert') {
      // Postgres aborta el INSERT entero al primer conflicto y no deja nada
      // escrito. Se comprueba todo el lote antes de tocar la tabla para que el
      // fake falle igual: a medias sería peor que no fallar.
      const previas = [...table];
      for (const r of this.payload) {
        const choque = violaUnico(this.name, previas, r);
        if (choque) return { data: null, error: { message: choque } };
        previas.push(r);
      }

      const created = this.payload.map((r) => {
        const row = { id: this.db.nextId(this.name), ...r };
        table.push(row);
        return row;
      });
      this.db.inserts.push({ table: this.name, rows: clone(created) });
      return this.wrap(created);
    }

    if (this.op === 'update') {
      const patch = this.payload[0];
      const hit = table.filter(this.matches);
      for (const row of hit) Object.assign(row, clone(patch));
      this.db.updates.push({ table: this.name, patch: clone(patch), filters: [...this.filters] });
      return this.wrap(hit);
    }

    if (this.op === 'delete') {
      const hit = table.filter(this.matches);
      for (const row of hit) table.splice(table.indexOf(row), 1);
      this.db.deletes.push({ table: this.name, filters: [...this.filters], rows: clone(hit) });
      return this.wrap(hit);
    }

    if (this.op === 'upsert') {
      const pk = PRIMARY_KEYS[this.name];
      const written = this.payload.map((r) => {
        const existing = pk ? table.find((row) => row[pk] === r[pk]) : undefined;
        if (existing) {
          Object.assign(existing, r);
          return existing;
        }
        const row = { id: this.db.nextId(this.name), ...r };
        table.push(row);
        return row;
      });
      return this.wrap(written);
    }

    return this.wrap(this.sortAndLimit(table.filter(this.matches)));
  }

  // Ordering matters for the alert queries — they are read in due-date order —
  // so it is simulated rather than left to seed order. Nulls sort last, as in
  // Postgres' default for ascending order.
  private sortAndLimit(rows: Row[]): Row[] {
    const out = rows.slice();
    for (const { column, ascending } of [...this.orderBy].reverse()) {
      out.sort((x, y) => {
        const a = this.valueAt(x, column);
        const b = this.valueAt(y, column);
        if (a === b) return 0;
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;
        return (a < b ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    const ventana = this.ventana ? out.slice(this.ventana[0], this.ventana[1] + 1) : out;
    const limitado = this.max === null ? ventana : ventana.slice(0, this.max);
    return limitado.slice(0, MAX_FILAS);
  }

  private wrap(list: Row[]): Result {
    if (this.shape === 'maybe') return { data: list.length ? clone(list[0]) : null, error: null };
    if (this.shape === 'one') {
      return list.length
        ? { data: clone(list[0]), error: null }
        : { data: null, error: { message: 'No rows found' } };
    }
    return { data: clone(list), error: null };
  }
}
