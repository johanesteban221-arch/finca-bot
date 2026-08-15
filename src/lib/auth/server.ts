// Quién es el que está pidiendo la página, resuelto en el servidor.
//
// Dos clientes de Supabase conviven a propósito:
//   · el de auth (anon key + cookies) valida la sesión y NADA más;
//   · el de datos (service_role, src/lib/supabase.ts) sigue leyendo y escribiendo.
// Por eso RLS sigue dormida en Fase 2 y el aislamiento real lo hacen la matriz de
// roles y el filtro explícito por finca_id. Cambiar la conexión de datos a la
// del usuario es un movimiento aparte: RLS es fail-closed y un finca_id mal
// puesto no da error, muestra la finca vacía.
//
// ⚠️ El enforcement va en CADA página, no en el layout. En el App Router el
// layout y la página se renderizan en paralelo, así que un guardia puesto solo
// en el layout no impide que la página consulte la base.

import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import { Rol, Permiso, puede, esRol } from './roles';
import { LEGACY_HEADER } from './constants';

export { LEGACY_HEADER };

export type UsuarioSesion = {
  /** null solo en el acceso heredado por Basic Auth, que no tiene cuenta real. */
  id: string | null;
  email: string;
  nombre: string;
  rol: Rol;
  fincaId: string;
  /** true cuando entró por el Basic Auth de arranque, no por una cuenta. */
  legado: boolean;
};

export type Sesion =
  | { estado: 'anonimo' }
  | { estado: 'sin_perfil'; email: string }
  | { estado: 'inactivo'; email: string }
  | { estado: 'sin_acceso'; email: string }
  | { estado: 'ok'; usuario: UsuarioSesion };

/** Cliente ligado a las cookies de la petición. Solo para auth. */
export async function authClient() {
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Un server component no puede escribir cookies. El refresco de token
          // ocurre en el server action de login, que sí puede.
        }
      },
    },
  });
}

/** ¿Sigue encendido el Basic Auth de arranque? (ver db/04_auth_roles.sql §4) */
export const legacyBasicHabilitado = () => process.env.AUTH_LEGACY_BASIC === '1';

const usuarioLegado = (): UsuarioSesion => ({
  id: null,
  email: process.env.DASHBOARD_USER || 'admin',
  nombre: 'Acceso de arranque',
  rol: 'dueno',
  fincaId: FINCA_ID,
  legado: true,
});

/**
 * Resuelve la sesión actual. Distingue los cuatro "no" porque cada uno se
 * arregla distinto: volver a entrar, crear el perfil, reactivar la cuenta o
 * darle acceso a esta finca. Un 401 genérico manda a todos al mismo callejón.
 */
// `cache` de React: el layout y la página piden la sesión en el mismo render, y
// sin esto cada petición del tablero haría dos viajes a Auth para la misma
// respuesta.
export const getSesion = cache(async function getSesion(): Promise<Sesion> {
  if (legacyBasicHabilitado() && (await headers()).get(LEGACY_HEADER) === '1') {
    return { estado: 'ok', usuario: usuarioLegado() };
  }

  const cliente = await authClient();
  const { data, error } = await cliente.auth.getUser();
  const email = data?.user?.email ?? '';
  if (error || !data?.user) return { estado: 'anonimo' };

  const { data: perfil, error: errPerfil } = await supabase
    .from('usuarios')
    .select('id, email, nombre, activo')
    .eq('id', data.user.id)
    .maybeSingle();
  if (errPerfil) throw new Error(`consulta a usuarios: ${errPerfil.message}`);
  if (!perfil) return { estado: 'sin_perfil', email };
  if (!perfil.activo) return { estado: 'inactivo', email: perfil.email };

  const { data: vinculo, error: errVinculo } = await supabase
    .from('usuario_fincas')
    .select('rol')
    .eq('usuario_id', perfil.id)
    .eq('finca_id', FINCA_ID)
    .maybeSingle();
  if (errVinculo) throw new Error(`consulta a usuario_fincas: ${errVinculo.message}`);
  if (!vinculo || !esRol(vinculo.rol)) return { estado: 'sin_acceso', email: perfil.email };

  return {
    estado: 'ok',
    usuario: {
      id: perfil.id,
      email: perfil.email,
      nombre: perfil.nombre,
      rol: vinculo.rol,
      fincaId: FINCA_ID,
      legado: false,
    },
  };
});

/** La sesión, o null si no hay una utilizable. Para páginas que ya degradan. */
export async function getUsuario(): Promise<UsuarioSesion | null> {
  const s = await getSesion();
  return s.estado === 'ok' ? s.usuario : null;
}

/** Error de autorización. Lo lanzan las escrituras; las páginas prefieren pintar. */
export class PermisoDenegado extends Error {
  constructor(readonly permiso: Permiso, readonly rol: Rol | null) {
    super(
      rol
        ? `El rol ${rol} no puede ${permiso}.`
        : `Se necesita iniciar sesión para ${permiso}.`,
    );
    this.name = 'PermisoDenegado';
  }
}

/**
 * Guardia para toda escritura del servidor. Lanza en vez de devolver un booleano
 * a propósito: un `if (!puede(...)) return` olvidado se ve igual que un éxito,
 * y esto tiene que ser imposible de ignorar por descuido.
 */
export async function requerirPermiso(permiso: Permiso): Promise<UsuarioSesion> {
  const usuario = await getUsuario();
  if (!usuario) throw new PermisoDenegado(permiso, null);
  if (!puede(usuario.rol, permiso)) throw new PermisoDenegado(permiso, usuario.rol);
  return usuario;
}
