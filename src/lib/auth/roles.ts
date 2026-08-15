// Roles and what each one may do. Pure data + pure functions: no database, no
// cookies, so this is the piece the tests can pin exhaustively.
//
// ⚠️ Scope: this matrix governs the DASHBOARD. The WhatsApp bot still authorises
// by "is this phone registered and active", exactly as before — moving the bot
// to roles is a separate batch, decided so the two authentications do not change
// in the same deploy.
//
// The role values are unaccented ('dueno', not 'dueño') because that is what the
// CHECK constraints in db/01_bot_schema.sql and db/04_auth_roles.sql accept, and
// what the daily-alerts cron filters on. The accented text belongs in ROL_LABEL,
// which is the only place the user ever sees.

export const ROLES = ['dueno', 'admin', 'veterinario', 'vaquero'] as const;
export type Rol = (typeof ROLES)[number];

export const ROL_LABEL: Record<Rol, string> = {
  dueno: 'Dueño',
  admin: 'Administrador',
  veterinario: 'Veterinario',
  vaquero: 'Vaquero',
};

export const ROL_DESCRIPCION: Record<Rol, string> = {
  dueno: 'Todo, incluida la gestión de usuarios de la finca.',
  admin: 'Todo el manejo del hato y los catálogos. No administra usuarios.',
  veterinario: 'Registra sanidad, reproducción, chequeos y protocolos.',
  vaquero: 'Registra el día a día del potrero: eventos, pesajes y control de leche.',
};

/**
 * Permissions are named after the action, not after the screen. A screen can be
 * split or renamed; "who may record a check-up" does not change with the layout,
 * and it is what a reviewer needs to read off in one line.
 */
export type Permiso =
  | 'tablero.ver'
  | 'animal.ver'
  | 'evento.registrar'      // sanidad · reproducción · pesaje (Fase 3)
  | 'mortalidad.registrar'
  | 'chequeo.registrar'     // chequeo reproductivo (Bloque D) — del veterinario
  | 'protocolo.registrar'
  | 'leche.registrar'       // control lechero (Bloque D)
  | 'catalogo.editar'
  | 'usuario.administrar';

const TODOS: Permiso[] = [
  'tablero.ver', 'animal.ver', 'evento.registrar', 'mortalidad.registrar',
  'chequeo.registrar', 'protocolo.registrar', 'leche.registrar',
  'catalogo.editar', 'usuario.administrar',
];

const PERMISOS: Record<Rol, readonly Permiso[]> = {
  dueno: TODOS,
  // Igual que el dueño salvo administrar usuarios: quién entra a la finca es
  // decisión del dueño, no del que la opera.
  admin: TODOS.filter((p) => p !== 'usuario.administrar'),
  // Sin catálogos ni control lechero: el veterinario visita, no opera el ordeño
  // ni define qué medicamentos maneja la finca.
  veterinario: [
    'tablero.ver', 'animal.ver', 'evento.registrar', 'mortalidad.registrar',
    'chequeo.registrar', 'protocolo.registrar',
  ],
  // Chequeos y protocolos son del veterinario: son un hallazgo clínico, no un
  // dato de operación.
  vaquero: [
    'tablero.ver', 'animal.ver', 'evento.registrar', 'mortalidad.registrar',
    'leche.registrar',
  ],
};

export const esRol = (v: unknown): v is Rol => ROLES.includes(v as Rol);

/** Whether `rol` may perform `permiso`. Unknown roles can do nothing. */
export function puede(rol: string | null | undefined, permiso: Permiso): boolean {
  if (!esRol(rol)) return false;
  return PERMISOS[rol].includes(permiso);
}

/** Every permission a role has — for rendering the role picker, not for checks. */
export const permisosDe = (rol: Rol): readonly Permiso[] => PERMISOS[rol];
