import { supabase, unwrapList } from './supabase';
import { FINCA_ID } from './tenant';

// Shared alert queries used by both the daily-alerts cron and the web dashboard.
// Cada una filtra por finca_id: RLS está dormida bajo service_role, así que ese
// .eq() es el aislamiento entre fincas, no un cinturón de más.
// These throw on a failed query rather than returning an empty list: "no hay
// alertas" and "no pude consultar las alertas" must never look the same, because
// the first one is what the owner acts on at 6 AM.

import { today, addDays, daysBetween } from './dates';

// Re-exported under the names the cron route already imports. Alert windows are
// farm-local calendar days, so they must agree with the dates the flows write.
export { today };
export const shift = addDays;

export const PRENEZ_DIAS = 40; // days after service to suggest a pregnancy check

// How far back to look for check-ups when working out which animals are still
// waiting for a re-check. A pending RECHE older than this is not dropped from
// the herd's reality, only from this alert — at six months the answer is a fresh
// check-up, not a reminder. The bound also keeps the query from growing without
// limit (see pending item #7 in CLAUDE.md).
export const RECHEQUEO_VENTANA_DIAS = 180;

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
export type Rechequeo = {
  arete: string;
  /** Date of the check-up that left the re-check pending. */
  fecha: string;
  /** Days elapsed since then. Always >= 0 — a check-up cannot be in the future. */
  dias: number;
  veterinario: string;
  observaciones: string | null;
};

// Upcoming / overdue sanitary events (vaccines, treatments, dewormings) within a window.
export async function getProximas(): Promise<Proxima[]> {
  const hoy = today();
  const res = await supabase
    .from('eventos_sanitarios')
    .select('tipo, producto, proxima_fecha, animales(arete)')
    .eq('finca_id', FINCA_ID)
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
    .eq('finca_id', FINCA_ID)
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

/**
 * Animals whose most recent reproductive check-up came back RECHE — the vet
 * could not call it and asked to scan again.
 *
 * "Most recent" is the whole rule, and it is why there is no `resuelto` column
 * to maintain: recording the next check-up closes the re-check automatically,
 * whatever its outcome. A second RECHE keeps it open, which is correct. A flag
 * would need someone to remember to clear it, and the one thing this alert
 * exists to prevent is someone forgetting.
 *
 * The latest-per-animal reduction runs in JS rather than SQL because that is
 * the shape PostgREST gives us (no DISTINCT ON), and it keeps the rule in the
 * same place as the rest of the alert logic, under test. The window plus the
 * row cap bound what it has to chew through.
 */
export async function getRechequeosPendientes(): Promise<Rechequeo[]> {
  const hoy = today();
  const res = await supabase
    .from('chequeos_reproductivos')
    .select('fecha, estado_codigo, veterinario, observaciones, created_at, animales!inner(arete, estado)')
    .eq('finca_id', FINCA_ID)
    .eq('animales.estado', 'activo')
    .gte('fecha', shift(-RECHEQUEO_VENTANA_DIAS))
    // created_at breaks ties when a cow was checked twice on the same day.
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000);

  const ultimoPorAnimal = new Map<string, any>();
  for (const c of unwrapList<any>(res, 'chequeos_reproductivos (rechequeos)')) {
    const arete = c.animales?.arete;
    // Rows arrive newest-first, so the first one seen per animal is the latest.
    if (arete && !ultimoPorAnimal.has(arete)) ultimoPorAnimal.set(arete, c);
  }

  return Array.from(ultimoPorAnimal.entries())
    .filter(([, c]) => c.estado_codigo === 'RECHE')
    .map(([arete, c]) => ({
      arete,
      fecha: c.fecha,
      dias: daysBetween(c.fecha, hoy),
      veterinario: c.veterinario || '',
      observaciones: c.observaciones ?? null,
    }))
    // Oldest first: the one that has been waiting longest is the one being forgotten.
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Cows served > PRENEZ_DIAS days ago that are still 'servida' (need a pregnancy check).
//
// ⚠️ El embed lleva la pista `!animal_id` y no puede perderla. `eventos_reproductivos`
// apunta a `animales` por TRES caminos — animal_id (la vaca), toro_id (el toro del
// servicio) y cria_id (la cría del parto) — así que un `animales(...)` a secas es
// ambiguo y PostgREST responde "more than one relationship was found" en vez de
// devolver filas. Aquí la vaca servida es SIEMPRE animal_id: por toro_id saldría el
// toro, que nunca está 'servida', y la alerta callaría sin dar error.
export async function getPrenezPendientes(): Promise<string[]> {
  const res = await supabase
    .from('eventos_reproductivos')
    .select('fecha, animales!animal_id!inner(arete, estado_reproductivo)')
    .eq('finca_id', FINCA_ID)
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
