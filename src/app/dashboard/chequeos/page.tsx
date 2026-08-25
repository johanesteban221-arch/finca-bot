// Chequeo reproductivo — la pantalla del veterinario (Bloque D, #2).
//
// Una vaca a la vez, no un lote: el chequeo es un hallazgo clínico por animal, y
// una pantalla de lote empujaría a repetir el mismo código en veinte vacas, que
// es exactamente el dato que no sirve para nada.
//
// Arriba van los rechequeos pendientes porque son la lista de trabajo del día:
// el veterinario llega a la finca y lo primero que necesita saber es a cuáles
// tiene que volver a mirar. Esa alerta se cierra sola al registrar el chequeo
// siguiente — no hay bandera que nadie tenga que acordarse de bajar.

import { getSesion } from '@/lib/auth/server';
import { puede } from '@/lib/auth/roles';
import { getRechequeosPendientes, type Rechequeo } from '@/lib/alerts';
import { listarHembrasActivas, ultimosChequeos, type VacaOrdeno, type ChequeoReciente } from '@/lib/hato';
import { CODIGOS_CHEQUEO, ESTRUCTURAS_OVARICAS } from '@/lib/domain/schemas';
import { CHEQUEO_LABEL, ESTRUCTURA_LABEL, NOTA_RECHE } from '@/lib/vocabulario';
import { today } from '@/lib/dates';
import { PantallaAcceso, SinPermiso } from '@/components/acceso';
import { Section, Card, Table, TH, TD, Arete, EmptyRow, Banner, Badge } from '@/components/ui';
import { Campo, Texto, Numero, Seleccion, AreaTexto, Boton, ResultadoAccion } from '@/components/ui/form';
import { registrarChequeoAction } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function Chequeos({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; arete?: string }>;
}) {
  const sesion = await getSesion();
  if (sesion.estado !== 'ok') return <PantallaAcceso sesion={sesion} />;
  if (!puede(sesion.usuario.rol, 'chequeo.registrar')) {
    return <SinPermiso rol={sesion.usuario.rol} que="registrar chequeos reproductivos" />;
  }

  const { ok, error, arete } = await searchParams;
  const hoy = today();

  const [resPend, resHembras, resRecientes] = await Promise.allSettled([
    getRechequeosPendientes(),
    listarHembrasActivas(),
    ultimosChequeos(),
  ]);
  const pendientes: Rechequeo[] = resPend.status === 'fulfilled' ? resPend.value : [];
  const hembras: VacaOrdeno[] = resHembras.status === 'fulfilled' ? resHembras.value : [];
  const recientes: ChequeoReciente[] = resRecientes.status === 'fulfilled' ? resRecientes.value : [];

  const fallos = [
    resPend.status === 'rejected' && `Rechequeos pendientes — ${String(resPend.reason?.message ?? resPend.reason)}`,
    resHembras.status === 'rejected' && `Lista de hembras — ${String(resHembras.reason?.message ?? resHembras.reason)}`,
    resRecientes.status === 'rejected' && `Chequeos recientes — ${String(resRecientes.reason?.message ?? resRecientes.reason)}`,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <a href="/dashboard" className="text-sm text-campo-700 hover:underline">← Volver al tablero</a>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">Chequeo reproductivo</h1>
        <p className="mt-1 text-sm text-tierra-500">
          Ecografía y palpación, una vaca a la vez. El producto que aplique aquí se registra como
          evento sanitario y calcula solo el retiro de leche.
        </p>
      </header>

      {fallos.length > 0 && <Banner fallos={fallos} />}
      <ResultadoAccion ok={ok} error={error} />

      <div className="space-y-8">
        <Section
          title="Rechequeos pendientes"
          icon="🔁"
          subtitle={pendientes.length ? `${pendientes.length} por revisar` : undefined}
        >
          <Card>
            <Table>
              <thead>
                <tr><TH>Arete</TH><TH>Desde</TH><TH>Días</TH><TH>Veterinario</TH><TH /></tr>
              </thead>
              <tbody>
                {pendientes.length === 0 && (
                  <EmptyRow cols={5}>Ninguno pendiente. 🎉</EmptyRow>
                )}
                {pendientes.map((p) => (
                  <tr key={`${p.arete}-${p.fecha}`}>
                    <TD>
                      <Arete href={`/dashboard/animales/${encodeURIComponent(p.arete)}`}>{p.arete}</Arete>
                    </TD>
                    <TD className="tabular-nums">{p.fecha}</TD>
                    <TD>
                      <Badge tono={p.dias > 30 ? 'alerta' : 'aviso'}>{p.dias} d</Badge>
                    </TD>
                    <TD className="text-tierra-600">{p.veterinario || '—'}</TD>
                    <TD>
                      {/* Precarga el arete en el formulario de abajo. Un enlace, no
                          JS: la página es un server component y esto es solo la URL. */}
                      <a
                        href={`/dashboard/chequeos?arete=${encodeURIComponent(p.arete)}#nuevo`}
                        className="whitespace-nowrap text-xs font-medium text-campo-700 hover:underline"
                      >
                        Chequear →
                      </a>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Section>

        <Section title="Registrar chequeo" icon="🩺" id="nuevo">
          <Card>
            <form action={registrarChequeoAction} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo label="Arete" hint="Debe existir en el hato; un arete nuevo se rechaza.">
                  <Texto
                    name="arete"
                    list="hembras"
                    defaultValue={arete ?? ''}
                    required
                    maxLength={15}
                    autoComplete="off"
                  />
                </Campo>
                <Campo label="Fecha">
                  <Texto type="date" name="fecha" defaultValue={hoy} max={hoy} required />
                </Campo>
                <Campo label="Veterinario">
                  <Texto name="veterinario" defaultValue={sesion.usuario.nombre} required />
                </Campo>
              </div>

              {/* El datalist ayuda a teclear pero NO es la validación: el dominio
                  vuelve a resolver el arete y falla si no existe. */}
              <datalist id="hembras">
                {hembras.map((h) => (
                  <option key={h.id} value={h.arete}>
                    {h.nombre ?? ''}
                  </option>
                ))}
              </datalist>

              <Campo label="Hallazgo" hint={NOTA_RECHE}>
                <Seleccion name="estadoCodigo" defaultValue="" required>
                  <option value="" disabled>Elija el hallazgo…</option>
                  {CODIGOS_CHEQUEO.map((c) => (
                    <option key={c} value={c}>{CHEQUEO_LABEL[c]}</option>
                  ))}
                </Seleccion>
              </Campo>

              <fieldset className="rounded-lg border border-tierra-200 p-3">
                <legend className="px-1 text-2xs font-semibold uppercase tracking-wide text-tierra-500">
                  Estructuras ováricas (opcional)
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo label="Derecho — mm">
                      <Numero name="ovarioDerMm" min={0} max={100} />
                    </Campo>
                    <Campo label="Derecho — estructura">
                      <Seleccion name="ovarioDerEstructura" defaultValue="">
                        <option value="">—</option>
                        {ESTRUCTURAS_OVARICAS.map((e) => (
                          <option key={e} value={e}>{ESTRUCTURA_LABEL[e]}</option>
                        ))}
                      </Seleccion>
                    </Campo>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo label="Izquierdo — mm">
                      <Numero name="ovarioIzqMm" min={0} max={100} />
                    </Campo>
                    <Campo label="Izquierdo — estructura">
                      <Seleccion name="ovarioIzqEstructura" defaultValue="">
                        <option value="">—</option>
                        {ESTRUCTURAS_OVARICAS.map((e) => (
                          <option key={e} value={e}>{ESTRUCTURA_LABEL[e]}</option>
                        ))}
                      </Seleccion>
                    </Campo>
                  </div>
                </div>
              </fieldset>

              <fieldset className="rounded-lg border border-tierra-200 p-3">
                <legend className="px-1 text-2xs font-semibold uppercase tracking-wide text-tierra-500">
                  Producto aplicado (opcional)
                </legend>
                <p className="mb-3 text-xs leading-snug text-tierra-500">
                  Va a <code>eventos_sanitarios</code>, que es donde se calcula el retiro de leche
                  desde el catálogo de medicamentos. Una hormona registrada por fuera de ahí es
                  leche con retiro vigente saliendo al tanque.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Campo label="Producto">
                    <Texto name="producto" placeholder="GnRH, PGF2α…" />
                  </Campo>
                  <Campo label="Dosis" hint="Obligatoria si hay producto.">
                    <Texto name="dosis" placeholder="2 mL" />
                  </Campo>
                  <Campo label="Vía">
                    <Texto name="via" placeholder="IM, IV, SC…" />
                  </Campo>
                </div>
              </fieldset>

              <Campo label="Observaciones (opcional)">
                <AreaTexto name="observaciones" />
              </Campo>

              <Boton>Guardar chequeo</Boton>
            </form>
          </Card>
        </Section>

        <Section title="Últimos chequeos" icon="🗓️">
          <Card>
            <Table>
              <thead>
                <tr><TH>Fecha</TH><TH>Arete</TH><TH>Hallazgo</TH><TH>Veterinario</TH></tr>
              </thead>
              <tbody>
                {recientes.length === 0 && <EmptyRow cols={4}>Todavía no hay chequeos.</EmptyRow>}
                {recientes.map((c) => (
                  <tr key={c.id}>
                    <TD className="tabular-nums">{c.fecha}</TD>
                    <TD>
                      <Arete href={`/dashboard/animales/${encodeURIComponent(c.arete)}`}>{c.arete}</Arete>
                    </TD>
                    <TD>
                      <Badge tono={c.estadoCodigo === 'RECHE' ? 'aviso' : 'neutro'}>
                        {c.estadoCodigo}
                      </Badge>
                      {c.observaciones && (
                        <span className="mt-0.5 block text-xs text-tierra-500">{c.observaciones}</span>
                      )}
                    </TD>
                    <TD className="text-tierra-600">{c.veterinario || '—'}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </Section>
      </div>
    </div>
  );
}
