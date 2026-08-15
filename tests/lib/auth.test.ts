// Fase 2: quién puede qué, y la gestión de usuarios de la finca.
//
// Lo que se pinta en pantalla no prueba nada aquí — esconder un enlace no es
// autorización. Lo que se prueba es la matriz de permisos, las compensaciones
// del alta (no hay transacciones) y la regla que no se puede romper: la finca
// nunca se queda sin un dueño activo, porque eso no se arregla desde el tablero.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

import { puede, permisosDe, ROLES, esRol } from '../../src/lib/auth/roles';
import {
  crearUsuario, listarUsuarios, cambiarRol, cambiarEstado, regenerarClave, claveTemporal,
  type AdminAuth,
} from '../../src/lib/auth/usuarios';
import { FINCA_ID } from '../../src/lib/tenant';
import { resetDb } from '../helpers/db';
import type { FakeSupabase } from '../helpers/fake-supabase';

let db: FakeSupabase;

/** Doble de la API de administración de Auth, con registro de lo que le pidieron. */
function fakeAdmin() {
  const creados: { email: string; password: string }[] = [];
  const borrados: string[] = [];
  const claves: { id: string; password: string }[] = [];
  const admin: AdminAuth = {
    async createUser({ email, password }) {
      creados.push({ email, password });
      return { id: 'auth-nuevo' };
    },
    async deleteUser(id) { borrados.push(id); },
    async setPassword(id, password) { claves.push({ id, password }); },
  };
  return { admin, creados, borrados, claves };
}

const seed = () => ({
  usuarios: [
    { id: 'u-duena', email: 'due@finca.co', nombre: 'Ana', activo: true, ultimo_acceso: null, telefono: null },
    { id: 'u-vaq', email: 'vaq@finca.co', nombre: 'Beto', activo: true, ultimo_acceso: null, telefono: '3001112233' },
  ],
  usuario_fincas: [
    { usuario_id: 'u-duena', rol: 'dueno' },
    { usuario_id: 'u-vaq', rol: 'vaquero' },
  ],
});

beforeEach(() => {
  db = resetDb(seed());
});

// =====================================================================
describe('matriz de permisos', () => {
  it('el dueño es el único que administra usuarios', () => {
    expect(puede('dueno', 'usuario.administrar')).toBe(true);
    for (const rol of ['admin', 'veterinario', 'vaquero'] as const) {
      expect(puede(rol, 'usuario.administrar'), rol).toBe(false);
    }
  });

  it('el veterinario registra chequeos y protocolos; el vaquero no', () => {
    expect(puede('veterinario', 'chequeo.registrar')).toBe(true);
    expect(puede('veterinario', 'protocolo.registrar')).toBe(true);
    expect(puede('vaquero', 'chequeo.registrar')).toBe(false);
    expect(puede('vaquero', 'protocolo.registrar')).toBe(false);
  });

  it('el control lechero es de la operación, no del veterinario', () => {
    expect(puede('vaquero', 'leche.registrar')).toBe(true);
    expect(puede('admin', 'leche.registrar')).toBe(true);
    expect(puede('veterinario', 'leche.registrar')).toBe(false);
  });

  it('los catálogos solo los tocan dueño y admin', () => {
    expect(puede('dueno', 'catalogo.editar')).toBe(true);
    expect(puede('admin', 'catalogo.editar')).toBe(true);
    expect(puede('veterinario', 'catalogo.editar')).toBe(false);
    expect(puede('vaquero', 'catalogo.editar')).toBe(false);
  });

  it('todos los roles ven el tablero y la ficha del animal', () => {
    for (const rol of ROLES) {
      expect(puede(rol, 'tablero.ver'), rol).toBe(true);
      expect(puede(rol, 'animal.ver'), rol).toBe(true);
    }
  });

  it('un rol desconocido no puede nada — fail closed', () => {
    for (const basura of [null, undefined, '', 'dueño', 'Dueno', 'root']) {
      expect(esRol(basura)).toBe(false);
      expect(puede(basura as any, 'tablero.ver')).toBe(false);
      expect(puede(basura as any, 'usuario.administrar')).toBe(false);
    }
  });

  it('el admin tiene lo mismo que el dueño salvo administrar usuarios', () => {
    const soloDueno = permisosDe('dueno').filter((p) => !permisosDe('admin').includes(p));
    expect(soloDueno).toEqual(['usuario.administrar']);
  });
});

