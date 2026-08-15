// Renderiza la hoja de vida del animal a HTML estático, igual que
// dashboard.test.ts: es lo que prueba que la línea de tiempo, el árbol
// genealógico y —sobre todo— la degradación llegan a la pantalla.
//
// Lo que se cuida aquí: "no existe" y "no se pudo consultar" nunca deben
// verse igual. El primero manda a revisar el arete; el segundo, a revisar la
// base. Confundirlos termina en un animal registrado dos veces.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

vi.mock('../../src/lib/auth/server', async () => {
  const { sesionRef } = await import('../helpers/auth');
  return { getSesion: async () => sesionRef.current };
});

import Ficha from '../../src/app/dashboard/animales/[arete]/page';
import { edadTexto } from '../../src/lib/ficha';
import { resetDb } from '../helpers/db';
import { sinSesion, resetSesion } from '../helpers/auth';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW } from '../helpers/harness';

let db: FakeSupabase;

const seed = () => ({
  animales: [
    {
      id: 'a1', arete: '045', nombre: 'Lucera', sexo: 'H', raza: 'Gyr x Holstein',
      categoria: 'vaca', estado: 'activo', estado_reproductivo: 'prenada',
      registro_oficial: 'ICA-9912', fecha_nacimiento: '2023-02-10', origen: 'nacido_en_finca',
      peso_nacimiento: 34, notas: 'Vaca insignia del hato', madre_id: 'a3', padre_id: null,
    },
    // Cría: cuelga de a1 por madre_id, que es lo que sigue getCrias.
    {
      id: 'a2', arete: '210', nombre: null, sexo: 'M', categoria: 'ternero',
      estado: 'activo', fecha_nacimiento: '2026-03-01', madre_id: 'a1', padre_id: null,
    },
    {
      id: 'a3', arete: '101', sexo: 'H', categoria: 'vaca', estado: 'activo',
      fecha_nacimiento: '2019-05-20', madre_id: null, padre_id: null,
    },
  ],
  vw_genealogia: [
    {
      animal_id: 'a1', arete: '045',
      // Padre externo: hay nombre pero no hay ficha a la cual enlazar.
      padre: 'PAJILLA-GYR-7788', padre_id: null, padre_en_sistema: false,
      madre: '101', madre_id: 'a3', madre_en_sistema: true,
      abuelo_paterno: null, abuelo_paterno_id: null, abuelo_paterno_en_sistema: false,
      abuela_paterna: null, abuela_paterna_id: null, abuela_paterna_en_sistema: false,
      abuelo_materno: 'BRAHMAN-VIEJO', abuelo_materno_id: null, abuelo_materno_en_sistema: false,
      abuela_materna: null, abuela_materna_id: null, abuela_materna_en_sistema: false,
    },
  ],
  vw_historial_animal: [
    {
      animal_id: 'a1', fecha: '2026-08-01', categoria: 'chequeo_repro', evento: 'RECHE',
      descripcion: 'OD: CL2 18.0 · Dr. Ramírez · dudosa', created_at: '2026-08-01T15:00:00Z', ref_id: 'c1',
    },
    {
      animal_id: 'a1', fecha: '2026-07-20', categoria: 'pesaje', evento: 'control',
      descripcion: '482 kg', created_at: '2026-07-20T15:00:00Z', ref_id: 'p1',
    },
    {
      animal_id: 'a1', fecha: '2026-07-10', categoria: 'sanitario', evento: 'tratamiento',
      descripcion: 'Oxitetraciclina 20 ml mastitis', created_at: '2026-07-10T15:00:00Z', ref_id: 's1',
    },
    {
      animal_id: 'a1', fecha: '2026-06-15', categoria: 'produccion_leche', evento: 'ordeno_manana',
      descripcion: '9.5 L', created_at: '2026-06-15T15:00:00Z', ref_id: 'l1',
    },
    // De otro animal: no debe aparecer en esta ficha.
    {
      animal_id: 'a3', fecha: '2026-07-30', categoria: 'pesaje', evento: 'control',
      descripcion: '999 kg', created_at: '2026-07-30T15:00:00Z', ref_id: 'p9',
    },
  ],
});

