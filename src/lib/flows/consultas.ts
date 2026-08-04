// Read-only queries. `verAnimal` is a one-step flow (needs an arete); `showAlertas`
// and `showResumen` are immediate actions with no session state.

import { sendText } from '../whatsapp';
import { saveSession, clearSession } from '../session';
import { supabase } from '../supabase';
import { findAnimal, sexoTitle } from '../animals';
import {
  Flow, today, addDays, validArete, SEP, MSG_INVALID_ARETE,
} from '../state-machine';

// =====================================================================
// Consulta: Ver animal — ficha + últimos eventos
// =====================================================================
export const verAnimal: Flow = {
  async start(to, session) {
    await saveSession({ ...session, current_flow: 'consulta.ver', current_step: 1, temp_data: {} });
    await sendText(to, '🐄 *Ver animal*\nEscribe el número de arete: (ej. 045)');
  },

  async handle(inc, session) {
    const to = inc.from;
    if (session.current_step !== 1 || inc.kind !== 'text') {
      await clearSession(to);
      return void sendText(to, '⚠️ Escribe *menú* para reiniciar.');
    }
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, MSG_INVALID_ARETE);

    const animal = await findAnimal(arete);
    await clearSession(to);
    if (!animal) {
      return void sendText(to, `🐄 No encontré ningún animal con arete *${arete}*.\n\nEscribe *menú* para volver.`);
    }

    const { data: hist } = await supabase
      .from('vw_historial_animal')
      .select('fecha, categoria, evento, descripcion')
      .eq('animal_id', animal.id)
      .order('fecha', { ascending: false })
      .limit(8);

    const iconos: Record<string, string> = {
      sanitario: '🩺', pesaje: '⚖️', reproductivo: '🍼', produccion_leche: '🥛', movimiento: '📦',
    };
    const lineas = (hist || []).length
      ? (hist || []).map((h: any) => `${iconos[h.categoria] || '•'} ${h.fecha} — ${h.evento}: ${h.descripcion || ''}`.trim()).join('\n')
      : '_Sin eventos registrados aún._';

    const ficha =
      `🐄 *Animal ${animal.arete}*${animal.nombre ? ` — ${animal.nombre}` : ''}\n` +
      `Sexo: ${sexoTitle(animal.sexo)}${animal.raza ? ` · Raza: ${animal.raza}` : ''}\n` +
      `Estado: ${animal.estado}${animal.estado_reproductivo ? ` · Repro: ${animal.estado_reproductivo}` : ''}\n` +
      `${SEP}\n📜 *Últimos eventos:*\n${lineas}\n\nEscribe *menú* para volver.`;

    return void sendText(to, ficha);
  },
};

// =====================================================================
// Consulta: Alertas activas (próximas/vencidas + retiros de leche)
// =====================================================================
export async function showAlertas(to: string): Promise<void> {
  const limite = addDays(7);
  const { data: prox } = await supabase
    .from('eventos_sanitarios')
    .select('tipo, producto, proxima_fecha, animales(arete)')
    .lte('proxima_fecha', limite)
    .order('proxima_fecha', { ascending: true })
    .limit(15);

  const { data: retiros } = await supabase
    .from('eventos_sanitarios')
    .select('producto, retiro_leche_hasta, animales(arete)')
    .gte('retiro_leche_hasta', today())
    .order('retiro_leche_hasta', { ascending: true })
    .limit(15);

  const proxLineas = (prox || []).length
    ? (prox || []).map((p: any) => {
        const vencida = p.proxima_fecha < today();
        return `${vencida ? '🔴' : '🟡'} Arete ${p.animales?.arete || '?'} — ${p.tipo} (${p.producto || ''}) → ${p.proxima_fecha}`;
      }).join('\n')
    : '_Nada próximo en 7 días._';

  const retLineas = (retiros || []).length
    ? (retiros || []).map((r: any) => `🥛 Arete ${r.animales?.arete || '?'} — ${r.producto || ''} hasta ${r.retiro_leche_hasta}`).join('\n')
    : '_Sin retiros de leche activos._';

  await sendText(
    to,
    `⚠️ *Alertas activas*\n${SEP}\n📅 *Próximas / vencidas (7 días):*\n${proxLineas}\n\n🥛 *Retiro de leche vigente:*\n${retLineas}\n\nEscribe *menú* para volver.`,
  );
}

// =====================================================================
// Consulta: Resumen del día (lo registrado hoy)
// =====================================================================
export async function showResumen(to: string): Promise<void> {
  const hoy = today();
  const countWhere = async (table: string, extra: Record<string, string> = {}) => {
    let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('fecha', hoy);
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
    const { count } = await q;
    return count || 0;
  };

  const [vac, trat, desp, pes, serv, dx, parto, muertes] = await Promise.all([
    countWhere('eventos_sanitarios', { tipo: 'vacuna' }),
    countWhere('eventos_sanitarios', { tipo: 'tratamiento' }),
    countWhere('eventos_sanitarios', { tipo: 'desparasitacion' }),
    countWhere('pesajes'),
    countWhere('eventos_reproductivos', { tipo: 'servicio' }),
    countWhere('eventos_reproductivos', { tipo: 'diagnostico_prenez' }),
    countWhere('eventos_reproductivos', { tipo: 'parto' }),
    countWhere('movimientos', { tipo: 'muerte' }),
  ]);

  await sendText(
    to,
    `📋 *Resumen del día* (${hoy})\n${SEP}\n💉 Vacunaciones: ${vac}\n🔴 Tratamientos: ${trat}\n🪱 Desparasitaciones: ${desp}\n⚖️ Pesajes: ${pes}\n🐂 Servicios: ${serv}\n🔍 Dx preñez: ${dx}\n🍼 Partos: ${parto}\n💀 Bajas: ${muertes}\n${SEP}\nEscribe *menú* para volver.`,
  );
}
