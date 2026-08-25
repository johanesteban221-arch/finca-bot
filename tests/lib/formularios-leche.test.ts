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
//   · La mañana y la tarde del mismo día son dos controles y tienen que convivir;
//     repetir el MISMO ordeño tiene que rechazarse. Los dos casos eran invisibles
//     hasta que el fake aprendió a hacer cumplir los índices únicos.
//   · La identidad de quien registra sale de la sesión, nunca del formulario.
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
import { comoRol, sinSesion, resetSesion, DUENO } from '../helpers/auth';
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
    const zodish = { issues: [{ path: ['mediciones', 0, 'litros'], message: 'Muy alto.' }] };
    expect(mensajeDeError(zodish)).toBe('mediciones.litros: Muy alto.');
  });

  it('texto() exige el campo obligatorio', () => {
    expect(() => texto(form({ a: '  ' }), 'a', 'el arete')).toThrow(/Falta el arete/);
  });
});

// =====================================================================
describe('control lechero — escritura', () => {
  const enviar = (campos: Record<string, string>) =>
    correr(registrarControlAction, form({ fecha: TODAY, ordeno: 'manana', ...campos }));

  it('guarda solo las vacas con litros escritos', async () => {
    const url = await enviar({ 'l:045': '8', 'l:077': '' });

    expect(url).toContain('ok=');
    const filas = db.rows('produccion_leche');
    expect(filas).toHaveLength(1);
    expect(filas[0].animal_id).toBe('a1');
  });

  it('un 0 SÍ es una medición: la vaca que no dio nada se registra', async () => {
    await enviar({ 'l:045': '0' });

    expect(db.rows('produccion_leche')[0]).toMatchObject({ ordeno: 'manana', litros: 0 });
  });

  it('nunca escribe una fila ordeno=total — duplicaría la producción del hato', async () => {
    await enviar({ 'l:045': '8' });

    const ordenos = db.rows('produccion_leche').map((f) => f.ordeno);
    expect(ordenos).toEqual(['manana']);
    expect(ordenos).not.toContain('total');
  });

  it('el ordeño elegido es el que se guarda', async () => {
    await enviar({ ordeno: 'tarde', 'l:045': '5' });

    expect(db.rows('produccion_leche')[0].ordeno).toBe('tarde');
    expect(db.rows('controles_leche')[0].ordeno).toBe('tarde');
  });

  it('la mañana y la tarde del mismo día conviven', async () => {
    // El caso que el esquema viejo hacía imposible: la tarde chocaba con la
    // unicidad por (finca, fecha) y el operario no podía registrarla.
    await enviar({ ordeno: 'manana', 'l:045': '8' });
    const url = await enviar({ ordeno: 'tarde', 'l:045': '5' });

    expect(url).toContain('ok=');
    expect(db.rows('produccion_leche').map((f) => f.ordeno).sort()).toEqual(['manana', 'tarde']);
  });

  it('repetir el mismo ordeño se rechaza — el doble toque no duplica litros', async () => {
    await enviar({ 'l:045': '8' });
    const url = await enviar({ 'l:045': '8' });

    expect(url).toContain('error=');
    expect(url).toMatch(/ya hay un control/i);
    // Lo que importa: los litros no se sumaron dos veces. analytics.ts suma sin
    // mirar nada, así que una fila de más no daría ningún síntoma.
    expect(db.rows('produccion_leche')).toHaveLength(1);
  });

  it('la identidad sale de la sesión, no del formulario', async () => {
    // Se mandan los campos que ANTES eran editables: deben ignorarse por completo.
    await enviar({ 'l:045': '8', medidoPor: 'El Zorro', createdBy: 'lo-que-sea' });

    expect(db.rows('controles_leche')[0]).toMatchObject({
      created_by: DUENO.id,
      medido_por: DUENO.nombre,
    });
  });

  it('estampa finca_id y fuente=control en cada fila', async () => {
    await enviar({ 'l:045': '8' });

    for (const f of db.rows('produccion_leche')) {
      expect(f.finca_id).toBe(FINCA_ID);
      expect(f.fuente).toBe('control');
    }
    expect(db.rows('controles_leche')[0].finca_id).toBe(FINCA_ID);
  });

  it('un arete que no existe aborta el ordeño entero, sin escribir nada', async () => {
    const url = await enviar({ 'l:045': '8', 'l:999': '5' });

    expect(url).toContain('error=');
    expect(url).toContain('999');
    expect(db.rows('produccion_leche')).toHaveLength(0);
    expect(db.rows('controles_leche')).toHaveLength(0);
  });

  it('no guarda nada si no se llenó ninguna vaca', async () => {
    const url = await enviar({ 'l:045': '', 'l:077': '' });

    expect(url).toContain('error=');
    expect(db.rows('controles_leche')).toHaveLength(0);
  });

  it('devuelve al operario al ordeño en el que estaba', async () => {
    const url = await enviar({ ordeno: 'tarde', 'l:045': '' });

    // Sin esto, un error lo mandaría al ordeño que sugiere el reloj y tendría
    // que volver a elegirlo antes de reintentar.
    expect(url).toContain('ordeno=tarde');
  });

  it('el veterinario no puede registrarlo — no opera el ordeño', async () => {
    comoRol('veterinario');
    const url = await enviar({ 'l:045': '8' });

    expect(url).toContain('error=');
    expect(db.rows('produccion_leche')).toHaveLength(0);
  });

  it('sin sesión no escribe', async () => {
    sinSesion('anonimo');
    const url = await enviar({ 'l:045': '8' });

    expect(url).toContain('error=');
    expect(db.rows('controles_leche')).toHaveLength(0);
  });
});

