import { redirect } from 'next/navigation';

/**
 * Vuelve a la pantalla con el resultado en la URL.
 *
 * ⚠️ `redirect()` lanza (NEXT_REDIRECT), así que esto va SIEMPRE fuera del
 * try/catch de la acción. Llamarlo dentro haría que el catch se tragara la
 * redirección y la acción terminara en silencio, sin navegar y sin avisar.
 *
 * Por la URL solo viajan confirmaciones y mensajes de validación. Nada sensible:
 * una contraseña temporal en el historial del navegador es justo lo que los dos
 * componentes 'use client' de /dashboard/usuarios existen para evitar.
 */
export function volverCon(ruta: string, res: { ok?: string; error?: string }): never {
  if (res.error) redirect(`${ruta}?error=${encodeURIComponent(res.error)}`);
  if (res.ok) redirect(`${ruta}?ok=${encodeURIComponent(res.ok)}`);
  redirect(ruta);
}
