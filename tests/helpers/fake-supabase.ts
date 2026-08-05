// In-memory stand-in for the Supabase client, covering only the query surface the
// bot actually uses:
//   from().select().eq().order()             -> list
//   from().select().eq().maybeSingle()       -> row | null
//   from().insert().select().single()        -> created row
//   from().update().eq()                     -> patch matching rows
//   from().upsert()                          -> insert-or-merge on the table's PK
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

export type InsertLog = { table: string; rows: Row[] };
export type UpdateLog = { table: string; patch: Row; filters: [string, any][] };

export class FakeSupabase {
  readonly tables: Record<string, Row[]> = {};
  /** Every insert performed, in order — the main assertion target for write tests. */
  readonly inserts: InsertLog[] = [];
  /** Every update performed, in order. */
  readonly updates: UpdateLog[] = [];
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
}

type Result = { data: any; error: { message: string } | null };

// Range/negation filters. Kept separate from the `eq` tuples so UpdateLog keeps
// its simple shape, which tests assert against directly.
type RangeFilter = { op: 'gte' | 'lte' | 'gt' | 'lt' | 'notNull'; column: string; value: any };

class Builder implements PromiseLike<Result> {
  private filters: [string, any][] = [];
  private ranges: RangeFilter[] = [];
  private orderBy: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
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
  gte(column: string, value: any): this { return this.range('gte', column, value); }
  lte(column: string, value: any): this { return this.range('lte', column, value); }
  gt(column: string, value: any): this { return this.range('gt', column, value); }
  lt(column: string, value: any): this { return this.range('lt', column, value); }

  /** Only the `.not(col, 'is', null)` form the alert queries use is supported. */
  not(column: string, operator: string, value: any): this {
    if (operator !== 'is' || value !== null) {
      throw new Error(`fake-supabase: not(${operator}) no está soportado; agrégalo si lo necesitas`);
    }
    return this.range('notNull', column, null);
  }

  private range(op: RangeFilter['op'], column: string, value: any): this {
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
    return this.max === null ? out : out.slice(0, this.max);
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
