// Chequeo reproductivo — el formulario del veterinario (Bloque D, #2).
//
// Las dos reglas que sostiene este archivo son las que el vocabulario clínico
// hace fáciles de romper:
//
//   · RECHE NO cambia el estado del animal. No es un descarte, es «no pude
//     definirla»; ponerle un estado sería inventar un hallazgo que el
//     veterinario no hizo.
//   · Todo producto aplicado durante el chequeo aterriza en eventos_sanitarios,
//     que es el único sitio donde se deriva retiro_leche_hasta. Guardado como
//     columna suelta sería leche con retiro vigente saliendo al tanque.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

// requerirPermiso REAL sobre una sesión falsa: lo que se prueba es la matriz de
// roles, no un doble que diría que sí a todo.
vi.mock('../../src/lib/auth/server', async () => {
  const { sesionRef } = await import('../helpers/auth');
  const { puede } = await import('../../src/lib/auth/roles');
  const actual = await vi.importActual<typeof import('../../src/lib/auth/server')>('../../src/lib/auth/server');
  return {
    ...actual,
    getSesion: async () => sesionRef.current,
    getUsuario: async () => (sesionRef.current.estado === 'ok' ? sesionRef.current.usuario : null),
    requerirPermiso: async (permiso: string) => {
      const u = sesionRef.current.estado === 'ok' ? sesionRef.current.usuario : null;
      if (!u) throw new actual.PermisoDenegado(permiso as any, null);
      if (!puede(u.rol, permiso as any)) throw new actual.PermisoDenegado(permiso as any, u.rol);
      return u;
    },
  };
});

vi.mock('next/navigation', async () => {
  const { Redirigido } = await import('../helpers/formularios');
  return { redirect: (url: string) => { throw new Redirigido(url); } };
});

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
import { registrarChequeoAction } from '../../src/app/dashboard/chequeos/actions';
import Chequeos from '../../src/app/dashboard/chequeos/page';
import { resetDb } from '../helpers/db';
import { comoRol, sinSesion, resetSesion } from '../helpers/auth';
import { correr, form, seedFormularios } from '../helpers/formularios';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW, TODAY } from '../helpers/harness';
import { FINCA_ID } from '../../src/lib/tenant';

let db: FakeSupabase;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb(seedFormularios());
  resetSesion();
});

afterEach(() => {
  vi.useRealTimers();
});

// =====================================================================
describe('chequeo reproductivo — escritura', () => {
  it('escribe el chequeo y mueve el estado del animal', async () => {
    const url = await correr(
      registrarChequeoAction,
      form({ arete: '045', fecha: TODAY, veterinario: 'Dra. Ruiz', estadoCodigo: 'P' }),
    );

    expect(url).toContain('?ok=');
    expect(db.rows('chequeos_reproductivos')[0]).toMatchObject({
      animal_id: 'a1', estado_codigo: 'P', finca_id: FINCA_ID,
    });
    expect(db.rows('animales').find((a) => a.id === 'a1')!.estado_reproductivo).toBe('prenada');
  });

  it('RECHE no cambia el estado: no es un descarte, es "no pude definirla"', async () => {
    await correr(
      registrarChequeoAction,
      form({ arete: '077', fecha: TODAY, veterinario: 'Dra. Ruiz', estadoCodigo: 'RECHE' }),
    );

    // Estaba preñada antes del chequeo y lo sigue estando.
    expect(db.rows('animales').find((a) => a.id === 'a2')!.estado_reproductivo).toBe('prenada');
    expect(db.rows('chequeos_reproductivos')[0].estado_codigo).toBe('RECHE');
  });

  it('el producto aplicado va a eventos_sanitarios con su retiro de leche', async () => {
    const url = await correr(
      registrarChequeoAction,
      form({
        arete: '045', fecha: TODAY, veterinario: 'Dra. Ruiz', estadoCodigo: 'V',
        producto: 'Oxitetraciclina', dosis: '20 mL', via: 'IM',
      }),
    );

    const sanitario = db.rows('eventos_sanitarios')[0];
    expect(sanitario).toMatchObject({ producto: 'Oxitetraciclina', finca_id: FINCA_ID });
    expect(sanitario.retiro_leche_hasta).toBeTruthy();
    expect(url).toContain('Leche retenida');
  });

  it('un arete inexistente falla en vez de crear un animal fantasma', async () => {
    const url = await correr(
      registrarChequeoAction,
      form({ arete: '999', fecha: TODAY, veterinario: 'Dra. Ruiz', estadoCodigo: 'P' }),
    );

    expect(url).toContain('error=');
    expect(db.rows('animales')).toHaveLength(4);
    expect(db.rows('chequeos_reproductivos')).toHaveLength(0);
  });

  it('el vaquero no puede registrarlo — es un hallazgo clínico', async () => {
    comoRol('vaquero');
    const url = await correr(
      registrarChequeoAction,
      form({ arete: '045', fecha: TODAY, veterinario: 'x', estadoCodigo: 'P' }),
    );

    expect(url).toContain('error=');
    expect(db.rows('chequeos_reproductivos')).toHaveLength(0);
  });
});

// =====================================================================
describe('chequeo reproductivo — pantalla', () => {
  const render = async (params: any = {}) =>
    renderToStaticMarkup(await Chequeos({ searchParams: Promise.resolve(params) }));

  it('el veterinario ve el formulario', async () => {
    comoRol('veterinario');
    expect(await render()).toContain('Registrar chequeo');
  });

  it('el vaquero no lo ve', async () => {
    comoRol('vaquero');
    expect(await render()).not.toContain('Registrar chequeo');
  });

  it('sin sesión no se pinta nada del hato', async () => {
    sinSesion('anonimo');
    const html = await render();

    expect(html).not.toContain('045');
    expect(html).toContain('Sesión no iniciada');
  });

  it('lista los rechequeos pendientes como lista de trabajo', async () => {
    db.rows('chequeos_reproductivos').push({
      id: 'c1', finca_id: FINCA_ID, animal_id: 'a1', fecha: '2026-07-20',
      estado_codigo: 'RECHE', veterinario: 'Dra. Ruiz', observaciones: null,
      created_at: '2026-07-20T10:00:00Z', animales: { arete: '045', estado: 'activo' },
    });

    const html = await render();
    expect(html).toContain('Rechequeos pendientes');
    expect(html).toContain('045');
  });
});
