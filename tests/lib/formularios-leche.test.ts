// Control lechero — el formulario del tablero (Bloque D, #1).
//
// Lo que se fija aquí no es que la pantalla "funcione": es el puñado de reglas
// que un refactor rompe en silencio y que nadie nota hasta que el dato ya está
// mal en la base.
//
//   · Casilla vacía ≠ 0 litros. Se ven igual en la pantalla y significan lo
//     contrario: «no la ordeñé» contra «dio cero».
//   · Nunca una fila ordeno='total'. analytics.ts suma litros sin mirar `ordeno`,
//     así que una tercera fila duplicaría la producción del hato.
//   · El veterinario NO registra el ordeño: es operación, no clínica.

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

import { registrarControlAction } from '../../src/app/dashboard/leche/actions';
import ControlLeche from '../../src/app/dashboard/leche/page';
import { numeroOpcional, opcionDe, texto, CampoInvalido, mensajeDeError } from '../../src/lib/forms';
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
describe('lectura de FormData', () => {
  it('distingue la casilla vacía del cero', () => {
    const fd = form({ vacia: '', cero: '0' });
    expect(numeroOpcional(fd, 'vacia')).toBeNull();
    expect(numeroOpcional(fd, 'cero')).toBe(0);
  });

  it('acepta la coma decimal que teclea un celular en español', () => {
    expect(numeroOpcional(form({ l: '8,5' }), 'l')).toBe(8.5);
    expect(numeroOpcional(form({ l: '8.5' }), 'l')).toBe(8.5);
  });

  it('rechaza lo que no es número en vez de mandar NaN al dominio', () => {
    expect(() => numeroOpcional(form({ l: 'ocho' }), 'l', 'Litros')).toThrow(CampoInvalido);
  });

  it('rechaza una opción fuera del conjunto cerrado', () => {
    expect(opcionDe(form({ e: '' }), 'e', ['P', 'V'] as const)).toBeNull();
    expect(() => opcionDe(form({ e: 'XX' }), 'e', ['P', 'V'] as const)).toThrow(CampoInvalido);
  });

  it('desempaca los issues de zod en vez de mostrar el JSON crudo', () => {
    const zodish = { issues: [{ path: ['mediciones', 0, 'litrosAm'], message: 'Muy alto.' }] };
    expect(mensajeDeError(zodish)).toBe('mediciones.litrosAm: Muy alto.');
  });

  it('texto() exige el campo obligatorio', () => {
    expect(() => texto(form({ a: '  ' }), 'a', 'el arete')).toThrow(/Falta el arete/);
  });
});

// =====================================================================
describe('control lechero — escritura', () => {
  it('guarda solo las vacas con algún ordeño escrito', async () => {
    const url = await correr(
      registrarControlAction,
      form({ fecha: TODAY, medidoPor: 'Johan', 'am:045': '8', 'pm:045': '6', 'am:077': '', 'pm:077': '' }),
    );

    expect(url).toContain('?ok=');
    const filas = db.rows('produccion_leche');
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.animal_id === 'a1')).toBe(true);
  });

  it('un 0 SÍ es una medición: la vaca que no dio nada se registra', async () => {
    await correr(registrarControlAction, form({ fecha: TODAY, 'am:045': '0', 'pm:045': '' }));

    const filas = db.rows('produccion_leche');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ ordeno: 'manana', litros: 0 });
  });

  it('nunca escribe una fila ordeno=total — duplicaría la producción del hato', async () => {
    await correr(registrarControlAction, form({ fecha: TODAY, 'am:045': '8', 'pm:045': '6' }));

    const ordenos = db.rows('produccion_leche').map((f) => f.ordeno);
    expect(ordenos.sort()).toEqual(['manana', 'tarde']);
    expect(ordenos).not.toContain('total');
  });

  it('estampa finca_id y fuente=control en cada fila', async () => {
    await correr(registrarControlAction, form({ fecha: TODAY, 'am:045': '8' }));

    for (const f of db.rows('produccion_leche')) {
      expect(f.finca_id).toBe(FINCA_ID);
      expect(f.fuente).toBe('control');
    }
    expect(db.rows('controles_leche')[0].finca_id).toBe(FINCA_ID);
  });

  it('un arete que no existe aborta el control entero, sin escribir nada', async () => {
    const url = await correr(
      registrarControlAction,
      form({ fecha: TODAY, 'am:045': '8', 'am:999': '5' }),
    );

    expect(url).toContain('error=');
    expect(url).toContain('999');
    expect(db.rows('produccion_leche')).toHaveLength(0);
    expect(db.rows('controles_leche')).toHaveLength(0);
  });

  it('no guarda nada si no se llenó ningún ordeño', async () => {
    const url = await correr(registrarControlAction, form({ fecha: TODAY, 'am:045': '', 'pm:045': '' }));

    expect(url).toContain('error=');
    expect(db.rows('controles_leche')).toHaveLength(0);
  });

  it('el veterinario no puede registrarlo — no opera el ordeño', async () => {
    comoRol('veterinario');
    const url = await correr(registrarControlAction, form({ fecha: TODAY, 'am:045': '8' }));

    expect(url).toContain('error=');
    expect(db.rows('produccion_leche')).toHaveLength(0);
  });

  it('sin sesión no escribe', async () => {
    sinSesion('anonimo');
    const url = await correr(registrarControlAction, form({ fecha: TODAY, 'am:045': '8' }));

    expect(url).toContain('error=');
    expect(db.rows('controles_leche')).toHaveLength(0);
  });
});

// =====================================================================
describe('control lechero — pantalla', () => {
  const render = async (params: any = {}) =>
    renderToStaticMarkup(await ControlLeche({ searchParams: Promise.resolve(params) }));

  it('lista las vacas en ordeño y excluye a la seca y al toro', async () => {
    const html = await render();

    expect(html).toContain('045');
    expect(html).toContain('077');
    expect(html).not.toContain('am:090'); // 090 está seca
    expect(html).not.toContain('am:200'); // 200 es un toro
  });

  it('sin sesión no se pinta ni un arete del hato', async () => {
    sinSesion('anonimo');
    const html = await render();

    expect(html).not.toContain('045');
    expect(html).toContain('Sesión no iniciada');
  });

  it('el veterinario no ve el formulario', async () => {
    comoRol('veterinario');
    const html = await render();

    expect(html).not.toContain('Guardar control');
  });
});
