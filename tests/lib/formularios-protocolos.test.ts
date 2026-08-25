// Protocolos de sincronización — Bloque D, #3.
//
// El protocolo es el único de los tres que es un CICLO y no un envío, así que lo
// que se fija aquí son los enlaces que lo mantienen unido al resto del sistema:
//
//   · Cada aplicación pasa por eventos_sanitarios (de ahí sale el retiro).
//   · La IA crea un eventos_reproductivos de verdad. Sin esa fila, ni
//     getPrenezPendientes() ni los KPIs de analytics.ts verían la inseminación:
//     los dos se calculan enteros sobre eventos_reproductivos.
//   · Cancelar existe porque uq_protocolo_activo deja UN protocolo 'en_curso'
//     por animal: uno abandonado bloquearía a esa vaca para siempre.

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
import {
  iniciarProtocoloAction, registrarAplicacionAction, registrarIaAction,
  cerrarProtocoloAction, cancelarProtocoloAction,
} from '../../src/app/dashboard/protocolos/actions';
import Protocolos from '../../src/app/dashboard/protocolos/page';
import { resetDb } from '../helpers/db';
import { comoRol, sinSesion, resetSesion } from '../helpers/auth';
import { correr, form, seedFormularios } from '../helpers/formularios';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW, TODAY } from '../helpers/harness';
import { FINCA_ID } from '../../src/lib/tenant';

let db: FakeSupabase;

const iniciar = () =>
  correr(
    iniciarProtocoloAction,
    form({ arete: '045', nombreProtocolo: 'Ovsynch', fecha: TODAY, veterinario: 'Dra. Ruiz' }),
  );

const idProtocolo = () => db.rows('protocolos_sincronizacion')[0].id;

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
describe('protocolos — ciclo de vida', () => {
  it('inicia el protocolo sobre un animal existente', async () => {
    const url = await iniciar();

    expect(url).toContain('?ok=');
    expect(db.rows('protocolos_sincronizacion')[0]).toMatchObject({
      animal_id: 'a1', nombre_protocolo: 'Ovsynch', estado: 'en_curso', finca_id: FINCA_ID,
    });
  });

  it('un arete inexistente no crea un animal fantasma', async () => {
    const url = await correr(
      iniciarProtocoloAction,
      form({ arete: '999', nombreProtocolo: 'Ovsynch', fecha: TODAY }),
    );

    expect(url).toContain('error=');
    expect(db.rows('animales')).toHaveLength(4);
    expect(db.rows('protocolos_sincronizacion')).toHaveLength(0);
  });

  it('cada aplicación pasa por eventos_sanitarios', async () => {
    await iniciar();
    await correr(
      registrarAplicacionAction,
      form({ protocoloId: idProtocolo(), diaNumero: '0', producto: 'Oxitetraciclina', dosis: '2 mL', fecha: TODAY }),
    );

    expect(db.rows('protocolo_aplicaciones')[0]).toMatchObject({ dia_numero: 0, finca_id: FINCA_ID });
    expect(db.rows('eventos_sanitarios')[0]).toMatchObject({ producto: 'Oxitetraciclina' });
    expect(db.rows('eventos_sanitarios')[0].retiro_leche_hasta).toBeTruthy();
  });

  it('la IA del protocolo crea un servicio de verdad en eventos_reproductivos', async () => {
    await iniciar();
    await correr(
      registrarIaAction,
      form({ protocoloId: idProtocolo(), inseminador: 'Pedro', pajilla: 'ABC-1', fecha: TODAY }),
    );

    expect(db.rows('eventos_reproductivos')[0]).toMatchObject({
      animal_id: 'a1', tipo: 'servicio', metodo: 'IA', finca_id: FINCA_ID,
    });
    expect(db.rows('protocolos_sincronizacion')[0].fecha_ia).toBe(TODAY);
  });

  it('no se puede cerrar un protocolo sin IA registrada', async () => {
    await iniciar();
    const url = await correr(
      cerrarProtocoloAction,
      form({ protocoloId: idProtocolo(), resultado: 'preno', fecha: TODAY }),
    );

    expect(url).toContain('error=');
    expect(db.rows('protocolos_sincronizacion')[0].estado).toBe('en_curso');
  });

  it('cerrar con preñez deja el diagnóstico y mueve el estado de la vaca', async () => {
    await iniciar();
    await correr(registrarIaAction, form({ protocoloId: idProtocolo(), inseminador: 'Pedro', fecha: TODAY }));
    const url = await correr(
      cerrarProtocoloAction,
      form({ protocoloId: idProtocolo(), resultado: 'preno', fecha: TODAY }),
    );

    expect(url).toContain('?ok=');
    expect(db.rows('protocolos_sincronizacion')[0]).toMatchObject({ estado: 'finalizado', resultado: 'preno' });
    expect(db.rows('animales').find((a) => a.id === 'a1')!.estado_reproductivo).toBe('prenada');
  });

  it('cancelar libera al animal para empezar otro', async () => {
    await iniciar();
    const url = await correr(
      cancelarProtocoloAction,
      form({ protocoloId: idProtocolo(), motivo: 'Se cayó el CIDR' }),
    );

    expect(url).toContain('?ok=');
    expect(db.rows('protocolos_sincronizacion')[0].estado).toBe('cancelado');
  });

  it('el vaquero no puede tocarlos', async () => {
    comoRol('vaquero');
    const url = await iniciar();

    expect(url).toContain('error=');
    expect(db.rows('protocolos_sincronizacion')).toHaveLength(0);
  });
});

// =====================================================================
describe('protocolos — pantalla', () => {
  const render = async (params: any = {}) =>
    renderToStaticMarkup(await Protocolos({ searchParams: Promise.resolve(params) }));

  it('el veterinario ve el formulario de inicio', async () => {
    comoRol('veterinario');
    expect(await render()).toContain('Empezar un protocolo');
  });

  it('el vaquero no lo ve', async () => {
    comoRol('vaquero');
    expect(await render()).not.toContain('Empezar un protocolo');
  });

  it('sin sesión no se pinta nada', async () => {
    sinSesion('anonimo');
    expect(await render()).toContain('Sesión no iniciada');
  });

  it('muestra los protocolos abiertos con su animal', async () => {
    await iniciar();
    const html = await render();

    expect(html).toContain('Ovsynch');
    expect(html).toContain('045');
  });
});
