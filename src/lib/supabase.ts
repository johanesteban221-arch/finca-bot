import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy singleton: the client is created on first use (request time), not at
// import/build time — so `next build` never depends on env vars being present.
let _client: SupabaseClient | null = null;

function client(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _client;
}

// Transparent proxy so callers keep using `supabase.from(...)` unchanged.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = client() as any;
    const value = c[prop];
    return typeof value === 'function' ? value.bind(c) : value;
  },
});

export type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

// supabase-js reports failures in `error` instead of throwing, so the common
// `data || []` idiom turns a broken query into a convincing empty result: a
// dashboard showing an empty herd, or a 6 AM alert claiming nothing is pending
// while a milk-withdrawal period is actually running. Read paths go through
// here so a failure is loud and the caller decides how to degrade.
//
// A successful PostgREST select always returns an array, so a null `data`
// without an error means "no rows" and is safely an empty list.
export function unwrapList<T>(res: QueryResult<T>, context: string): T[] {
  if (res.error) throw new Error(`consulta a ${context}: ${res.error.message}`);
  return res.data ?? [];
}
