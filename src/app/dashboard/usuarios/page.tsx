// Gestión de usuarios de la finca — solo para el rol dueño.
//
// Es lo que permite que cada dueño administre a su gente sin que nadie toque
// código ni entre a Supabase, así que es parte del salto a SaaS, no una
// comodidad de Fase 0.

import { getSesion } from '@/lib/auth/server';
import { puede, ROL_LABEL, ROLES } from '@/lib/auth/roles';
import { listarUsuarios } from '@/lib/auth/usuarios';
import { FINCA_ID } from '@/lib/tenant';
import { PantallaAcceso, SinPermiso } from '@/components/acceso';
import { Section, Card, Table, TH, TD, Badge, EmptyRow, Banner } from '@/components/ui';
import { NuevoUsuario, BotonClave } from './formularios';
import { cambiarRolAction, cambiarEstadoAction } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const fechaCorta = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

export default async function Usuarios({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // El guardia va aquí, en la página, y no en el layout: en el App Router los dos
  // se renderizan en paralelo, así que un guardia solo en el layout no impide
  // que esta página consulte la base.
  const sesion = await getSesion();
  if (sesion.estado !== 'ok') return <PantallaAcceso sesion={sesion} />;
  if (!puede(sesion.usuario.rol, 'usuario.administrar')) {
    return <SinPermiso rol={sesion.usuario.rol} que="administrar los usuarios de la finca" />;
  }

  const { error } = await searchParams;

  let usuarios;
  let falloLectura = '';
  try {
    usuarios = await listarUsuarios(FINCA_ID);
  } catch (e) {
    usuarios = null;
    falloLectura = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <a href="/dashboard" className="text-sm text-campo-700 hover:underline">← Volver al tablero</a>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">Usuarios</h1>
        <p className="mt-1 text-sm text-tierra-500">
          Quién entra al tablero de la finca y qué puede hacer. El bot de WhatsApp se maneja
          aparte, por número de teléfono.
        </p>
      </header>

      {error && <Banner fallos={[error]} />}
      {falloLectura && <Banner fallos={[`Lista de usuarios — ${falloLectura}`]} />}

      {sesion.usuario.legado && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50/80 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            ⚠️ Está entrando con el acceso de arranque
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
            Esta sesión es la contraseña única del tablero (<code>AUTH_LEGACY_BASIC</code>), no una
            cuenta. Cree aquí su usuario como <strong>Dueño</strong>, compruebe que puede entrar
            con él y solo entonces quite <code>AUTH_LEGACY_BASIC</code> de las variables de
            entorno. Quitarlo antes lo deja afuera de su propia finca.
          </p>
        </div>
      )}

      <div className="space-y-8">
        <Section id="nuevo" title="Agregar usuario" icon="➕">
          <Card>
            <NuevoUsuario />
          </Card>
        </Section>

        <Section id="lista" title="Con acceso a la finca" icon="👥">
          <Card>
            <Table>
              <thead>
                <tr>
                  <TH>Nombre</TH><TH>Rol</TH><TH>Estado</TH>
                  <TH>Último acceso</TH><TH>Contraseña</TH>
                </tr>
              </thead>
              <tbody>
                {usuarios === null && <EmptyRow cols={5}>No se pudo cargar la lista.</EmptyRow>}
                {usuarios?.length === 0 && (
                  <EmptyRow cols={5}>Todavía no hay usuarios. Cree el primero arriba.</EmptyRow>
                )}
                {usuarios?.map((u) => (
                  <tr key={u.id}>
                    <TD>
                      <span className="font-medium text-tierra-900">{u.nombre}</span>
                      <span className="block text-xs text-tierra-500">{u.email}</span>
                      {u.telefono && (
                        <span className="block text-xs tabular-nums text-tierra-400">{u.telefono}</span>
                      )}
                    </TD>
                    <TD>
                      <form action={cambiarRolAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={u.id} />
                        <select
                          name="rol"
                          defaultValue={u.rol}
                          className="rounded-lg border border-tierra-200 px-2 py-1 text-xs text-tierra-900"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROL_LABEL[r]}</option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-lg border border-tierra-200 px-2 py-1 text-xs font-medium text-tierra-700 hover:border-campo-300 hover:text-campo-800"
                        >
                          Guardar
                        </button>
                      </form>
                    </TD>
                    <TD>
                      {u.activo
                        ? <Badge tono="campo">activo</Badge>
                        : <Badge tono="alerta">inactivo</Badge>}
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums">{fechaCorta(u.ultimoAcceso)}</TD>
                    <TD>
                      <div className="flex flex-wrap items-start gap-2">
                        <BotonClave id={u.id} nombre={u.nombre} />
                        <form action={cambiarEstadoAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <input type="hidden" name="activo" value={u.activo ? '0' : '1'} />
                          <button
                            type="submit"
                            className="whitespace-nowrap rounded-lg border border-tierra-200 px-2 py-1 text-xs font-medium text-tierra-700 hover:border-red-300 hover:text-red-700"
                          >
                            {u.activo ? '🚫 Desactivar' : '✅ Activar'}
                          </button>
                        </form>
                      </div>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-4 border-t border-tierra-100 pt-3 text-xs leading-relaxed text-tierra-500">
              Desactivar corta el acceso al tablero pero no borra nada de lo que la persona
              registró. La finca no puede quedarse sin ningún dueño activo: el sistema se niega a
              cambiarle el rol o a desactivar al último.
            </p>
          </Card>
        </Section>
      </div>
    </div>
  );
}
