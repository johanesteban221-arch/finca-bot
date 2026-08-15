'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requerirPermiso } from '@/lib/auth/server';
import { esRol } from '@/lib/auth/roles';
import {
  crearUsuario, cambiarRol, cambiarEstado, regenerarClave,
} from '@/lib/auth/usuarios';
import { FINCA_ID } from '@/lib/tenant';

// Toda acción empieza por requerirPermiso. Esconder el enlace del menú no es
// seguridad: sin esta línea, un POST a mano desde cualquier sesión válida
// crearía usuarios. Que la comprobación esté en el servidor y en CADA acción es
// justamente el punto de la Fase 2.
const RUTA = '/dashboard/usuarios';

export type Resultado =
  | { ok: true; mensaje: string; clave?: string; email?: string }
  | { ok: false; error: string };

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function crearUsuarioAction(
  _previo: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  try {
    await requerirPermiso('usuario.administrar');
    const rol = String(formData.get('rol') ?? '');
    if (!esRol(rol)) return { ok: false, error: 'Rol inválido.' };

    const { claveTemporal } = await crearUsuario(
      {
        email: String(formData.get('email') ?? ''),
        nombre: String(formData.get('nombre') ?? ''),
        telefono: String(formData.get('telefono') ?? '') || null,
        rol,
      },
      FINCA_ID,
    );
    revalidatePath(RUTA);
    return {
      ok: true,
      mensaje: 'Usuario creado.',
      clave: claveTemporal,
      email: String(formData.get('email') ?? '').trim().toLowerCase(),
    };
  } catch (e) {
    return { ok: false, error: mensajeDe(e) };
  }
}

export async function regenerarClaveAction(
  _previo: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  try {
    await requerirPermiso('usuario.administrar');
    const id = String(formData.get('id') ?? '');
    if (!id) return { ok: false, error: 'Falta el usuario.' };
    const clave = await regenerarClave(id);
    return { ok: true, mensaje: 'Contraseña nueva generada.', clave };
  } catch (e) {
    return { ok: false, error: mensajeDe(e) };
  }
}

// Las dos de abajo no devuelven secretos, así que son formularios normales: el
// resultado se comunica volviendo a la página, con el error en la URL cuando lo
// hay. El de "último dueño" es un mensaje que el dueño TIENE que leer.
export async function cambiarRolAction(formData: FormData): Promise<void> {
  let error = '';
  try {
    await requerirPermiso('usuario.administrar');
    const id = String(formData.get('id') ?? '');
    const rol = String(formData.get('rol') ?? '');
    if (!id || !esRol(rol)) throw new Error('Datos incompletos para cambiar el rol.');
    await cambiarRol(id, FINCA_ID, rol);
    revalidatePath(RUTA);
  } catch (e) {
    error = mensajeDe(e);
  }
  redirect(error ? `${RUTA}?error=${encodeURIComponent(error)}` : RUTA);
}

export async function cambiarEstadoAction(formData: FormData): Promise<void> {
  let error = '';
  try {
    await requerirPermiso('usuario.administrar');
    const id = String(formData.get('id') ?? '');
    const activo = String(formData.get('activo') ?? '') === '1';
    if (!id) throw new Error('Falta el usuario.');
    await cambiarEstado(id, FINCA_ID, activo);
    revalidatePath(RUTA);
  } catch (e) {
    error = mensajeDe(e);
  }
  redirect(error ? `${RUTA}?error=${encodeURIComponent(error)}` : RUTA);
}
