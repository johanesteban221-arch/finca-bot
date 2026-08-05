// Tests for the dashboard's health and mortality aggregation, and for the rule
// that a failed query must never be reported as "no hay datos".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

import { getAnalytics } from '../../src/lib/analytics';
import { resetDb } from '../helpers/db';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW } from '../helpers/harness';

let db: FakeSupabase;

// Two live animals, four dead, one sold — so the mortality rate has a known value.
const ANIMALES = [
  { id: 'a1', arete: '045', sexo: 'H', categoria: 'vaca', estado: 'activo', estado_reproductivo: 'vacia' },
  { id: 'a2', arete: '077', sexo: 'H', categoria: 'vaca', estado: 'activo', estado_reproductivo: 'vacia' },
  { id: 'a3', arete: '101', sexo: 'M', categoria: 'ceba', estado: 'muerto', estado_reproductivo: null },
  { id: 'a4', arete: '102', sexo: 'M', categoria: 'ceba', estado: 'muerto', estado_reproductivo: null },
  { id: 'a5', arete: '103', sexo: 'H', categoria: 'novilla', estado: 'muerto', estado_reproductivo: null },
  { id: 'a6', arete: '104', sexo: 'H', categoria: 'novilla', estado: 'muerto', estado_reproductivo: null },
  { id: 'a7', arete: '105', sexo: 'M', categoria: 'ceba', estado: 'vendido', estado_reproductivo: null },
];

// Today is frozen at 2026-08-04, so the 90-day health window opens on 2026-05-06
// and the 12-month mortality window opens on 2025-08-04.
const SANITARIOS = [
  { animal_id: 'a1', tipo: 'vacuna', fecha: '2026-08-01', producto: 'Aftosa', diagnostico: null },
  { animal_id: 'a2', tipo: 'tratamiento', fecha: '2026-07-25', producto: 'Penicilina', diagnostico: 'Mastitis' },
  { animal_id: 'a1', tipo: 'tratamiento', fecha: '2026-07-20', producto: 'Oxitetraciclina', diagnostico: 'Mastitis' },
  { animal_id: 'a2', tipo: 'desparasitacion', fecha: '2026-06-01', producto: 'Ivermectina', diagnostico: null },
  { animal_id: 'a1', tipo: 'tratamiento', fecha: '2026-06-10', producto: 'Penicilina', diagnostico: 'Cojera' },
  { animal_id: 'a1', tipo: 'vacuna', fecha: '2026-01-10', producto: 'Antigua', diagnostico: null }, // fuera de ventana
];

const MOVIMIENTOS = [
  { animal_id: 'a3', tipo: 'muerte', fecha: '2026-07-01', notas: 'Causa: Neumonía' },
  { animal_id: 'a6', tipo: 'muerte', fecha: '2026-05-01', notas: null },
  { animal_id: 'a4', tipo: 'muerte', fecha: '2026-03-15', notas: 'Causa: Neumonía' },
  { animal_id: 'a5', tipo: 'muerte', fecha: '2024-01-01', notas: 'Causa: Culebra' }, // > 12 meses
  { animal_id: 'a7', tipo: 'venta', fecha: '2026-07-02', notas: 'Vendido en feria' }, // no es una baja
];

function seed() {
  return {
    animales: ANIMALES,
    pesajes: [],
    eventos_reproductivos: [],
    produccion_leche: [],
    eventos_sanitarios: SANITARIOS,
    movimientos: MOVIMIENTOS,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb(seed());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sanidad', () => {
  it('counts only the events inside the rolling window', async () => {
    const a = await getAnalytics();

    expect(a.sanidad.ventanaDias).toBe(90);
    expect(a.sanidad.total).toBe(5); // the 2026-01-10 event is outside the window
    expect(a.sanidad.porTipo).toEqual({ vacuna: 1, tratamiento: 3, desparasitacion: 1 });
  });

  it('ranks diagnoses by frequency', async () => {
    const a = await getAnalytics();

    expect(a.sanidad.diagnosticosTop).toEqual([
      { diagnostico: 'Mastitis', n: 2 },
      { diagnostico: 'Cojera', n: 1 },
    ]);
  });

  it('lists the most recent events first, resolved to aretes', async () => {
    const a = await getAnalytics();

    expect(a.sanidad.recientes[0]).toEqual({
      arete: '045', tipo: 'vacuna', producto: 'Aftosa', diagnostico: null, fecha: '2026-08-01',
    });
    expect(a.sanidad.recientes.map((e) => e.fecha)).toEqual([
      '2026-08-01', '2026-07-25', '2026-07-20', '2026-06-10', '2026-06-01',
    ]);
  });
});

describe('mortalidad', () => {
  it('separates all-time deaths from the last 12 months', async () => {
    const a = await getAnalytics();

    expect(a.mortalidad.total).toBe(4);        // the venta is not a death
    expect(a.mortalidad.ultimos12Meses).toBe(3); // the 2024 death is outside
  });

  it('recovers the cause from the notas prefix the bot writes', async () => {
    const a = await getAnalytics();

    // flows/mortalidad.ts stores "Causa: X" in notas — there is no causa column.
    expect(a.mortalidad.porCausa).toEqual({ 'Neumonía': 2, 'Sin causa registrada': 1 });
  });

  it('computes the approximate annual rate over the exposed population', async () => {
    const a = await getAnalytics();

    // 3 deaths / (2 activos + 3 deaths) = 60%
    expect(a.mortalidad.tasaAnualPct).toBe(60);
  });

  it('lists the most recent deaths first', async () => {
    const a = await getAnalytics();

    expect(a.mortalidad.recientes.map((m) => m.fecha)).toEqual([
      '2026-07-01', '2026-05-01', '2026-03-15', '2024-01-01',
    ]);
    expect(a.mortalidad.recientes[0]).toEqual({ arete: '101', causa: 'Neumonía', fecha: '2026-07-01' });
  });

  it('reports no rate when there is no exposed population', async () => {
    db = resetDb({ ...seed(), animales: [], movimientos: [] });

    const a = await getAnalytics();

    expect(a.mortalidad.tasaAnualPct).toBeNull();
    expect(a.mortalidad.total).toBe(0);
  });
});

// The whole point of the change: silence is not an acceptable failure mode.
describe('error propagation', () => {
  it.each([
    'animales',
    'pesajes',
    'eventos_reproductivos',
    'produccion_leche',
    'eventos_sanitarios',
    'movimientos',
  ])('throws instead of reporting empty data when %s fails', async (tabla) => {
    db.failOn(tabla, 'timeout');

    await expect(getAnalytics()).rejects.toThrow(new RegExp(`${tabla}.*timeout`));
  });

  it('does not silently return zeros for a failed herd query', async () => {
    db.failOn('animales');

    // Before this change the dashboard rendered "0 activos" here.
    await expect(getAnalytics()).rejects.toThrow();
  });
});
