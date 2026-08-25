import { getAnalytics } from '@/lib/analytics';
import {
  getProximas, getRetiros, getPrenezPendientes, getRechequeosPendientes, PRENEZ_DIAS,
} from '@/lib/alerts';
import { fichaUrl } from '@/lib/ficha';
import { getSesion } from '@/lib/auth/server';
import { puede } from '@/lib/auth/roles';
import { PantallaAcceso, SinPermiso } from '@/components/acceso';
import {
  Section, Card, Kpi, KpiRow, Badge, Table, TH, TD, Arete, EmptyRow, Bars, Banner,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const dash = (x: number | null | undefined, suffix = '') =>
  x === null || x === undefined ? '—' : `${x}${suffix}`;

const TIPO_SANIDAD: Record<string, string> = {
  vacuna: '💉 Vacunación',
  tratamiento: '🔴 Tratamiento',
  desparasitacion: '🪱 Desparasitación',
  revision: '🩺 Revisión',
};

const errorOf = (r: PromiseRejectedResult) =>
  r.reason instanceof Error ? r.reason.message : String(r.reason);

/** Cuenta regresiva en lenguaje natural, con plural correcto. */
const enDias = (d: number) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);
const haceDias = (d: number) => (d === -1 ? 'ayer' : `hace ${Math.abs(d)} días`);

