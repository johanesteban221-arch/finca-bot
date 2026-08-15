'use client';

// Las dos únicas piezas de cliente del proyecto, y por un motivo concreto: estas
// acciones devuelven una CONTRASEÑA. Con un formulario normal habría que pasarla
// por la URL para mostrarla al volver, y ahí queda — en el historial del
// navegador, en los logs del proxy y en el Referer. Con useActionState la clave
// vuelve como valor de la acción y se pinta sin tocar la barra de direcciones.

import { useActionState } from 'react';
import { crearUsuarioAction, regenerarClaveAction, type Resultado } from './actions';
import { ROLES, ROL_LABEL, ROL_DESCRIPCION } from '@/lib/auth/roles';

function Clave({ clave, email }: { clave: string; email?: string }) {
  return (
    <div className="mt-3 rounded-lg border border-campo-300 bg-campo-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-campo-800">
        Contraseña temporal
      </p>
      <p className="mt-1 select-all font-mono text-lg font-semibold tracking-wider text-campo-900">
        {clave}
      </p>
      <p className="mt-1 text-xs leading-snug text-campo-800/80">
        Cópiela y entréguesela ahora{email ? ` a ${email}` : ''}: no se guarda en ningún lado y no
        se vuelve a mostrar. Si se pierde, genere otra.
      </p>
    </div>
  );
}

const Error_ = ({ children }: { children: React.ReactNode }) => (
  <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
    {children}
  </p>
);

const campo =
  'mt-1 w-full rounded-lg border border-tierra-200 px-3 py-2 text-sm text-tierra-900 outline-none focus:border-campo-500 focus:ring-2 focus:ring-campo-200';
const etiqueta = 'text-2xs font-semibold uppercase tracking-wide text-tierra-500';

export function NuevoUsuario() {
  const [estado, accion, pendiente] = useActionState<Resultado | null, FormData>(
    crearUsuarioAction,
    null,
  );

  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={etiqueta}>Nombre</span>
          <input name="nombre" required minLength={2} className={campo} />
        </label>
        <label className="block">
          <span className={etiqueta}>Correo</span>
          <input type="email" name="email" required className={campo} />
        </label>
        <label className="block">
          <span className={etiqueta}>Teléfono (opcional)</span>
          <input name="telefono" inputMode="tel" className={campo} />
        </label>
        <label className="block">
          <span className={etiqueta}>Rol</span>
          <select name="rol" defaultValue="vaquero" className={campo}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROL_LABEL[r]}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs leading-snug text-tierra-500">
        {ROLES.map((r) => `${ROL_LABEL[r]}: ${ROL_DESCRIPCION[r]}`).join(' · ')}
      </p>

      <button
        type="submit"
        disabled={pendiente}
        className="rounded-lg bg-campo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-campo-700 disabled:opacity-60"
      >
        {pendiente ? 'Creando…' : 'Crear usuario'}
      </button>

      {estado?.ok === false && <Error_>{estado.error}</Error_>}
      {estado?.ok && estado.clave && <Clave clave={estado.clave} email={estado.email} />}
    </form>
  );
}

export function BotonClave({ id, nombre }: { id: string; nombre: string }) {
  const [estado, accion, pendiente] = useActionState<Resultado | null, FormData>(
    regenerarClaveAction,
    null,
  );

  return (
    <form action={accion}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pendiente}
        title={`Generar una contraseña nueva para ${nombre}`}
        className="whitespace-nowrap rounded-lg border border-tierra-200 px-2 py-1 text-xs font-medium text-tierra-700 hover:border-campo-300 hover:text-campo-800 disabled:opacity-60"
      >
        {pendiente ? 'Generando…' : '🔑 Nueva clave'}
      </button>
      {estado?.ok === false && <Error_>{estado.error}</Error_>}
      {estado?.ok && estado.clave && <Clave clave={estado.clave} />}
    </form>
  );
}
