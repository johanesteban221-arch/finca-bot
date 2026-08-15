// Gestión de usuarios de la finca: listar, crear, cambiar rol, activar/desactivar.
//
// Vive en auth/ y no en domain/ porque domain/ es el contrato de escritura del
// HATO — el que existe por las fechas derivadas (retiro_leche_hasta y compañía).
// Aquí no hay ganado; lo que hay que proteger es otra cosa: que la finca nunca
// se quede sin un dueño activo que pueda administrarla.
//
// Sin transacciones (supabase-js no las expone), así que crear un usuario son
// tres escrituras en secuencia: cuenta de Auth → perfil → vínculo con la finca.
// Si alguna falla se deshacen las anteriores a mano; la cuenta de Auth huérfana
// es la peor de las tres, porque ocupa el email y bloquea el reintento.

import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { supabase } from '../supabase';
import { ROLES, Rol, ROL_LABEL } from './roles';

export type UsuarioFinca = {
  id: string;
  email: string;
  nombre: string;
  telefono: string | null;
  activo: boolean;
  ultimoAcceso: string | null;
  rol: Rol;
};

// ---------------------------------------------------------------------
// API de administración de Supabase Auth, inyectable para poder probar todo
// lo demás sin una cuenta real de por medio.
// ---------------------------------------------------------------------
export type AdminAuth = {
  createUser(input: { email: string; password: string }): Promise<{ id: string }>;
  deleteUser(id: string): Promise<void>;
  setPassword(id: string, password: string): Promise<void>;
};

const adminReal: AdminAuth = {
  async createUser({ email, password }) {
    const { data, error } = await (supabase as any).auth.admin.createUser({
      email,
      password,
      // Sin confirmación por correo: el dueño entrega la clave temporal en mano
      // o por WhatsApp. Depender del correo aquí es la falla que la decisión de
      // login con contraseña quiso evitar.
      email_confirm: true,
    });
    if (error || !data?.user?.id) {
      throw new Error(`crear cuenta ${email}: ${error?.message ?? 'sin id devuelto'}`);
    }
    return { id: data.user.id };
  },
  async deleteUser(id) {
    const { error } = await (supabase as any).auth.admin.deleteUser(id);
    if (error) throw new Error(`borrar cuenta ${id}: ${error.message}`);
  },
  async setPassword(id, password) {
    const { error } = await (supabase as any).auth.admin.updateUserById(id, { password });
    if (error) throw new Error(`cambiar la contraseña de ${id}: ${error.message}`);
  },
};

// ---------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------
export const nuevoUsuario = z.object({
  email: z.string().trim().toLowerCase().email('Correo inválido.'),
  nombre: z.string().trim().min(2, 'Escribe el nombre completo.'),
  telefono: z
    .string()
    .trim()
    .regex(/^[0-9+ ]{7,20}$/, 'Teléfono inválido (solo números).')
    .nullable()
    .optional()
    .transform((v) => v || null),
  rol: z.enum(ROLES),
});
export type NuevoUsuarioInput = z.input<typeof nuevoUsuario>;

// Alfabeto sin caracteres que se confunden al dictarla por WhatsApp: nada de
// O/0, I/l/1. La clave se muestra UNA vez al dueño y no se guarda en ningún lado.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function claveTemporal(largo = 10): string {
  let out = '';
  for (let i = 0; i < largo; i++) out += ALFABETO[randomInt(ALFABETO.length)];
  return out;
}

// ---------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------

/**
 * Los usuarios con acceso a una finca, con su rol.
 *
 * Dos consultas en vez de un embed de PostgREST: el vínculo manda (quien no
 * tiene fila en usuario_fincas no pertenece a esta finca), y así el filtro por
 * finca_id es explícito en vez de ir escondido dentro de un join.
 */
