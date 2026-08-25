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
import { NOW, TODAY } from '../helpers/harness';

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
    vw_leche_ordeno: [],
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

// Una fila por finca, día y ordeño: es lo que devuelve vw_leche_ordeno (db/06).
// Dos días de CONTEO individual: `litros_individual` y `vacas` vienen llenos.
const ORDENOS = [
  { fecha: '2026-08-04', ordeno: 'manana', litros: 120, litros_individual: 120, vacas: 20 },
  { fecha: '2026-08-04', ordeno: 'tarde', litros: 80, litros_individual: 80, vacas: 20 },
  { fecha: '2026-08-03', ordeno: 'manana', litros: 110, litros_individual: 110, vacas: 19 },
  { fecha: '2026-08-03', ordeno: 'tarde', litros: 70, litros_individual: 70, vacas: 18 },
];

// Un día de solo CANTINA: hay litros, pero no se sabe cuántas vacas los dieron.
const SOLO_CANTINA = [
  { fecha: '2026-08-02', ordeno: 'manana', litros: 130, litros_individual: null, vacas: null },
  { fecha: '2026-08-02', ordeno: 'tarde', litros: 90, litros_individual: null, vacas: null },
];

describe('paginación', () => {
  // El hato se mide vaca por vaca en los dos ordeños TODOS los días, así que las
  // consultas del tablero pasaron a moverse en miles de filas. PostgREST corta
  // en 1000 sin avisar (el fake lo simula), y agregar sobre lo truncado da un
  // número más bajo que el real sin ningún síntoma.
  it('trae el hato completo aunque pase del tope de filas de PostgREST', async () => {
    const muchos = Array.from({ length: 2500 }, (_, i) => ({
      id: `x${String(i).padStart(5, '0')}`,
      arete: String(1000 + i),
      sexo: 'H', categoria: 'vaca', estado: 'activo', estado_reproductivo: 'vacia',
    }));
    db = resetDb({ ...seed(), animales: muchos });

    const a = await getAnalytics();

    // Sin paginar esto daba 1000 y el tablero lo mostraba como el hato entero.
    expect(a.inventario.activos).toBe(2500);
  });
});

describe('leche', () => {
  it('suma los dos ordeños del día sin contar dos veces a la misma vaca', async () => {
    db = resetDb({ ...seed(), vw_leche_ordeno: ORDENOS });

    const a = await getAnalytics();

    expect(a.leche.totalLitros30d).toBe(380);
    expect(a.leche.promLitrosDia).toBe(190);
    // 40 sería sumar las vacas de la mañana con las de la tarde: son las mismas.
    expect(a.leche.vacasEnOrdeno).toBe(20);
    // Promedio de los promedios diarios: 200/20 y 180/19.
    expect(a.leche.promPorVacaDia).toBe(9.7);
  });

  it('la leche sale de la vista agregada, no de las filas crudas', async () => {
    db = resetDb({
      ...seed(),
      produccion_leche: [{ animal_id: 'a1', fecha: TODAY, ordeno: 'manana', litros: 999 }],
    });

    const a = await getAnalytics();

    // Si alguien vuelve a leer produccion_leche directo, esto salta: con medición
    // diaria son 1200+ filas al mes y PostgREST las corta en silencio (db/06).
    expect(a.leche.hayDatos).toBe(false);
    expect(a.leche.totalLitros30d).toBe(0);
  });

  it('el día de solo cantina cuenta para el volumen, no para las cifras por vaca', async () => {
    db = resetDb({ ...seed(), vw_leche_ordeno: [...ORDENOS, ...SOLO_CANTINA] });

    const a = await getAnalytics();

    // El volumen sí lo incluye: esos litros se vendieron.
    expect(a.leche.totalLitros30d).toBe(600);
    expect(a.leche.promLitrosDia).toBe(200);
    // Pero repartir 220 L entre un número de vacas que nadie contó ese día sería
    // inventar el divisor, así que las dos cifras por vaca lo ignoran.
    expect(a.leche.vacasEnOrdeno).toBe(20);
    expect(a.leche.promPorVacaDia).toBe(9.7);
  });

  it('sin ningún conteo individual, las cifras por vaca son «—» y no 0', async () => {
    db = resetDb({ ...seed(), vw_leche_ordeno: SOLO_CANTINA });

    const a = await getAnalytics();

    expect(a.leche.totalLitros30d).toBe(220);
    // Un 0 aquí se leería como «no hay vacas en ordeño», que es falso: lo que no
    // hay es un conteo.
    expect(a.leche.vacasEnOrdeno).toBeNull();
    expect(a.leche.promPorVacaDia).toBeNull();
  });

  it('ignora los ordeños de más de 30 días', async () => {
    db = resetDb({
      ...seed(),
      vw_leche_ordeno: [
        ...ORDENOS,
        { fecha: '2026-06-01', ordeno: 'manana', litros: 500, litros_individual: 500, vacas: 25 },
      ],
    });

    const a = await getAnalytics();

    expect(a.leche.totalLitros30d).toBe(380);
    expect(a.leche.vacasEnOrdeno).toBe(20);
  });
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
    'vw_leche_ordeno',
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