// =====================================================================
describe('control lechero — pantalla', () => {
  const render = async (params: any = {}) =>
    renderToStaticMarkup(await ControlLeche({ searchParams: Promise.resolve(params) }));

  const sembrarControl = () => {
    db.rows('controles_leche').push({
      id: 'c1', finca_id: FINCA_ID, fecha: TODAY, ordeno: 'manana',
      medido_por: 'Johan', created_by: DUENO.id, notas: null,
      created_at: '2026-08-04T11:42:00.000Z', // 6:42 a. m. en la finca (UTC-5)
    });
    db.rows('produccion_leche').push(
      { id: 'p1', finca_id: FINCA_ID, animal_id: 'a1', fecha: TODAY, ordeno: 'manana', litros: 8, control_id: 'c1', fuente: 'control' },
      { id: 'p2', finca_id: FINCA_ID, animal_id: 'a2', fecha: TODAY, ordeno: 'manana', litros: 4.5, control_id: 'c1', fuente: 'control' },
    );
  };

  it('lista las vacas en ordeño y excluye a la seca y al toro', async () => {
    const html = await render();

    expect(html).toContain('045');
    expect(html).toContain('077');
    expect(html).not.toContain('l:090'); // 090 está seca
    expect(html).not.toContain('l:200'); // 200 es un toro
  });

  it('una sola casilla de litros por vaca, no dos', async () => {
    const html = await render();

    expect(html).toContain('l:045');
    expect(html).not.toContain('am:045');
    expect(html).not.toContain('pm:045');
  });

  it('el ordeño de la URL manda sobre el que sugiere el reloj', async () => {
    const html = await render({ ordeno: 'tarde' });

    expect(html).toContain('name="ordeno" value="tarde"');
  });

  it('el historial muestra litros, quién y a qué hora se guardó', async () => {
    sembrarControl();

    const html = await render();

    expect(html).toContain('12.5 L'); // suma de las dos vacas
    expect(html).toContain('Johan');
    // El instante se guarda en UTC y se pinta en hora de finca. Si esto dijera
    // 11:42 sería que alguien lo formateó con la hora del contenedor.
    expect(html).toContain('6:42');
  });

  it('avisa cuando ese ordeño ya está registrado', async () => {
    sembrarControl();

    expect(await render({ ordeno: 'manana' })).toContain('ya está registrado');
    expect(await render({ ordeno: 'tarde' })).not.toContain('ya está registrado');
  });

  // El total en vivo. Se pinta con un <script> inline, no con un componente de
  // cliente: si alguien lo "moderniza" a 'use client', el formulario deja de
  // enviarse hasta que cargue el bundle — y esta pantalla se llena en el corral
  // con mala señal. Estas tres aserciones son lo que hace ruidoso ese cambio.
  it('la barra fija trae el total en vivo, arrancando en «—» y no en 0', async () => {
    const html = await render();

    expect(html).toContain('id="total-litros"');
    expect(html).toContain('id="total-vacas"');
    // Un 0 con las casillas vacías sería una cifra falsa.
    expect(html).toMatch(/id="total-litros"[^>]*>—</);
    expect(html).toMatch(/de \d+ vacas/);
  });

  it('el total lo suma un script inline sobre el <form>, sin React', async () => {
    const html = await render();

    expect(html).toContain('id="form-ordeno"');
    expect(html).toContain("getElementById('form-ordeno')");
    expect(html).toContain('addEventListener');
  });

  it('sin vacas en ordeño no hay barra ni script que sumar', async () => {
    db.rows('animales').length = 0;
    const html = await render();

    expect(html).not.toContain('id="total-litros"');
    expect(html).not.toContain('Guardar ordeño');
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

    expect(html).not.toContain('Guardar ordeño');
  });
});
