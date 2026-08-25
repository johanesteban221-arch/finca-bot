// Mutable holder for the fake database.
//
// `vi.mock` factories are hoisted above every import, so they cannot close over a
// variable declared in the test file. They CAN import this module, which hands back
// whatever FakeSupabase instance the current test installed via `resetDb()`.

import { FakeSupabase, SeedTables, Row } from './fake-supabase';
import { FINCA_ID } from '../../src/lib/tenant';

// Tablas y vistas que llevan finca_id. Las filas sembradas sin ese campo lo
// reciben, igual que en Postgres: la columna tiene DEFAULT en
// db/02_multitenant.sql, así que una fila insertada sin él queda en la finca 0
// de todos modos. Sin esto, sembrar una fila "como la escribiría la app" y que
// las consultas —que ya filtran por finca_id— no la vieran sería un artefacto
// del fake, no un hallazgo.
//
// Para probar el aislamiento entre fincas hay que poner un finca_id distinto a
// propósito; ese valor explícito se respeta.
const CON_FINCA = new Set([
  'animales', 'eventos_sanitarios', 'eventos_reproductivos', 'pesajes',
  'produccion_leche', 'movimientos', 'confirmaciones_pendientes',
  'chequeos_reproductivos', 'protocolos_sincronizacion', 'protocolo_aplicaciones',
  'controles_leche', 'usuario_fincas',
  'vw_historial_animal', 'vw_genealogia', 'vw_alertas', 'vw_leche_ordeno',
]);

const conFincaPorDefecto = (tabla: string, rows: Row[]): Row[] =>
  CON_FINCA.has(tabla)
    ? rows.map((r) => ('finca_id' in r ? r : { ...r, finca_id: FINCA_ID }))
    : rows;

export const dbRef: { current: FakeSupabase } = { current: new FakeSupabase() };

export function resetDb(seed: SeedTables = {}): FakeSupabase {
  const conDefaults: SeedTables = Object.fromEntries(
    Object.entries(seed).map(([tabla, rows]) => [tabla, conFincaPorDefecto(tabla, rows)]),
  );
  dbRef.current = new FakeSupabase(conDefaults);
  return dbRef.current;
}
