import { getAnalytics } from '@/lib/analytics';
import { getProximas, getRetiros, getPrenezPendientes } from '@/lib/alerts';

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

export default async function Dashboard() {
  const [a, proximas, retiros, prenez] = await Promise.all([
    getAnalytics(), getProximas(), getRetiros(), getPrenezPendientes(),
  ]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', background: C.bg, minHeight: '100vh', margin: 0, padding: '28px 24px', color: C.ink }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>🐄 Finca — Tablero de gestión</h1>
        <p style={{ margin: '0 0 22px', color: C.sub, fontSize: 14 }}>Indicadores productivos y reproductivos. Datos en vivo desde Supabase.</p>

        {/* INVENTARIO */}
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

        {/* REPRODUCTIVO */}
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

        {/* ALERTAS */}
        <Section title="⚠️ Alertas activas">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Kpi label="Próximas / vencidas" value={proximas.length} color={C.amber} />
            <Kpi label="Retiros de leche" value={retiros.length} color={C.blue} />
            <Kpi label="Revisar preñez" value={prenez.length} />
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
