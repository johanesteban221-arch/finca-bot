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
