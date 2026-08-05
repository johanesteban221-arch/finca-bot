// Tests for the alert queries shared by the dashboard and the 6 AM cron.
//
// The embedded `animales(arete)` resource is seeded as a nested object on the
// row, which is the shape PostgREST returns for that select.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

import { getProximas, getRetiros, getPrenezPendientes, PRENEZ_DIAS } from '../../src/lib/alerts';
import { resetDb } from '../helpers/db';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW } from '../helpers/harness';

let db: FakeSupabase;

// Frozen at 2026-08-04: the próximas window is [2026-06-05, 2026-08-11].
const SANITARIOS = [
  { tipo: 'vacuna', producto: 'Aftosa', proxima_fecha: '2026-08-01', retiro_leche_hasta: null, animales: { arete: '045' } },
  { tipo: 'desparasitacion', producto: 'Ivermectina', proxima_fecha: '2026-08-10', retiro_leche_hasta: null, animales: { arete: '077' } },
  { tipo: 'tratamiento', producto: 'Penicilina', proxima_fecha: null, retiro_leche_hasta: '2026-08-06', animales: { arete: '101' } },
  { tipo: 'vacuna', producto: 'Antigua', proxima_fecha: '2026-05-01', retiro_leche_hasta: null, animales: { arete: '102' } },
  { tipo: 'vacuna', producto: 'Lejana', proxima_fecha: '2026-09-01', retiro_leche_hasta: null, animales: { arete: '103' } },
  { tipo: 'tratamiento', producto: 'Oxitetraciclina', proxima_fecha: null, retiro_leche_hasta: '2026-08-04', animales: { arete: '104' } },
  { tipo: 'tratamiento', producto: 'Vencido', proxima_fecha: null, retiro_leche_hasta: '2026-07-30', animales: { arete: '105' } },
];

const REPRO = [
  { tipo: 'servicio', fecha: '2026-06-01', animales: { arete: '045', estado_reproductivo: 'servida' } },
  { tipo: 'servicio', fecha: '2026-06-10', animales: { arete: '045', estado_reproductivo: 'servida' } }, // misma vaca
  { tipo: 'servicio', fecha: '2026-05-20', animales: { arete: '077', estado_reproductivo: 'servida' } },
  { tipo: 'servicio', fecha: '2026-08-01', animales: { arete: '101', estado_reproductivo: 'servida' } }, // muy reciente
  { tipo: 'servicio', fecha: '2026-05-01', animales: { arete: '102', estado_reproductivo: 'prenada' } }, // ya diagnosticada
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb({ eventos_sanitarios: SANITARIOS, eventos_reproductivos: REPRO });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getProximas', () => {
  it('returns only events inside the window, with the overdue flag and day count', async () => {
    const proximas = await getProximas();

    expect(proximas).toEqual([
      expect.objectContaining({ arete: '045', producto: 'Aftosa', proxima_fecha: '2026-08-01', vencida: true, dias: -3 }),
      expect.objectContaining({ arete: '077', producto: 'Ivermectina', proxima_fecha: '2026-08-10', vencida: false, dias: 6 }),
    ]);
  });

  it('excludes rows with no next date at all', async () => {
    const proximas = await getProximas();

    expect(proximas.map((p) => p.producto)).not.toContain('Penicilina');
  });

  it('throws when the query fails instead of reporting nothing pending', async () => {
    db.failOn('eventos_sanitarios', 'timeout');

    await expect(getProximas()).rejects.toThrow(/eventos_sanitarios.*timeout/);
  });
});

describe('getRetiros', () => {
  it('keeps withdrawals that are still active today, including those clearing today', async () => {
    const retiros = await getRetiros();

    expect(retiros).toEqual([
      expect.objectContaining({ arete: '104', hasta: '2026-08-04', dias: 0 }),
      expect.objectContaining({ arete: '101', hasta: '2026-08-06', dias: 2 }),
    ]);
  });

  it('drops withdrawals that already expired', async () => {
    const retiros = await getRetiros();

    expect(retiros.map((r) => r.arete)).not.toContain('105');
  });

  it('throws when the query fails instead of declaring the milk fit to ship', async () => {
    db.failOn('eventos_sanitarios', 'conexión rechazada');

    await expect(getRetiros()).rejects.toThrow(/eventos_sanitarios/);
  });
});

describe('getPrenezPendientes', () => {
  it('dedupes cows with several old services and skips recent or diagnosed ones', async () => {
    const prenez = await getPrenezPendientes();

    expect(prenez).toEqual(['077', '045']); // ordered by fecha ascending
    expect(prenez).toHaveLength(2);
  });

  it(`only counts services older than ${PRENEZ_DIAS} days`, async () => {
    const prenez = await getPrenezPendientes();

    expect(prenez).not.toContain('101'); // served on 2026-08-01, too recent
  });

  it('throws when the query fails', async () => {
    db.failOn('eventos_reproductivos', 'timeout');

    await expect(getPrenezPendientes()).rejects.toThrow(/eventos_reproductivos/);
  });
});
