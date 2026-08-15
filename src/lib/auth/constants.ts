// Constantes compartidas entre el middleware (Edge) y el servidor.
//
// Viven aparte porque el middleware corre en el runtime Edge: importar
// auth/server.ts desde allá arrastraría next/headers y supabase-js al bundle.

/**
 * Cabecera que el middleware pone cuando dejó pasar por el Basic Auth de
 * arranque. El middleware la BORRA de la petición entrante antes de decidir,
 * así que nadie puede mandarla desde afuera para entrar como dueño.
 */
export const LEGACY_HEADER = 'x-auth-legacy';

/** Ruta de login. Fuera de /dashboard, por eso el middleware no la intercepta. */
export const LOGIN_PATH = '/login';