const render = async (arete = '045') =>
  renderToStaticMarkup(await Ficha({ params: Promise.resolve({ arete }) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb(seed());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('datos del animal', () => {
  it('muestra la identificación, el registro oficial y la edad calculada', async () => {
    const html = await render();

    expect(html).toContain('045');
    expect(html).toContain('Lucera');
    expect(html).toContain('ICA-9912');
    expect(html).toContain('Gyr x Holstein');
    expect(html).toContain('3 años 5 m'); // 2023-02-10 → 2026-08-04
    expect(html).toContain('Vaca insignia del hato');
  });

  it('toma el último peso de la línea de tiempo, sin consultar pesajes aparte', async () => {
    const html = await render();

    expect(html).toContain('482 kg');
    expect(html).toContain('Último peso');
  });
});

describe('historial unificado', () => {
  it('junta en una sola tabla eventos de varias fuentes', async () => {
    const html = await render();

    expect(html).toContain('Oxitetraciclina 20 ml mastitis'); // sanitario
    expect(html).toContain('482 kg');                          // pesaje
    expect(html).toContain('9.5 L');                           // leche
    expect(html).toContain('Ordeño de la mañana');
  });

  it('traduce el código clínico del chequeo sin perderlo de vista', async () => {
    const html = await render();

    expect(html).toContain('RECHE');
    expect(html).toContain('rechequeo pendiente');
  });

  it('no mezcla eventos de otros animales', async () => {
    const html = await render();

    expect(html).not.toContain('999 kg');
  });

  it('avisa cuando el animal todavía no tiene eventos', async () => {
    db = resetDb({ ...seed(), vw_historial_animal: [] });

    const html = await render();

    expect(html).toContain('Todavía no hay eventos registrados');
  });
});

describe('árbol genealógico', () => {
  it('enlaza a la ficha del ascendiente que sí está en el hato', async () => {
    const html = await render();

    expect(html).toContain('/dashboard/animales/101');
  });

  it('muestra el ascendiente externo como texto, marcado como tal', async () => {
    const html = await render();

    expect(html).toContain('PAJILLA-GYR-7788');
    expect(html).toContain('externo');
    expect(html).not.toContain('/dashboard/animales/PAJILLA-GYR-7788');
  });

  it('lista las crías con enlace a su propia ficha', async () => {
    const html = await render();

    expect(html).toContain('/dashboard/animales/210');
  });

  it('dice "sin registrar" en vez de inventar un abuelo que nadie anotó', async () => {
    const html = await render();

    expect(html).toContain('Sin registrar');
  });
});

describe('animal inexistente vs consulta caída', () => {
  it('manda a revisar el arete cuando el animal no existe', async () => {
    const html = await render('999');

    expect(html).toContain('Animal no encontrado');
    expect(html).not.toContain('Datos incompletos');
  });

  it('avisa del fallo —y NO dice que el animal no existe— si la consulta se cae', async () => {
    db.failOn('animales', 'timeout');

    const html = await render();

    expect(html).toContain('Datos incompletos');
    expect(html).toContain('timeout');
    expect(html).not.toContain('Animal no encontrado');
  });

  it('degrada solo el historial cuando la vista falla, sin tumbar la genealogía', async () => {
    db.failOn('vw_historial_animal', 'vista caída');

    const html = await render();

    expect(html).toContain('Datos incompletos');
    expect(html).toContain('No se pudo cargar el historial');
    // El árbol venía de otra consulta y sigue en pie.
    expect(html).toContain('PAJILLA-GYR-7788');
    // El conteo de eventos no puede leerse como cero.
    expect(html).toContain('—');
  });

  it('degrada solo el árbol cuando la vista de genealogía falla', async () => {
    db.failOn('vw_genealogia', 'vista caída');

    const html = await render();

    expect(html).toContain('Árbol genealógico');
    expect(html).toContain('No se pudo cargar.');
    expect(html).toContain('482 kg'); // el historial sobrevivió
  });
});

describe('edadTexto', () => {
  it('habla en días al recién nacido, en meses al levante y en años a la vaca', () => {
    expect(edadTexto('2026-08-01')).toBe('3 días');
    expect(edadTexto('2026-01-04')).toBe('7 meses');
    expect(edadTexto('2019-05-04')).toBe('7 años 3 m');
  });

  it('no inventa una edad sin fecha de nacimiento ni con una fecha futura', () => {
    expect(edadTexto(null)).toBeNull();
    expect(edadTexto('2027-01-01')).toBeNull();
  });
});

// =====================================================================
describe('guardia de sesión (Fase 2)', () => {
  afterEach(() => resetSesion());

  it('sin sesión no muestra la hoja de vida del animal', async () => {
    sinSesion('anonimo');

    const html = await render();

    expect(html).toContain('Sesión no iniciada');
    expect(html).not.toContain('Lucera');
    expect(html).not.toContain('Historial unificado');
  });
});
