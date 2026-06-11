import { getDashboard } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const C = {
  bg: '#f4f6f4', card: '#ffffff', border: '#e2e8e2', ink: '#1f2937', sub: '#6b7280',
  green: '#2f855a', amber: '#b7791f', red: '#c53030', blue: '#2b6cb0',
};

function Kpi({ label, value, color = C.ink }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', minWidth: 120 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, flex: '1 1 300px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: C.ink }}>{title}</h3>
        <span style={{ fontSize: 13, color: C.sub }}>{count}</span>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.7, color: C.ink }}>{children}</div>
    </div>
  );
}

export default async function Dashboard() {
  const d = await getDashboard();
  const empty = <span style={{ color: C.sub }}>Nada pendiente.</span>;

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', background: C.bg, minHeight: '100vh', margin: 0, padding: '28px 24px', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>🐄 Finca — Tablero</h1>
        <p style={{ margin: '0 0 22px', color: C.sub, fontSize: 14 }}>Resumen del hato y alertas activas.</p>

        {/* KPIs del hato */}
        <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
          <Kpi label="Animales activos" value={d.hato.activos} color={C.green} />
          <Kpi label="Hembras" value={d.hato.hembras} />
          <Kpi label="Machos" value={d.hato.machos} />
          <Kpi label="Preñadas" value={d.hato.prenadas} color={C.blue} />
          <Kpi label="Servidas" value={d.hato.servidas} color={C.amber} />
          <Kpi label="Terneros" value={d.hato.terneros} />
        </section>

        {/* Alertas */}
        <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>⚠️ Alertas</h2>
        <section style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
          <Panel title="📅 Próximas / vencidas" count={d.alertas.proximas.length}>
            {d.alertas.proximas.length ? d.alertas.proximas.map((p, i) => (
              <div key={i}>
                <span style={{ color: p.vencida ? C.red : C.amber }}>{p.vencida ? '🔴' : '🟡'}</span>{' '}
                <b>{p.arete}</b> · {p.tipo} {p.producto && `(${p.producto})`} → {p.proxima_fecha}
              </div>
            )) : empty}
          </Panel>

          <Panel title="🥛 Retiro de leche" count={d.alertas.retiros.length}>
            {d.alertas.retiros.length ? d.alertas.retiros.map((r, i) => (
              <div key={i}><b>{r.arete}</b> · {r.producto} hasta {r.hasta}</div>
            )) : empty}
          </Panel>

          <Panel title="🔍 Revisar preñez" count={d.alertas.prenez.length}>
            {d.alertas.prenez.length ? d.alertas.prenez.map((a, i) => (
              <div key={i}><b>{a}</b> · servida +40 días</div>
            )) : empty}
          </Panel>
        </section>

        {/* Actividad últimos 7 días */}
        <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>📊 Últimos 7 días</h2>
        <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Kpi label="Eventos sanitarios" value={d.actividad7d.sanitarios} />
          <Kpi label="Pesajes" value={d.actividad7d.pesajes} />
          <Kpi label="Eventos reproductivos" value={d.actividad7d.reproductivos} />
          <Kpi label="Partos" value={d.actividad7d.partos} />
          <Kpi label="Bajas" value={d.actividad7d.bajas} color={C.red} />
          <Kpi label="Litros de leche" value={d.litros7d} color={C.blue} />
        </section>

        <p style={{ marginTop: 28, color: C.sub, fontSize: 12 }}>
          Actualizado en vivo desde Supabase. Datos del bot de WhatsApp.
        </p>
      </div>
    </main>
  );
}
