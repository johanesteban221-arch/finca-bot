// Andamiaje compartido por los tests de los formularios del tablero (Bloque D).
//
// Los tres archivos de test repiten las llamadas a `vi.mock` porque el factory se
// iza por encima de los imports y tiene que estar en el archivo que moquea. Lo
// que NO hace falta repetir —el marcador de redirect, el lector de FormData y la
// semilla del hato— vive aquí.

import type { SeedTables } from './fake-supabase';

/**
 * `redirect()` lanza NEXT_REDIRECT en producción. En los tests lanza esto, que
 * es la única forma de ver con qué mensaje volvió la acción: las acciones de
 * Bloque D no devuelven nada, comunican por la URL.
 */
export class Redirigido extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
    this.name = 'Redirigido';
  }
}

/** Corre la acción y devuelve el destino del redirect, ya decodificado. */
export async function correr(
  accion: (fd: FormData) => Promise<void>,
  fd: FormData,
): Promise<string> {
  try {
    await accion(fd);
  } catch (e) {
    if (e instanceof Redirigido) return decodeURIComponent(e.url);
    throw e;
  }
  throw new Error('la acción no redirigió');
}

export const form = (pares: Record<string, string>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(pares)) fd.set(k, v);
  return fd;
};

/**
 * Hato mínimo que cubre los casos que importan: dos vacas en ordeño, una seca
 * (no debe aparecer en el control) y un toro (tampoco).
 */
export const seedFormularios = (): SeedTables => ({
  animales: [
    { id: 'a1', arete: '045', nombre: 'Lucera', sexo: 'H', categoria: 'vaca', estado: 'activo', estado_reproductivo: 'parida' },
    { id: 'a2', arete: '077', nombre: null, sexo: 'H', categoria: 'vaca', estado: 'activo', estado_reproductivo: 'prenada' },
    { id: 'a3', arete: '090', nombre: null, sexo: 'H', categoria: 'vaca', estado: 'activo', estado_reproductivo: 'seca' },
    { id: 'a4', arete: '200', nombre: null, sexo: 'M', categoria: 'toro', estado: 'activo', estado_reproductivo: null },
  ],
  produccion_leche: [],
  controles_leche: [],
  chequeos_reproductivos: [],
  eventos_sanitarios: [],
  eventos_reproductivos: [],
  protocolos_sincronizacion: [],
  protocolo_aplicaciones: [],
  // La columna es `retiro_horas_default` (db/01_bot_schema.sql), no días:
  // aplicarProducto() divide entre 24 y redondea hacia arriba.
  cat_medicamentos: [{ nombre: 'Oxitetraciclina', retiro_horas_default: 168, finca_id: null }],
});