// =====================================================================
describe('crear usuario', () => {
  it('crea la cuenta, el perfil y el vínculo con la finca, y devuelve la clave una vez', async () => {
    const { admin, creados } = fakeAdmin();

    const { id, claveTemporal: clave } = await crearUsuario(
      { email: '  VET@Finca.CO ', nombre: 'Carlos Vet', telefono: '3009998877', rol: 'veterinario' },
      FINCA_ID,
      admin,
    );

    expect(id).toBe('auth-nuevo');
    expect(clave).toHaveLength(10);
    // El correo se normaliza antes de tocar Auth: si no, la misma persona entra
    // dos veces con mayúsculas distintas.
    expect(creados).toEqual([{ email: 'vet@finca.co', password: clave }]);

    expect(db.insertsInto('usuarios')).toEqual([
      expect.objectContaining({
        id: 'auth-nuevo', email: 'vet@finca.co', nombre: 'Carlos Vet',
        telefono: '3009998877', activo: true,
      }),
    ]);
    expect(db.insertsInto('usuario_fincas')).toEqual([
      { usuario_id: 'auth-nuevo', finca_id: FINCA_ID, rol: 'veterinario', id: expect.anything() },
    ]);
  });

  it('nunca guarda la contraseña en la base', async () => {
    const { admin } = fakeAdmin();

    const { claveTemporal: clave } = await crearUsuario(
      { email: 'x@finca.co', nombre: 'Equis', rol: 'vaquero' },
      FINCA_ID,
      admin,
    );

    const escrito = JSON.stringify(db.inserts);
    expect(escrito).not.toContain(clave);
  });

  it('rechaza un correo inválido antes de crear nada', async () => {
    const { admin, creados } = fakeAdmin();

    await expect(
      crearUsuario({ email: 'no-es-correo', nombre: 'Nadie', rol: 'vaquero' }, FINCA_ID, admin),
    ).rejects.toThrow();
    expect(creados).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
  });

  it('borra la cuenta de Auth si el perfil no se pudo escribir', async () => {
    const { admin, borrados } = fakeAdmin();
    db.failOn('usuarios', 'sin conexión');

    await expect(
      crearUsuario({ email: 'y@finca.co', nombre: 'Ye', rol: 'admin' }, FINCA_ID, admin),
    ).rejects.toThrow('sin conexión');

    // Sin esto la cuenta queda colgada ocupando el correo, y el reintento falla
    // con "ya existe" sin que el usuario aparezca por ninguna parte.
    expect(borrados).toEqual(['auth-nuevo']);
  });

  it('deshace perfil y cuenta si falla el vínculo con la finca', async () => {
    const { admin, borrados } = fakeAdmin();
    db.failOn('usuario_fincas', 'sin conexión');

    await expect(
      crearUsuario({ email: 'z@finca.co', nombre: 'Zeta', rol: 'admin' }, FINCA_ID, admin),
    ).rejects.toThrow('sin conexión');

    expect(db.deletesFrom('usuarios')).toHaveLength(1);
    expect(borrados).toEqual(['auth-nuevo']);
  });
});

// =====================================================================
describe('listar usuarios', () => {
  it('devuelve los de la finca con su rol, ordenados por nombre', async () => {
    const lista = await listarUsuarios(FINCA_ID);

    expect(lista.map((u) => [u.nombre, u.rol])).toEqual([
      ['Ana', 'dueno'],
      ['Beto', 'vaquero'],
    ]);
  });

  it('no incluye a quien no está vinculado a esta finca', async () => {
    db.rows('usuarios').push({ id: 'u-otra', email: 'otra@finca.co', nombre: 'Zulma', activo: true });
    db.rows('usuario_fincas').push({ usuario_id: 'u-otra', rol: 'dueno', finca_id: 'otra-finca' });

    const lista = await listarUsuarios(FINCA_ID);

    expect(lista.map((u) => u.nombre)).not.toContain('Zulma');
  });
});

// =====================================================================
describe('la finca nunca se queda sin dueño', () => {
  it('no deja cambiarle el rol al único dueño activo', async () => {
    await expect(cambiarRol('u-duena', FINCA_ID, 'vaquero')).rejects.toThrow('único dueño activo');
    expect(db.updatesTo('usuario_fincas')).toHaveLength(0);
  });

  it('no deja desactivar al único dueño activo', async () => {
    await expect(cambiarEstado('u-duena', FINCA_ID, false)).rejects.toThrow('único dueño activo');
    expect(db.updatesTo('usuarios')).toHaveLength(0);
  });

  it('sí lo deja cuando hay un segundo dueño activo', async () => {
    db.rows('usuarios').push({ id: 'u-dos', email: 'dos@finca.co', nombre: 'Dos', activo: true });
    db.rows('usuario_fincas').push({ usuario_id: 'u-dos', rol: 'dueno', finca_id: FINCA_ID });

    await cambiarRol('u-duena', FINCA_ID, 'admin');

    expect(db.updatesTo('usuario_fincas')[0]).toMatchObject({
      patch: { rol: 'admin' },
      filters: [['usuario_id', 'u-duena'], ['finca_id', FINCA_ID]],
    });
  });

  it('un segundo dueño DESACTIVADO no cuenta como respaldo', async () => {
    db.rows('usuarios').push({ id: 'u-dos', email: 'dos@finca.co', nombre: 'Dos', activo: false });
    db.rows('usuario_fincas').push({ usuario_id: 'u-dos', rol: 'dueno', finca_id: FINCA_ID });

    await expect(cambiarEstado('u-duena', FINCA_ID, false)).rejects.toThrow('único dueño activo');
  });

  it('desactivar a cualquier otro no tiene traba', async () => {
    await cambiarEstado('u-vaq', FINCA_ID, false);

    expect(db.updatesTo('usuarios')[0]).toMatchObject({
      patch: { activo: false },
      filters: [['id', 'u-vaq']],
    });
  });

  it('ascender a alguien a dueño nunca se bloquea', async () => {
    await cambiarRol('u-vaq', FINCA_ID, 'dueno');

    expect(db.updatesTo('usuario_fincas')[0].patch).toEqual({ rol: 'dueno' });
  });
});

// =====================================================================
describe('clave temporal', () => {
  it('evita los caracteres que se confunden al dictarla', () => {
    const clave = claveTemporal(200);
    expect(clave).not.toMatch(/[O0Il1]/);
    expect(clave).toHaveLength(200);
  });

  it('regenerar devuelve una clave nueva y no la guarda', async () => {
    const { admin, claves } = fakeAdmin();

    const clave = await regenerarClave('u-vaq', admin);

    expect(claves).toEqual([{ id: 'u-vaq', password: clave }]);
    expect(db.updates).toHaveLength(0);
  });
});
