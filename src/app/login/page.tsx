// Pantalla de ingreso. Server component puro: el formulario postea a un server
// action, así que no hace falta ni una línea de JavaScript de cliente.

import { iniciarSesion } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ERRORES: Record<string, string> = {
  credenciales: 'Correo o contraseña incorrectos.',
  faltan: 'Escribe el correo y la contraseña.',
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; desde?: string }>;
}) {
  const { error, desde } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-tierra-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-campo-600 text-xl shadow-sm"
          >
            🐄
          </span>
          <span>
            <span className="block text-lg font-semibold leading-tight text-tierra-900">Finca</span>
            <span className="block text-sm leading-tight text-tierra-500">Gestión ganadera</span>
          </span>
        </div>

        <div className="rounded-xl border border-tierra-200/80 bg-white p-5 shadow-sm shadow-tierra-900/[0.04]">
          <h1 className="text-base font-semibold text-tierra-900">Entrar al tablero</h1>
          <p className="mt-1 text-sm text-tierra-500">
            Use el correo y la contraseña que le entregó el dueño de la finca.
          </p>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {ERRORES[error] ?? 'No se pudo iniciar sesión.'}
            </p>
          )}

          <form action={iniciarSesion} className="mt-4 space-y-3">
            <input type="hidden" name="desde" value={desde ?? '/dashboard'} />
            <label className="block">
              <span className="text-2xs font-semibold uppercase tracking-wide text-tierra-500">
                Correo
              </span>
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                className="mt-1 w-full rounded-lg border border-tierra-200 px-3 py-2 text-sm text-tierra-900 outline-none focus:border-campo-500 focus:ring-2 focus:ring-campo-200"
              />
            </label>
            <label className="block">
              <span className="text-2xs font-semibold uppercase tracking-wide text-tierra-500">
                Contraseña
              </span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                className="mt-1 w-full rounded-lg border border-tierra-200 px-3 py-2 text-sm text-tierra-900 outline-none focus:border-campo-500 focus:ring-2 focus:ring-campo-200"
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-lg bg-campo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-campo-700"
            >
              Entrar
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs leading-relaxed text-tierra-400">
          ¿Olvidó la contraseña? El dueño de la finca puede generarle una nueva
          desde Usuarios.
        </p>
      </div>
    </main>
  );
}