export async function listarUsuarios(fincaId: string): Promise<UsuarioFinca[]> {
  const { data: vinculos, error: errV } = await supabase
    .from('usuario_fincas')
    .select('usuario_id, rol')
    .eq('finca_id', fincaId);
  if (errV) throw new Error(`consulta a usuario_fincas: ${errV.message}`);
  if (!vinculos?.length) return [];

  const rolPorId = new Map<string, Rol>(vinculos.map((v: any) => [v.usuario_id, v.rol]));
  const { data: perfiles, error: errU } = await supabase
    .from('usuarios')
    .select('id, email, nombre, telefono, activo, ultimo_acceso')
    .in('id', [...rolPorId.keys()]);
  if (errU) throw new Error(`consulta a usuarios: ${errU.message}`);

  return (perfiles ?? [])
    .map((p: any) => ({
      id: p.id,
      email: p.email,
      nombre: p.nombre,
      telefono: p.telefono ?? null,
      activo: p.activo !== false,
      ultimoAcceso: p.ultimo_acceso ?? null,
      rol: rolPorId.get(p.id) as Rol,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Dueños ACTIVOS de la finca. La regla de "nunca sin dueño" se mide con esto. */
async function duenosActivos(fincaId: string): Promise<string[]> {
  const usuarios = await listarUsuarios(fincaId);
  return usuarios.filter((u) => u.rol === 'dueno' && u.activo).map((u) => u.id);
}

/**
 * Lanza si el cambio dejaría a la finca sin ningún dueño activo.
 *
 * Es la única regla de negocio de este módulo y por eso está aislada: una finca
 * sin dueño no se puede arreglar desde el tablero — hay que entrar a Supabase a
 * mano. Vale más un error molesto que ese rescate.
 */
async function protegerUltimoDueno(fincaId: string, usuarioId: string): Promise<void> {
  const duenos = await duenosActivos(fincaId);
  if (duenos.length === 1 && duenos[0] === usuarioId) {
    throw new Error(
      'Es el único dueño activo de la finca. Nombra otro dueño antes de cambiarlo o desactivarlo.',
    );
  }
}

// ---------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------

export type UsuarioCreado = { id: string; claveTemporal: string };

/**
 * Crea la cuenta de Auth, el perfil y el vínculo con la finca.
 * Devuelve la clave temporal para mostrarla una sola vez.
 */
export async function crearUsuario(
  input: NuevoUsuarioInput,
  fincaId: string,
  admin: AdminAuth = adminReal,
): Promise<UsuarioCreado> {
  const d = nuevoUsuario.parse(input);
  const clave = claveTemporal();
  const { id } = await admin.createUser({ email: d.email, password: clave });

  // Compensaciones: sin transacción, cada paso limpia lo que alcanzó a crear.
  // Dejar la cuenta de Auth colgada sería lo peor — ocupa el email y el reintento
  // fallaría con "ya existe" sin que se vea al usuario por ninguna parte.
  try {
    const { error } = await supabase.from('usuarios').insert({
      id, email: d.email, nombre: d.nombre, telefono: d.telefono, activo: true,
    });
    if (error) throw new Error(`crear perfil ${d.email}: ${error.message}`);
  } catch (e) {
    await admin.deleteUser(id).catch(() => {});
    throw e;
  }

  try {
    const { error } = await supabase
      .from('usuario_fincas')
      .insert({ usuario_id: id, finca_id: fincaId, rol: d.rol });
    if (error) throw new Error(`vincular ${d.email} a la finca: ${error.message}`);
  } catch (e) {
    await supabase.from('usuarios').delete().eq('id', id);
    await admin.deleteUser(id).catch(() => {});
    throw e;
  }

  return { id, claveTemporal: clave };
}

export async function cambiarRol(usuarioId: string, fincaId: string, rol: Rol): Promise<void> {
  if (!ROLES.includes(rol)) throw new Error(`Rol desconocido: ${rol}`);
  if (rol !== 'dueno') await protegerUltimoDueno(fincaId, usuarioId);

  const { error } = await supabase
    .from('usuario_fincas')
    .update({ rol })
    .eq('usuario_id', usuarioId)
    .eq('finca_id', fincaId);
  if (error) throw new Error(`cambiar rol a ${ROL_LABEL[rol]}: ${error.message}`);
}

export async function cambiarEstado(
  usuarioId: string,
  fincaId: string,
  activo: boolean,
): Promise<void> {
  if (!activo) await protegerUltimoDueno(fincaId, usuarioId);

  const { error } = await supabase.from('usuarios').update({ activo }).eq('id', usuarioId);
  if (error) throw new Error(`${activo ? 'activar' : 'desactivar'} usuario: ${error.message}`);
}

/**
 * Nueva clave temporal para quien olvidó la suya. Se devuelve para mostrarla
 * una sola vez: no se guarda en la base ni se manda por correo, igual que en el
 * alta. Quien la pierda pide otra — el costo de eso es un clic del dueño.
 */
export async function regenerarClave(
  usuarioId: string,
  admin: AdminAuth = adminReal,
): Promise<string> {
  const clave = claveTemporal();
  await admin.setPassword(usuarioId, clave);
  return clave;
}

/**
 * Sella el último ingreso. Es un instante, no una fecha de finca, así que va en
 * UTC ISO y NO pasa por dates.ts.
 */
export async function registrarAcceso(usuarioId: string): Promise<void> {
  const { error } = await supabase
    .from('usuarios')
    .update({ ultimo_acceso: new Date().toISOString() })
    .eq('id', usuarioId);
  // Un fallo aquí no puede tumbar un login que ya fue válido.
  if (error) console.error('[auth] no se pudo registrar el último acceso:', error.message);
}
