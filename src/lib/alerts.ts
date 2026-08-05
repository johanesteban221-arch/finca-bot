import { supabase, unwrapList } from './supabase';

// Shared alert queries used by both the daily-alerts cron and the web dashboard.
// These throw on a failed query rather than returning an empty list: "no hay
// alertas" and "no pude consultar las alertas" must never look the same, because
// the first one is what the owner acts on at 6 AM.

import { today, addDays, daysBetween } from './dates';

// Re-exported under the names the cron route already imports. Alert windows are
// farm-local calendar days, so they must agree with the dates the flows write.
export { today };
export const shift = addDays;

export const PRENEZ_DIAS = 40; // days after service to suggest a pregnancy check

export type Proxima = {
  arete: string; tipo: string; producto: string; proxima_fecha: string;
  vencida: boolean;
  /** Days until due. Negative when overdue. */
  dias: number;
};
export type Retiro = {
  arete: string; producto: string; hasta: string;
  /** Days until the withdrawal period ends. 0 means it clears today. */
  dias: number;
};

// Upcoming / overdue sanitary events (vaccines, treatments, dewormings) within a window.
export async function getProximas(): Promise<Proxima[]> {
  const hoy = today();
  const res = await supabase
    .from('eventos_sanitarios')
    .select('tipo, producto, proxima_fecha, animales(arete)')
    .not('proxima_fecha', 'is', null)
    .lte('proxima_fecha', shift(7))
    .gte('proxima_fecha', shift(-60))
    .order('proxima_fecha', { ascending: true })
    .limit(50);
  return unwrapList<any>(res, 'eventos_sanitarios (próximas)').map((p) => ({
    arete: p.animales?.arete || '?',
    tipo: p.tipo,
    producto: p.producto || '',
    proxima_fecha: p.proxima_fecha,
    vencida: p.proxima_fecha < hoy,
    dias: daysBetween(hoy, p.proxima_fecha),
  }));
}

// Active milk-withdrawal periods.
export async function getRetiros(): Promise<Retiro[]> {
  const hoy = today();
  const res = await supabase
    .from('eventos_sanitarios')
    .select('producto, retiro_leche_hasta, animales(arete)')
    .gte('retiro_leche_hasta', hoy)
    .order('retiro_leche_hasta', { ascending: true })
    .limit(50);
  return unwrapList<any>(res, 'eventos_sanitarios (retiros)').map((r) => ({
    arete: r.animales?.arete || '?',
    producto: r.producto || '',
    hasta: r.retiro_leche_hasta,
    dias: daysBetween(hoy, r.retiro_leche_hasta),
  }));
}

// Cows served > PRENEZ_DIAS days ago that are still 'servida' (need a pregnancy check).
export async function getPrenezPendientes(): Promise<string[]> {
  const res = await supabase
    .from('eventos_reproductivos')
    .select('fecha, animales!inner(arete, estado_reproductivo)')
    .eq('tipo', 'servicio')
    .lte('fecha', shift(-PRENEZ_DIAS))
    .eq('animales.estado_reproductivo', 'servida')
    .order('fecha', { ascending: true })
    .limit(50);
  // A cow may have several old service events — dedupe by arete.
  return Array.from(
    new Set(
      unwrapList<any>(res, 'eventos_reproductivos (preñez pendiente)')
        .map((s) => s.animales?.arete)
        .filter(Boolean),
    ),
  );
}
