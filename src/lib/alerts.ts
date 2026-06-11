import { supabase } from './supabase';

// Shared alert queries used by both the daily-alerts cron and the web dashboard.

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
};

export const PRENEZ_DIAS = 40; // days after service to suggest a pregnancy check

export type Proxima = { arete: string; tipo: string; producto: string; proxima_fecha: string; vencida: boolean };
export type Retiro = { arete: string; producto: string; hasta: string };

// Upcoming / overdue sanitary events (vaccines, treatments, dewormings) within a window.
export async function getProximas(): Promise<Proxima[]> {
  const hoy = today();
  const { data } = await supabase
    .from('eventos_sanitarios')
    .select('tipo, producto, proxima_fecha, animales(arete)')
    .not('proxima_fecha', 'is', null)
    .lte('proxima_fecha', shift(7))
    .gte('proxima_fecha', shift(-60))
    .order('proxima_fecha', { ascending: true })
    .limit(50);
  return (data || []).map((p: any) => ({
    arete: p.animales?.arete || '?',
    tipo: p.tipo,
    producto: p.producto || '',
    proxima_fecha: p.proxima_fecha,
    vencida: p.proxima_fecha < hoy,
  }));
}

// Active milk-withdrawal periods.
export async function getRetiros(): Promise<Retiro[]> {
  const { data } = await supabase
    .from('eventos_sanitarios')
    .select('producto, retiro_leche_hasta, animales(arete)')
    .gte('retiro_leche_hasta', today())
    .order('retiro_leche_hasta', { ascending: true })
    .limit(50);
  return (data || []).map((r: any) => ({
    arete: r.animales?.arete || '?',
    producto: r.producto || '',
    hasta: r.retiro_leche_hasta,
  }));
}

// Cows served > PRENEZ_DIAS days ago that are still 'servida' (need a pregnancy check).
export async function getPrenezPendientes(): Promise<string[]> {
  const { data } = await supabase
    .from('eventos_reproductivos')
    .select('fecha, animales!inner(arete, estado_reproductivo)')
    .eq('tipo', 'servicio')
    .lte('fecha', shift(-PRENEZ_DIAS))
    .eq('animales.estado_reproductivo', 'servida')
    .order('fecha', { ascending: true })
    .limit(50);
  // A cow may have several old service events — dedupe by arete.
  return Array.from(new Set((data || []).map((s: any) => s.animales?.arete).filter(Boolean)));
}
