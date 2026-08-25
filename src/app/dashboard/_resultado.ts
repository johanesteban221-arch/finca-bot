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
 *
 * `extra` sirve para devolver al operario al estado en el que estaba —el ordeño
 * y la fecha que tenía elegidos—, no solo a la pantalla. Se arma con
 * URLSearchParams para que la ruta nunca termine con dos '?'.
 */
export function volverCon(
  ruta: string,
  res: { ok?: string; error?: string },
  extra: Record<string, string | undefined> = {},
): never {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  if (res.error) q.set('error', res.error);
  else if (res.ok) q.set('ok', res.ok);

  const cadena = q.toString();
  redirect(cadena ? `${ruta}?${cadena}` : ruta);
}
