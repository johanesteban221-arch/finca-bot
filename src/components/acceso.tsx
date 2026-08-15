// Pantallas de "no puedes ver esto". Separadas del resto de la UI porque son lo
// que ve alguien que se quedó afuera, y cada motivo se arregla distinto: volver
// a entrar, pedir el perfil, pedir la reactivación o pedir acceso a la finca.
// Un 401 genérico manda a los cuatro al mismo callejón sin salida.

import type { Sesion } from '@/lib/auth/server';
import { ROL_LABEL, type Rol } from '@/lib/auth/roles';
import { LOGIN_PATH } from '@/lib/auth/constants';

type SinSesion = Exclude<Sesion, { estado: 'ok' }>;

const MENSAJES: Record<SinSesion['estado'], { titulo: string; detalle: string }> = {
  anonimo: {
    titulo: 'Sesión no iniciada',
    detalle: 'Entre con su correo y contraseña para ver el tablero de la finca.',
  },
  sin_perfil: {
    titulo: 'Cuenta sin perfil',
    detalle:
      'La cuenta existe, pero todavía no tiene un perfil en el sistema. Pídale al dueño de la finca que la registre en Usuarios.',
  },
  inactivo: {
    titulo: 'Acceso desactivado',
    detalle:
      'Su acceso está desactivado. El dueño de la finca puede volver a activarlo desde Usuarios.',
  },
  sin_acceso: {
    titulo: 'Sin acceso a esta finca',
    detalle:
      'Su cuenta no está vinculada a esta finca. Pídale al dueño que le dé acceso y un rol.',
  },
};

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-tierra-200/80 bg-white p-5 shadow-sm shadow-tierra-900/[0.04]">
        {children}
      </div>
    </div>
  );
}

export function PantallaAcceso({ sesion }: { sesion: SinSesion }) {
  const { titulo, detalle } = MENSAJES[sesion.estado];
  const email = 'email' in sesion ? sesion.email : '';

  return (
    <Marco>
      <h1 className="text-base font-semibold text-tierra-900">🔒 {titulo}</h1>
      <p className="mt-2 text-sm text-tierra-600">{detalle}</p>
      {email && (
        <p className="mt-2 text-xs text-tierra-400">
          Cuenta: <span className="font-medium text-tierra-600">{email}</span>
        </p>
      )}
      <a
        href={LOGIN_PATH}
        className="mt-4 inline-block rounded-lg bg-campo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-campo-700"
      >
        Ir al inicio de sesión
      </a>
    </Marco>
  );
}

/** El usuario entró bien, pero su rol no alcanza para esta pantalla. */
export function SinPermiso({ rol, que }: { rol: Rol; que: string }) {
  return (
    <Marco>
      <h1 className="text-base font-semibold text-tierra-900">🚫 Sin permiso</h1>
      <p className="mt-2 text-sm text-tierra-600">
        Su rol es <strong>{ROL_LABEL[rol]}</strong> y no puede {que}. Si lo necesita, pídale al
        dueño de la finca que le cambie el rol.
      </p>
      <a href="/dashboard" className="mt-4 inline-block text-sm text-campo-700 hover:underline">
        ← Volver al tablero
      </a>
    </Marco>
  );
}
