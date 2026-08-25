// Sesión falsa para los tests que renderizan páginas del tablero.
//
// Mismo patrón que db.ts: el factory de `vi.mock` se iza por encima de los
// imports, así que no puede cerrar sobre una variable del archivo de test, pero
// sí puede importar este módulo y leer lo que el test haya dejado puesto.
//
// Se moquea `getSesion` y no las cookies porque lo que interesa probar es el
// guardia de la página — qué hace con cada respuesta —, no el ida y vuelta con
// Supabase Auth.

import type { Rol } from '../../src/lib/auth/roles';
import { FINCA_ID } from '../../src/lib/tenant';

// El id ES el de auth.users, o sea un uuid. Importa que lo sea: desde Bloque D
// el control lechero lo guarda en controles_leche.created_by y el esquema lo
// valida como uuid — un 'u-1' de mentira haría fallar algo que en producción
// funciona, que es la peor clase de test.
export const DUENO = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dueno@finca.co',
  nombre: 'Johan',
  rol: 'dueno' as Rol,
  fincaId: FINCA_ID,
  legado: false,
};

export const sesionRef: { current: any } = { current: { estado: 'ok', usuario: DUENO } };

/** Sesión válida con el rol indicado. */
export const comoRol = (rol: Rol) => {
  sesionRef.current = { estado: 'ok', usuario: { ...DUENO, rol } };
};

/** Cualquiera de los cuatro "no": anonimo · sin_perfil · inactivo · sin_acceso. */
export const sinSesion = (estado: string, email = 'alguien@finca.co') => {
  sesionRef.current = { estado, email };
};

export const resetSesion = () => {
  sesionRef.current = { estado: 'ok', usuario: DUENO };
};
