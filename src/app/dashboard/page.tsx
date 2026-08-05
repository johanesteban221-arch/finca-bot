import { getAnalytics } from '@/lib/analytics';
import { getProximas, getRetiros, getPrenezPendientes, PRENEZ_DIAS } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const C = {
  bg: '#f4f6f4', card: '#fff', border: '#e2e8e2', ink: '#1f2937', sub: '#6b7280',
  green: '#2f855a', amber: '#b7791f', red: '#c53030', blue: '#2b6cb0', track: '#edf2ed',
};
const dash = (x: number | null | undefined, suffix = '') => (x === null || x === undefined ? '—' : `${x}${suffix}`);

function Kpi({ label, value, color = C.ink, hint }: { label: string; value: string | number; color?: string; hint?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', minWidth: 140 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 12px', color: C.ink }}>{title}</h2>
      {children}
    </section>
  );
}

function Card({ children, flex = '1 1 320px' }: { children: React.ReactNode; flex?: string }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, flex }}>{children}</div>;
}

function Bars({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div>
      {entries.length === 0 && <span style={{ color: C.sub }}>Sin datos.</span>}
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <div style={{ width: 130, fontSize: 13, color: C.ink, textTransform: 'capitalize' }}>{k}</div>
          <div style={{ flex: 1, background: C.track, borderRadius: 6, height: 16 }}>
            <div style={{ width: `${(v / max) * 100}%`, background: C.green, height: 16, borderRadius: 6 }} />
          </div>
          <div style={{ width: 32, textAlign: 'right', fontSize: 13, fontWeight: 600 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: C.sub, borderBottom: `1px solid ${C.border}` };
const td: React.CSSProperties = { padding: '6px 8px', fontSize: 13, borderBottom: `1px solid ${C.track}` };

function Empty({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <tr><td style={td} colSpan={cols}><span style={{ color: C.sub }}>{children}</span></td></tr>;
}

// Shown when a query failed. The point is that a broken query must never be
// indistinguishable from "no hay nada que reportar".
function Banner({ fallos }: { fallos: string[] }) {
  return (
    <div style={{ background: '#fff5f5', border: `1px solid ${C.red}`, borderRadius: 12, padding: '12px 16px', marginBottom: 20 }}>
      <b style={{ color: C.red, fontSize: 14 }}>⚠️ Datos incompletos</b>
      <p style={{ margin: '6px 0 0', fontSize: 13, color: C.ink }}>
        No se pudieron cargar algunos indicadores. Lo que falta aparece como «—», no como cero.
      </p>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: C.sub }}>
        {fallos.map((f) => <li key={f}>{f}</li>)}
      </ul>
    </div>
  );
}

const TIPO_SANIDAD: Record<string, string> = {
  vacuna: '💉 Vacunación', tratamiento: '🔴 Tratamiento',
  desparasitacion: '🪱 Desparasitación', revision: '🩺 Revisión',
};

const errorOf = (r: PromiseRejectedResult) =>
  r.reason instanceof Error ? r.reason.message : String(r.reason);

/** Plural-aware day countdown used by the alert tables. */
const enDias = (d: number) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);
const haceDias = (d: number) => (d === -1 ? 'ayer' : `hace ${Math.abs(d)} días`);

export default async function Dashboard() {
  // allSettled, not all: one failing query should degrade its own section
  // instead of blanking the whole tablero.
  const [aRes, proxRes, retRes, prenezRes] = await Promise.allSettled([
    getAnalytics(), getProximas(), getRetiros(), getPrenezPendientes(),
  ]);

  const a = aRes.status === 'fulfilled' ? aRes.value : null;
  const proximas = proxRes.status === 'fulfilled' ? proxRes.value : null;
  const retiros = retRes.status === 'fulfilled' ? retRes.value : null;
  const prenez = prenezRes.status === 'fulfilled' ? prenezRes.value : null;

  const fallos = ([
    ['Indicadores del hato', aRes],
    ['Próximas / vencidas', proxRes],
    ['Retiros de leche', retRes],
    ['Revisar preñez', prenezRes],
  ] as const)
    .filter(([, r]) => r.status === 'rejected')
    .map(([label, r]) => `${label} — ${errorOf(r as PromiseRejectedResult)}`);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', background: C.bg, minHeight: '100vh', margin: 0, padding: '28px 24px', color: C.ink }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>🐄 Finca — Tablero de gestión</h1>
        <p style={{ margin: '0 0 22px', color: C.sub, fontSize: 14 }}>Indicadores productivos y reproductivos. Datos en vivo desde Supabase.</p>

        {fallos.length > 0 && <Banner fallos={fallos} />}

        {/* INVENTARIO */}
        {a && (
        <Section title="📋 Inventario del hato">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <Kpi label="Activos" value={a.inventario.activos} color={C.green} />
            <Kpi label="Hembras" value={a.inventario.hembras} />
            <Kpi label="Machos" value={a.inventario.machos} />
            <Kpi label="Muertos (hist.)" value={a.inventario.muertos} color={C.red} />
            <Kpi label="Vendidos (hist.)" value={a.inventario.vendidos} color={C.blue} />
          </div>
          <Card flex="1 1 100%"><b style={{ fontSize: 14 }}>Por categoría</b><div style={{ marginTop: 8 }}><Bars data={a.inventario.porCategoria} /></div></Card>
        </Section>
        )}

        {/* REPRODUCTIVO · PESO · LECHE — all come from getAnalytics() */}
        {a && (<>
        <Section title="🍼 Reproductivo">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi label="Tasa de preñez" value={dash(a.reproductivo.tasaPrenezPct, '%')} color={C.blue} hint={`${a.reproductivo.prenadasDx}/${a.reproductivo.diagnosticos} dx positivos`} />
            <Kpi label="Días abiertos (prom.)" value={dash(a.reproductivo.diasAbiertosProm)} hint="parto → preñez" />
            <Kpi label="Parto → 1er servicio" value={dash(a.reproductivo.diasParto1erServicioProm, ' d')} />
            <Kpi label="Interv. entre partos" value={dash(a.reproductivo.iepProm, ' d')} />
            <Kpi label="Servicios/concepción" value={dash(a.reproductivo.serviciosPorConcepcion)} />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card><b style={{ fontSize: 14 }}>Estado reproductivo (hembras)</b><div style={{ marginTop: 8 }}><Bars data={a.reproductivo.distribucion} /></div></Card>
            <Card>
              <b style={{ fontSize: 14 }}>Próximos partos estimados</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={th}>Arete</th><th style={th}>Fecha est.</th><th style={th}>Faltan</th></tr></thead>
                <tbody>
                  {a.reproductivo.proximosPartos.length === 0 && <tr><td style={td} colSpan={3}><span style={{ color: C.sub }}>Sin preñeces con servicio registrado.</span></td></tr>}
                  {a.reproductivo.proximosPartos.map((p) => (
                    <tr key={p.arete}><td style={td}><b>{p.arete}</b></td><td style={td}>{p.fechaEstimada}</td><td style={td}>{p.diasRestantes} d</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </Section>

        {/* PESO / GDP */}
        <Section title="⚖️ Peso y ganancia (levante / ceba)">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi label="GDP promedio del hato" value={dash(a.peso.gdpHatoProm, ' g/día')} color={C.green} hint={`${a.peso.conGdp} animales con ≥2 pesajes`} />
            <Kpi label="Sin 2º pesaje" value={a.peso.sinSegundoPesaje} color={C.amber} hint="pesa de nuevo para calcular GDP" />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card>
              <b style={{ fontSize: 14 }}>Por categoría</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={th}>Categoría</th><th style={th}>#</th><th style={th}>Peso prom.</th><th style={th}>GDP prom.</th></tr></thead>
                <tbody>
                  {a.peso.porCategoria.map((r) => (
                    <tr key={r.categoria}>
                      <td style={td} title={r.categoria}>{r.categoria}</td><td style={td}>{r.nAnimales}</td>
                      <td style={td}>{dash(r.pesoProm, ' kg')}</td><td style={td}>{dash(r.gdpProm, ' g/d')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card>
              <b style={{ fontSize: 14 }}>Mejor ganancia (top)</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={th}>Arete</th><th style={th}>Peso actual</th><th style={th}>GDP</th></tr></thead>
                <tbody>
                  {a.peso.top.length === 0 && <tr><td style={td} colSpan={3}><span style={{ color: C.sub }}>Aún no hay animales con 2+ pesajes.</span></td></tr>}
                  {a.peso.top.map((r) => (
                    <tr key={r.arete}><td style={td}><b>{r.arete}</b></td><td style={td}>{r.pesoActual} kg</td><td style={td}>{dash(r.gdp, ' g/d')}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </Section>

        {/* LECHE */}
        <Section title="🥛 Producción de leche (30 días)">
          {a.leche.hayDatos ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Kpi label="Litros totales" value={a.leche.totalLitros30d} color={C.blue} />
              <Kpi label="Litros/día (prom.)" value={dash(a.leche.promLitrosDia)} />
              <Kpi label="Vacas en ordeño" value={a.leche.vacasEnOrdeno} />
              <Kpi label="Litros/vaca/día" value={dash(a.leche.promPorVacaDia)} color={C.green} />
            </div>
          ) : (
            <Card flex="1 1 100%">
              <span style={{ color: C.sub }}>
                Aún no se registra producción de leche. Falta agregar el flujo <b>🥛 Producción de leche</b> al bot
                (vaca → litros → confirmar). Cuando lo activemos, estos indicadores se llenarán solos.
              </span>
            </Card>
          )}
        </Section>

        {/* SANIDAD */}
        <Section title={`🩺 Sanidad (últimos ${a.sanidad.ventanaDias} días)`}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi label="Eventos registrados" value={a.sanidad.total} color={C.green} />
            <Kpi label="Vacunaciones" value={a.sanidad.porTipo.vacuna || 0} />
            <Kpi label="Tratamientos" value={a.sanidad.porTipo.tratamiento || 0} color={C.red} />
            <Kpi label="Desparasitaciones" value={a.sanidad.porTipo.desparasitacion || 0} />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card>
              <b style={{ fontSize: 14 }}>Diagnósticos más frecuentes</b>
              <div style={{ marginTop: 8 }}>
                <Bars data={Object.fromEntries(a.sanidad.diagnosticosTop.map((d) => [d.diagnostico, d.n]))} />
              </div>
            </Card>
            <Card>
              <b style={{ fontSize: 14 }}>Últimos eventos</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={th}>Arete</th><th style={th}>Tipo</th><th style={th}>Producto</th><th style={th}>Fecha</th></tr></thead>
                <tbody>
                  {a.sanidad.recientes.length === 0 && <Empty cols={4}>Sin eventos sanitarios en la ventana.</Empty>}
                  {a.sanidad.recientes.map((e, i) => (
                    <tr key={`${e.arete}-${e.fecha}-${i}`}>
                      <td style={td}><b>{e.arete}</b></td>
                      <td style={td}>{TIPO_SANIDAD[e.tipo] || e.tipo}</td>
                      <td style={td}>{e.producto || (e.diagnostico ?? '—')}</td>
                      <td style={td}>{e.fecha}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </Section>

        {/* MORTALIDAD */}
        <Section title="💀 Mortalidad">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi label="Muertes (12 meses)" value={a.mortalidad.ultimos12Meses} color={C.red} />
            <Kpi label="Tasa anual aprox." value={dash(a.mortalidad.tasaAnualPct, '%')} color={C.amber} hint="muertes / (activos + muertes)" />
            <Kpi label="Total histórico" value={a.mortalidad.total} />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card>
              <b style={{ fontSize: 14 }}>Causas (12 meses)</b>
              <div style={{ marginTop: 8 }}><Bars data={a.mortalidad.porCausa} /></div>
            </Card>
            <Card>
              <b style={{ fontSize: 14 }}>Últimas bajas</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={th}>Arete</th><th style={th}>Causa</th><th style={th}>Fecha</th></tr></thead>
                <tbody>
                  {a.mortalidad.recientes.length === 0 && <Empty cols={3}>Sin bajas registradas. 🎉</Empty>}
                  {a.mortalidad.recientes.map((m, i) => (
                    <tr key={`${m.arete}-${m.fecha}-${i}`}>
                      <td style={td}><b>{m.arete}</b></td>
                      <td style={td} title={m.causa}>{m.causa}</td>
                      <td style={td}>{m.fecha}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </Section>
        </>)}

        {/* ALERTAS */}
        <Section title="⚠️ Alertas activas">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi label="Próximas / vencidas" value={dash(proximas?.length)} color={C.amber} />
            <Kpi label="Retiros de leche" value={dash(retiros?.length)} color={C.blue} />
            <Kpi label="Revisar preñez" value={dash(prenez?.length)} />
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <Card flex="1 1 460px">
              <b style={{ fontSize: 14 }}>📅 Próximas y vencidas</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={th}>Arete</th><th style={th}>Tipo</th><th style={th}>Producto</th><th style={th}>Fecha</th><th style={th}>Estado</th></tr></thead>
                <tbody>
                  {proximas === null && <Empty cols={5}>No se pudo cargar.</Empty>}
                  {proximas?.length === 0 && <Empty cols={5}>Nada pendiente en los próximos 7 días.</Empty>}
                  {proximas?.map((p, i) => (
                    <tr key={`${p.arete}-${p.proxima_fecha}-${i}`}>
                      <td style={td}><b>{p.arete}</b></td>
                      <td style={td}>{TIPO_SANIDAD[p.tipo] || p.tipo}</td>
                      <td style={td}>{p.producto || '—'}</td>
                      <td style={td}>{p.proxima_fecha}</td>
                      <td style={{ ...td, color: p.vencida ? C.red : C.amber, fontWeight: 600 }}>
                        {p.vencida ? `🔴 vencida ${haceDias(p.dias)}` : `🟡 ${enDias(p.dias)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card flex="1 1 380px">
              <b style={{ fontSize: 14 }}>🥛 Retiro de leche vigente</b>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
                <thead><tr><th style={th}>Arete</th><th style={th}>Producto</th><th style={th}>Hasta</th><th style={th}>Falta</th></tr></thead>
                <tbody>
                  {retiros === null && <Empty cols={4}>No se pudo cargar.</Empty>}
                  {retiros?.length === 0 && <Empty cols={4}>Ninguna vaca en retiro. Leche apta.</Empty>}
                  {retiros?.map((r, i) => (
                    <tr key={`${r.arete}-${r.hasta}-${i}`}>
                      <td style={td}><b>{r.arete}</b></td>
                      <td style={td}>{r.producto || '—'}</td>
                      <td style={td}>{r.hasta}</td>
                      <td style={{ ...td, color: C.blue, fontWeight: 600 }}>{enDias(r.dias)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card flex="1 1 260px">
              <b style={{ fontSize: 14 }}>🔍 Revisar preñez</b>
              <p style={{ margin: '4px 0 8px', fontSize: 12, color: C.sub }}>
                Servidas hace más de {PRENEZ_DIAS} días y aún sin diagnóstico.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Arete</th></tr></thead>
                <tbody>
                  {prenez === null && <Empty cols={1}>No se pudo cargar.</Empty>}
                  {prenez?.length === 0 && <Empty cols={1}>Ninguna pendiente.</Empty>}
                  {prenez?.map((arete) => (
                    <tr key={arete}><td style={td}><b>{arete}</b></td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </Section>

        <p style={{ marginTop: 10, color: C.sub, fontSize: 12 }}>
          GDP = ganancia diaria de peso (necesita 2+ pesajes). Días abiertos / IEP se calculan con eventos de parto y servicio.
          Categoriza los animales (levante/ceba) para separar mejor el rendimiento de peso.
        </p>
      </div>
    </main>
  );
}
