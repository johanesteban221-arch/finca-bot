// Control lechero — el hato en ordeño en una sola pantalla (Bloque D, #1).
//
// Un control lechero no es la medición diaria: es un pesaje puntual de TODO el
// hato en ordeño, cada dos o tres semanas. Por eso la pantalla es una tabla y no
// un formulario por vaca — el operario recorre la fila del ordeño con el celular
// en la mano y va tecleando, y volver a cargar una página por animal haría el
// trabajo imposible con la señal del corral.
//
// Sin JS de cliente a propósito: es un <form> normal, así que se envía aunque el
// bundle nunca haya cargado. El precio es que no hay total en vivo mientras se
// teclea; el total real lo confirma el aviso al guardar.

import { getSesion } from '@/lib/auth/server';
import { puede } from '@/lib/auth/roles';
import { listarOrdeno, ultimosControles, type VacaOrdeno, type ControlReciente } from '@/lib/hato';
import { today } from '@/lib/dates';
import { PantallaAcceso, SinPermiso } from '@/components/acceso';
import { Section, Card, Table, TH, TD, Arete, EmptyRow, Banner, Kpi, KpiRow, Badge } from '@/components/ui';
import { Campo, Texto, Numero, AreaTexto, Boton, ResultadoAccion, ETIQUETA } from '@/components/ui/form';
import { registrarControlAction } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ControlLeche({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  // El guardia va aquí, en la página. En el App Router el layout y la página se
  // renderizan en paralelo, así que uno puesto solo en el layout no frena esta
  // consulta. Y la acción tiene el suyo propio: esto no la protege.
  const sesion = await getSesion();
  if (sesion.estado !== 'ok') return <PantallaAcceso sesion={sesion} />;
  if (!puede(sesion.usuario.rol, 'leche.registrar')) {
    return <SinPermiso rol={sesion.usuario.rol} que="registrar el control lechero" />;
  }

  const { ok, error } = await searchParams;
  const hoy = today();

  // Degrada por sección: si falla el histórico, el formulario tiene que seguir
  // sirviendo. Lo que no puede degradar es la lista de vacas — sin ella no hay
  // nada que llenar, y una lista vacía «porque la base no respondió» se ve igual
  // que una finca sin vacas en ordeño.
  const [resVacas, resControles] = await Promise.allSettled([listarOrdeno(), ultimosControles()]);
  const vacas: VacaOrdeno[] | null = resVacas.status === 'fulfilled' ? resVacas.value : null;
  const controles: ControlReciente[] = resControles.status === 'fulfilled' ? resControles.value : [];

  const fallos = [
    resVacas.status === 'rejected' && `Hato en ordeño — ${String(resVacas.reason?.message ?? resVacas.reason)}`,
    resControles.status === 'rejected' && `Controles anteriores — ${String(resControles.reason?.message ?? resControles.reason)}`,
  ].filter(Boolean) as string[];

  const ultimo = controles[0];
  const yaHayDeHoy = controles.some((c) => c.fecha === hoy);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <a href="/dashboard" className="text-sm text-campo-700 hover:underline">← Volver al tablero</a>

      <header className="mb-6 mt-4">
        <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">Control lechero</h1>
        <p className="mt-1 text-sm text-tierra-500">
          Pesaje de todo el hato en ordeño en un día. Deje en blanco la vaca que no ordeñó:
          un 0 se guarda como «dio cero litros», que no es lo mismo.
        </p>
      </header>

      {fallos.length > 0 && <Banner fallos={fallos} />}
      <ResultadoAccion ok={ok} error={error} />

      <KpiRow>
        <Kpi label="Vacas en ordeño" value={vacas?.length ?? '—'} tono="campo" />
        <Kpi
          label="Último control"
          value={ultimo?.fecha ?? '—'}
          hint={ultimo ? `${ultimo.vacas} vacas medidas` : 'Todavía no hay ninguno'}
        />
      </KpiRow>

      {yaHayDeHoy && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/80 p-4">
          <h2 className="text-sm font-semibold text-amber-900">Ya hay un control con fecha de hoy</h2>
          <p className="mt-1 text-sm leading-relaxed text-amber-900/80">
            Solo se admite un control por día (así un doble toque en «Guardar» no duplica el
            pesaje). Si necesita corregirlo, cambie la fecha o bórrelo primero desde Supabase.
          </p>
        </div>
      )}

      <form action={registrarControlAction}>
        <div className="space-y-6">
          <Section title="Datos del control" icon="📋">
            <Card>
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo label="Fecha" hint="No puede ser futura.">
                  <Texto type="date" name="fecha" defaultValue={hoy} max={hoy} required />
                </Campo>
                <Campo label="Medido por">
                  <Texto name="medidoPor" defaultValue={sesion.usuario.nombre} />
                </Campo>
                <Campo label="Notas (opcional)">
                  <AreaTexto name="notas" placeholder="Clima, cambio de potrero…" />
                </Campo>
              </div>
            </Card>
          </Section>

          <Section
            title="Vacas en ordeño"
            icon="🥛"
            subtitle={vacas ? `${vacas.length} en la lista` : undefined}
          >
            <Card>
              <Table>
                <thead>
                  <tr>
                    <TH>Arete</TH>
                    <TH className="w-28">Mañana (L)</TH>
                    <TH className="w-28">Tarde (L)</TH>
                  </tr>
                </thead>
                <tbody>
                  {vacas === null && (
                    <EmptyRow cols={3}>No se pudo cargar el hato. No guarde: faltarían vacas.</EmptyRow>
                  )}
                  {vacas?.length === 0 && (
                    <EmptyRow cols={3}>
                      No hay vacas en ordeño. Se listan las activas de categoría «vaca» que no estén secas.
                    </EmptyRow>
                  )}
                  {vacas?.map((v) => (
                    <tr key={v.id}>
                      <TD>
                        <Arete href={`/dashboard/animales/${encodeURIComponent(v.arete)}`}>{v.arete}</Arete>
                        {v.nombre && <span className="block text-xs text-tierra-500">{v.nombre}</span>}
                        {v.estadoReproductivo === 'prenada' && (
                          <span className="mt-0.5 block"><Badge tono="info">preñada</Badge></span>
                        )}
                      </TD>
                      <TD>
                        <Numero
                          name={`am:${v.arete}`}
                          min={0}
                          max={50}
                          aria-label={`Litros de la mañana, vaca ${v.arete}`}
                        />
                      </TD>
                      <TD>
                        <Numero
                          name={`pm:${v.arete}`}
                          min={0}
                          max={50}
                          aria-label={`Litros de la tarde, vaca ${v.arete}`}
                        />
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </Table>

              {!!vacas?.length && (
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-tierra-100 pt-4">
                  <Boton>Guardar control</Boton>
                  <span className={ETIQUETA}>
                    Se guardan solo las vacas con al menos un ordeño escrito.
                  </span>
                </div>
              )}
            </Card>
          </Section>
        </div>
      </form>

      {controles.length > 0 && (
        <div className="mt-8">
          <Section title="Controles anteriores" icon="🗓️">
            <Card>
              <Table>
                <thead>
                  <tr><TH>Fecha</TH><TH>Vacas medidas</TH></tr>
                </thead>
                <tbody>
                  {controles.map((c) => (
                    <tr key={c.id}>
                      <TD className="tabular-nums">{c.fecha}</TD>
                      <TD className="tabular-nums">{c.vacas}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </Section>
        </div>
      )}
    </div>
  );
}
