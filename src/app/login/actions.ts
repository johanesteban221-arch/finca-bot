'use server';

import { redirect } from 'next/navigation';
import { authClient } from '@/lib/auth/server';
import { registrarAcceso } from '@/lib/auth/usuarios';
import { LOGIN_PATH } from '@/lib/auth/constants';

/**
 * Solo se vuelve a rutas internas del tablero. Sin este filtro, un enlace con
 * `?desde=https://otro-sitio` convertiría el login de la finca en un trampolín
 * para llevar al dueño a una copia que le pida la clave otra vez.
 */
const destinoSeguro = (desde: string) =>
  desde.startsWith('/dashboard') ? desde : '/dashboard';

export async function iniciarSesion(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const desde = destinoSeguro(String(formData.get('desde') ?? '/dashboard'));
  const volver = (motivo: string) =>
    `${LOGIN_PATH}?error=${motivo}&desde=${encodeURIComponent(desde)}`;

  if (!email || !password) redirect(volver('faltan'));

  const cliente = await authClient();
  const { data, error } = await cliente.auth.signInWithPassword({ email, password });
  // El motivo real no se le dice al que está afuera: "correo inexistente" y
  // "contraseña mala" separados le confirman a un extraño qué correos existen.
  if (error || !data?.user) redirect(volver('credenciales'));

  await registrarAcceso(data.user.id);
  redirect(desde);
}

export async function cerrarSesion(): Promise<void> {
  const cliente = await authClient();
  await cliente.auth.signOut();
  redirect(LOGIN_PATH);
}
