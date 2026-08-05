// Renders the dashboard server component to static HTML.
//
// This is what proves the three changes actually reach the screen: the alert
// tables show detail instead of bare counts, a failed query degrades to a
// warning banner instead of convincing zeros, and the sanidad/mortalidad
// sections exist.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

import Dashboard from '../../src/app/dashboard/page';
import { resetDb } from '../helpers/db';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW } from '../helpers/harness';

let db: FakeSupabase;

const seed = () => ({
  animales: [
    { id: 'a1', arete: '045', sexo: 'H', categoria: 'vaca', estado: 'activo', estado_reproductivo: 'prenada' },
    { id: 'a2', arete: '077', sexo: 'M', categoria: 'ceba', estado: 'activo', estado_reproductivo: null },
    { id: 'a3', arete: '101', sexo: 'H', categoria: 'novilla', estado: 'muerto', estado_reproductivo: null },
  ],
  pesajes: [],
  eventos_reproductivos: [
    { animal_id: 'a1', tipo: 'servicio', fecha: '2026-06-01', resultado: null, animales: { arete: '045', estado_reproductivo: 'servida' } },
  ],
  produccion_leche: [],
  eventos_sanitarios: [
    {
      animal_id: 'a1', tipo: 'vacuna', fecha: '2026-08-01', producto: 'Aftosa', diagnostico: null,
      proxima_fecha: '2026-08-02', retiro_leche_hasta: null, animales: { arete: '045' },
    },
    {
      animal_id: 'a2', tipo: 'tratamiento', fecha: '2026-08-03', producto: 'Oxitetraciclina', diagnostico: 'Mastitis',
      proxima_fecha: null, retiro_leche_hasta: '2026-08-07', animales: { arete: '077' },
    },
  ],
  movimientos: [
    { animal_id: 'a3', tipo: 'muerte', fecha: '2026-07-01', notas: 'Causa: Neumonía' },
  ],
});

const render = async () => renderToStaticMarkup(await Dashboard());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb(seed());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('alert detail (was: bare counts)', () => {
  it('renders the overdue event with its animal, product and how late it is', async () => {
    const html = await render();

    expect(html).toContain('Próximas y vencidas');
    expect(html).toContain('Aftosa');
    expect(html).toContain('vencida');
    expect(html).toContain('2026-08-02');
  });

  it('renders the active milk withdrawal with the cow and the remaining days', async () => {
    const html = await render();

    expect(html).toContain('Retiro de leche vigente');
    expect(html).toContain('Oxitetraciclina');
    expect(html).toContain('en 3 días'); // 2026-08-07 minus 2026-08-04
  });

  it('lists the cow waiting for a pregnancy check by arete', async () => {
    const html = await render();

    expect(html).toContain('Revisar preñez');
    expect(html).toContain('045');
  });

  it('shows a reassuring empty state rather than a blank table', async () => {
    db = resetDb({ ...seed(), eventos_sanitarios: [] });

    const html = await render();

    expect(html).toContain('Ninguna vaca en retiro');
  });
});

describe('sanidad and mortalidad sections', () => {
  it('renders the health section with its counts and recent events', async () => {
    const html = await render();

    expect(html).toContain('Sanidad (últimos 90 días)');
    expect(html).toContain('Diagnósticos más frecuentes');
    expect(html).toContain('Mastitis');
  });

  it('renders the mortality section with the cause parsed out of notas', async () => {
    const html = await render();

    expect(html).toContain('Mortalidad');
    expect(html).toContain('Neumonía');
    expect(html).toContain('Últimas bajas');
  });
});

describe('degradation on a failed query', () => {
  it('warns instead of rendering zeros when the herd query fails', async () => {
    db.failOn('animales', 'timeout');

    const html = await render();

    expect(html).toContain('Datos incompletos');
    expect(html).toContain('Indicadores del hato');
    expect(html).toContain('timeout');
    // The sections fed by that query are omitted, not filled with zeros.
    expect(html).not.toContain('Inventario del hato');
  });

  it('still renders the alerts when only the analytics query fails', async () => {
    db.failOn('pesajes', 'timeout');

    const html = await render();

    expect(html).toContain('Datos incompletos');
    expect(html).toContain('Alertas activas');
    expect(html).toContain('Aftosa'); // alert detail survived
  });

  it('degrades a failed alert query without taking down the herd sections', async () => {
    db.failOn('eventos_reproductivos', 'timeout');

    const html = await render();

    expect(html).toContain('Datos incompletos');
    expect(html).toContain('No se pudo cargar');
    // Counts must not read as zero when the query failed.
    expect(html).toContain('—');
  });
});
