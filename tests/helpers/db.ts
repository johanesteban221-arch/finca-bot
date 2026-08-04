// Mutable holder for the fake database.
//
// `vi.mock` factories are hoisted above every import, so they cannot close over a
// variable declared in the test file. They CAN import this module, which hands back
// whatever FakeSupabase instance the current test installed via `resetDb()`.

import { FakeSupabase, SeedTables } from './fake-supabase';

export const dbRef: { current: FakeSupabase } = { current: new FakeSupabase() };

export function resetDb(seed: SeedTables = {}): FakeSupabase {
  dbRef.current = new FakeSupabase(seed);
  return dbRef.current;
}
