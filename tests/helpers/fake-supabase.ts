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
  private seq = 0;

  constructor(seed: SeedTables = {}) {
    for (const [name, rows] of Object.entries(seed)) this.tables[name] = clone(rows);
  }

  rows(name: string): Row[] {
    if (!this.tables[name]) this.tables[name] = [];
    return this.tables[name];
  }

  /** Deterministic surrogate key so assertions can name ids (`animales-1`). */
  nextId(table: string): string {
    return `${table}-${++this.seq}`;
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

class Builder implements PromiseLike<Result> {
  private filters: [string, any][] = [];
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

  // Ordering is not simulated: seed rows in the order the test expects to read them.
  order(_column: string, _opts?: Record<string, unknown>): this {
    return this;
  }

  limit(_n: number): this {
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

  private matches = (row: Row): boolean => this.filters.every(([c, v]) => row[c] === v);

  private exec(): Result {
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

    return this.wrap(table.filter(this.matches));
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