export default async function Dashboard() {
  // El guardia va en la página, no en el layout: en el App Router los dos se
  // renderizan en paralelo, así que un guardia solo en el layout no impediría
  // que estas consultas salgan.
  const sesion = await getSesion();
  if (sesion.estado !== 'ok') return <PantallaAcceso sesion={sesion} />;
  if (!puede(sesion.usuario.rol, 'tablero.ver')) {
    return <SinPermiso rol={sesion.usuario.rol} que="ver el tablero de la finca" />;
  }

  // allSettled, no all: una consulta caída degrada su propia sección en vez de
  // dejar el tablero en blanco.
  const [aRes, proxRes, retRes, prenezRes, recheRes] = await Promise.allSettled([
    getAnalytics(), getProximas(), getRetiros(), getPrenezPendientes(), getRechequeosPendientes(),
  ]);

  const a = aRes.status === 'fulfilled' ? aRes.value : null;
  const proximas = proxRes.status === 'fulfilled' ? proxRes.value : null;
  const retiros = retRes.status === 'fulfilled' ? retRes.value : null;
  const prenez = prenezRes.status === 'fulfilled' ? prenezRes.value : null;
  const rechequeos = recheRes.status === 'fulfilled' ? recheRes.value : null;

  const fallos = ([
    ['Indicadores del hato', aRes],
    ['Próximas / vencidas', proxRes],
    ['Retiros de leche', retRes],
    ['Revisar preñez', prenezRes],
    ['Rechequeos pendientes', recheRes],
  ] as const)
    .filter(([, r]) => r.status === 'rejected')
    .map(([label, r]) => `${label} — ${errorOf(r as PromiseRejectedResult)}`);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-tierra-900">
          Tablero de gestión
        </h1>
        <p className="mt-1 text-sm text-tierra-500">
          Indicadores productivos y reproductivos, en vivo desde la finca.
        </p>
      </header>

      {fallos.length > 0 && <Banner fallos={fallos} />}

      <div className="space-y-8">
        {a && (
          <>
            {/* ------------------------------------------------ INVENTARIO */}
            <Section id="inventario" title="Inventario del hato" icon="📋">
              <KpiRow>
                <Kpi label="Activos" value={a.inventario.activos} tono="campo" />
                <Kpi label="Hembras" value={a.inventario.hembras} />
                <Kpi label="Machos" value={a.inventario.machos} />
                <Kpi label="Muertos" value={a.inventario.muertos} tono="alerta" hint="histórico" />
                <Kpi label="Vendidos" value={a.inventario.vendidos} tono="info" hint="histórico" />
              </KpiRow>
              <Card title="Por categoría">
                <Bars data={a.inventario.porCategoria} />
              </Card>
            </Section>

            {/* ---------------------------------------------- REPRODUCTIVO */}
            <Section id="reproductivo" title="Reproductivo" icon="🍼">
              <KpiRow>
                <Kpi
                  label="Tasa de preñez"
                  value={dash(a.reproductivo.tasaPrenezPct, '%')}
                  tono="info"
                  hint={`${a.reproductivo.prenadasDx}/${a.reproductivo.diagnosticos} diagnósticos positivos`}
                />
                <Kpi label="Días abiertos" value={dash(a.reproductivo.diasAbiertosProm)} hint="parto → preñez" />
                <Kpi label="Parto → 1er servicio" value={dash(a.reproductivo.diasParto1erServicioProm, ' d')} />
                <Kpi label="Intervalo entre partos" value={dash(a.reproductivo.iepProm, ' d')} />
                <Kpi label="Servicios / concepción" value={dash(a.reproductivo.serviciosPorConcepcion)} />
              </KpiRow>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Estado reproductivo (hembras)">
                  <Bars data={a.reproductivo.distribucion} />
                </Card>
                <Card title="Próximos partos estimados">
                  <Table>
                    <thead>
                      <tr><TH>Arete</TH><TH>Fecha estimada</TH><TH className="text-right">Faltan</TH></tr>
                    </thead>
                    <tbody>
                      {a.reproductivo.proximosPartos.length === 0 && (
                        <EmptyRow cols={3}>Sin preñeces con servicio registrado.</EmptyRow>
                      )}
                      {a.reproductivo.proximosPartos.map((p) => (
                        <tr key={p.arete}>
                          <TD><Arete href={fichaUrl(p.arete)}>{p.arete}</Arete></TD>
                          <TD>{p.fechaEstimada}</TD>
                          <TD className="text-right tabular-nums">{p.diasRestantes} d</TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </div>
            </Section>

            {/* ------------------------------------------------------ PESO */}
            <Section id="peso" title="Peso y ganancia" icon="⚖️" subtitle="levante / ceba">
              <KpiRow>
                <Kpi
                  label="GDP promedio del hato"
                  value={dash(a.peso.gdpHatoProm, ' g/día')}
                  tono="campo"
                  hint={`${a.peso.conGdp} animales con 2 o más pesajes`}
                />
                <Kpi
                  label="Sin 2º pesaje"
                  value={a.peso.sinSegundoPesaje}
                  tono="aviso"
                  hint="péselos de nuevo para calcular la GDP"
                />
              </KpiRow>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Por categoría">
                  <Table>
                    <thead>
                      <tr>
                        <TH>Categoría</TH><TH className="text-right">#</TH>
                        <TH className="text-right">Peso prom.</TH><TH className="text-right">GDP prom.</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {a.peso.porCategoria.length === 0 && <EmptyRow cols={4}>Sin pesajes registrados.</EmptyRow>}
                      {a.peso.porCategoria.map((r) => (
                        <tr key={r.categoria}>
                          <TD className="capitalize">{r.categoria.replace(/_/g, ' ')}</TD>
                          <TD className="text-right tabular-nums">{r.nAnimales}</TD>
                          <TD className="text-right tabular-nums">{dash(r.pesoProm, ' kg')}</TD>
                          <TD className="text-right tabular-nums">{dash(r.gdpProm, ' g/d')}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
                <Card title="Mejor ganancia">
                  <Table>
                    <thead>
                      <tr>
                        <TH>Arete</TH><TH className="text-right">Peso actual</TH><TH className="text-right">GDP</TH>
                      </tr>
                    </thead>
                    <tbody>
                      {a.peso.top.length === 0 && (
                        <EmptyRow cols={3}>Aún no hay animales con 2 o más pesajes.</EmptyRow>
                      )}
                      {a.peso.top.map((r) => (
                        <tr key={r.arete}>
                          <TD><Arete href={fichaUrl(r.arete)}>{r.arete}</Arete></TD>
                          <TD className="text-right tabular-nums">{r.pesoActual} kg</TD>
                          <TD className="text-right tabular-nums font-medium text-campo-700">
                            {dash(r.gdp, ' g/d')}
                          </TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </div>
            </Section>

            {/* --------------------------------------------------- SANIDAD */}
            <Section
              id="sanidad"
              title="Sanidad"
              icon="🩺"
              subtitle={`últimos ${a.sanidad.ventanaDias} días`}
            >
              <KpiRow>
                <Kpi label="Eventos registrados" value={a.sanidad.total} tono="campo" />
                <Kpi label="Vacunaciones" value={a.sanidad.porTipo.vacuna || 0} />
                <Kpi label="Tratamientos" value={a.sanidad.porTipo.tratamiento || 0} tono="alerta" />
                <Kpi label="Desparasitaciones" value={a.sanidad.porTipo.desparasitacion || 0} />
              </KpiRow>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Diagnósticos más frecuentes">
                  <Bars
                    data={Object.fromEntries(a.sanidad.diagnosticosTop.map((d) => [d.diagnostico, d.n]))}
                    tono="alerta"
                  />
                </Card>
                <Card title="Últimos eventos">
                  <Table>
                    <thead>
                      <tr><TH>Arete</TH><TH>Tipo</TH><TH>Producto</TH><TH>Fecha</TH></tr>
                    </thead>
                    <tbody>
                      {a.sanidad.recientes.length === 0 && (
                        <EmptyRow cols={4}>Sin eventos sanitarios en la ventana.</EmptyRow>
                      )}
                      {a.sanidad.recientes.map((e, i) => (
                        <tr key={`${e.arete}-${e.fecha}-${i}`}>
                          <TD><Arete href={fichaUrl(e.arete)}>{e.arete}</Arete></TD>
                          <TD className="whitespace-nowrap">{TIPO_SANIDAD[e.tipo] || e.tipo}</TD>
                          <TD>{e.producto || e.diagnostico || '—'}</TD>
                          <TD className="whitespace-nowrap tabular-nums">{e.fecha}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </div>
            </Section>

            {/* ----------------------------------------------- MORTALIDAD */}
            <Section id="mortalidad" title="Mortalidad" icon="💀">
              <KpiRow>
                <Kpi label="Muertes (12 meses)" value={a.mortalidad.ultimos12Meses} tono="alerta" />
                <Kpi
                  label="Tasa anual aprox."
                  value={dash(a.mortalidad.tasaAnualPct, '%')}
                  tono="aviso"
                  hint="muertes / (activos + muertes)"
                />
                <Kpi label="Total histórico" value={a.mortalidad.total} />
              </KpiRow>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Causas (12 meses)">
                  <Bars data={a.mortalidad.porCausa} tono="alerta" />
                </Card>
                <Card title="Últimas bajas">
                  <Table>
                    <thead>
                      <tr><TH>Arete</TH><TH>Causa</TH><TH>Fecha</TH></tr>
                    </thead>
                    <tbody>
                      {a.mortalidad.recientes.length === 0 && (
                        <EmptyRow cols={3}>Sin bajas registradas. 🎉</EmptyRow>
                      )}
                      {a.mortalidad.recientes.map((m, i) => (
                        <tr key={`${m.arete}-${m.fecha}-${i}`}>
                          <TD><Arete href={fichaUrl(m.arete)}>{m.arete}</Arete></TD>
                          <TD title={m.causa}>{m.causa}</TD>
                          <TD className="whitespace-nowrap tabular-nums">{m.fecha}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              </div>
            </Section>

            {/* ---------------------------------------------------- LECHE */}
            <Section id="leche" title="Producción de leche" icon="🥛" subtitle="últimos 30 días">
              {a.leche.hayDatos ? (
                <KpiRow>
                  {/* Ahora sí es la producción del período: el hato se mide vaca
                      por vaca en los dos ordeños, todos los días. El rótulo viejo
                      («Litros medidos», «no del mes») venía de cuando
                      produccion_leche solo se llenaba cada 2-3 semanas. */}
                  <Kpi
                    label="Litros producidos"
                    value={a.leche.totalLitros30d}
                    tono="info"
                    hint="suma de los ordeños registrados"
                  />
                  <Kpi
                    label="Litros / día"
                    value={dash(a.leche.promLitrosDia)}
                    hint="sobre los días con registro"
                  />
                  <Kpi label="Vacas en ordeño" value={a.leche.vacasEnOrdeno} />
                  <Kpi
                    label="Litros / vaca / día"
                    value={dash(a.leche.promPorVacaDia)}
                    tono="campo"
                    hint="promedio del período"
                  />
                </KpiRow>
              ) : (
                <Card>
                  <p className="text-sm text-tierra-500">
                    Aún no se registra producción de leche. Se llenará con el control lechero —
                    el pesaje de todo el hato cada 2 o 3 semanas — y, cuando esté conectada,
                    con la medición automática por hardware (ESP32).
                  </p>
                </Card>
              )}
            </Section>
          </>
        )}

        {/* --------------------------------------------------------- ALERTAS */}
        <Section id="alertas" title="Alertas activas" icon="⚠️">
          <KpiRow>
            <Kpi label="Próximas / vencidas" value={dash(proximas?.length)} tono="aviso" />
            <Kpi label="Retiros de leche" value={dash(retiros?.length)} tono="info" />
            <Kpi label="Revisar preñez" value={dash(prenez?.length)} />
            <Kpi label="Rechequeo pendiente" value={dash(rechequeos?.length)} tono="aviso" />
          </KpiRow>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="📅 Próximas y vencidas" className="xl:col-span-2">
              <Table>
                <thead>
                  <tr>
                    <TH>Arete</TH><TH>Tipo</TH><TH>Producto</TH><TH>Fecha</TH><TH>Estado</TH>
                  </tr>
                </thead>
                <tbody>
                  {proximas === null && <EmptyRow cols={5}>No se pudo cargar.</EmptyRow>}
                  {proximas?.length === 0 && (
                    <EmptyRow cols={5}>Nada pendiente en los próximos 7 días.</EmptyRow>
                  )}
                  {proximas?.map((p, i) => (
                    <tr key={`${p.arete}-${p.proxima_fecha}-${i}`}>
                      <TD><Arete href={fichaUrl(p.arete)}>{p.arete}</Arete></TD>
                      <TD className="whitespace-nowrap">{TIPO_SANIDAD[p.tipo] || p.tipo}</TD>
                      <TD>{p.producto || '—'}</TD>
                      <TD className="whitespace-nowrap tabular-nums">{p.proxima_fecha}</TD>
                      <TD>
                        {p.vencida
                          ? <Badge tono="alerta">🔴 vencida {haceDias(p.dias)}</Badge>
                          : <Badge tono="aviso">🟡 {enDias(p.dias)}</Badge>}
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            <Card title="🥛 Retiro de leche vigente">
              <Table>
                <thead>
                  <tr><TH>Arete</TH><TH>Producto</TH><TH>Hasta</TH><TH>Falta</TH></tr>
                </thead>
                <tbody>
                  {retiros === null && <EmptyRow cols={4}>No se pudo cargar.</EmptyRow>}
                  {retiros?.length === 0 && (
                    <EmptyRow cols={4}>Ninguna vaca en retiro. Leche apta.</EmptyRow>
                  )}
                  {retiros?.map((r, i) => (
                    <tr key={`${r.arete}-${r.hasta}-${i}`}>
                      <TD><Arete href={fichaUrl(r.arete)}>{r.arete}</Arete></TD>
                      <TD>{r.producto || '—'}</TD>
                      <TD className="whitespace-nowrap tabular-nums">{r.hasta}</TD>
                      <TD><Badge tono="info">{enDias(r.dias)}</Badge></TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            <Card title="🔁 Rechequeo pendiente">
              <p className="mb-3 text-xs text-tierra-500">
                El veterinario marcó RECHE y falta volver a ecografiar. Se cierra solo
                al registrar el siguiente chequeo.
              </p>
              <Table>
                <thead>
                  <tr><TH>Arete</TH><TH>Desde</TH><TH>Espera</TH><TH>Observación</TH></tr>
                </thead>
                <tbody>
                  {rechequeos === null && <EmptyRow cols={4}>No se pudo cargar.</EmptyRow>}
                  {rechequeos?.length === 0 && (
                    <EmptyRow cols={4}>Ninguno pendiente.</EmptyRow>
                  )}
                  {rechequeos?.map((r, i) => (
                    <tr key={`${r.arete}-${r.fecha}-${i}`}>
                      <TD><Arete href={fichaUrl(r.arete)}>{r.arete}</Arete></TD>
                      <TD className="whitespace-nowrap tabular-nums">{r.fecha}</TD>
                      <TD><Badge tono="aviso">{r.dias === 0 ? 'hoy' : haceDias(-r.dias)}</Badge></TD>
                      <TD>{r.observaciones || '—'}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            <Card title="🔍 Revisar preñez">
              <p className="mb-3 text-xs text-tierra-500">
                Servidas hace más de {PRENEZ_DIAS} días y aún sin diagnóstico.
              </p>
              {prenez === null && <p className="text-sm text-tierra-400">No se pudo cargar.</p>}
              {prenez?.length === 0 && <p className="text-sm text-tierra-400">Ninguna pendiente.</p>}
              {prenez && prenez.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {prenez.map((arete) => (
                    <li key={arete}>
                      <a
                        href={fichaUrl(arete)}
                        className="block rounded-lg border border-tierra-200 bg-tierra-50 px-2.5 py-1 text-sm font-semibold tabular-nums text-tierra-800 hover:border-campo-300 hover:bg-campo-50 hover:text-campo-800"
                      >
                        {arete}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </Section>
      </div>

      <footer className="mt-10 border-t border-tierra-200 pt-4 text-xs leading-relaxed text-tierra-400">
        GDP = ganancia diaria de peso; necesita 2 o más pesajes por animal. Los días abiertos y el
        intervalo entre partos se calculan con los eventos de parto y servicio. Categorice los
        animales (levante / ceba) para separar mejor el rendimiento de peso.
      </footer>
    </div>
  );
}
