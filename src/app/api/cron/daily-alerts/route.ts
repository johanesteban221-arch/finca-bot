import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendText, sendTemplate } from '@/lib/whatsapp';
import { getProximas, getRetiros, getPrenezPendientes, today, shift, PRENEZ_DIAS } from '@/lib/alerts';

// Approved WhatsApp template for the daily summary (delivers outside the 24h window).
const ALERT_TEMPLATE = process.env.WHATSAPP_ALERT_TEMPLATE || 'alerta_diaria_finca';
const ALERT_TEMPLATE_LANG = process.env.WHATSAPP_ALERT_TEMPLATE_LANG || 'es';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Daily alerts cron. Triggered by n8n (Schedule -> HTTP Request) at 06:00 America/Bogota.
// Protected by ?secret=CRON_SECRET. Computes the day's alerts and pushes them to the owner(s).
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const hoy = today();
  const ayer = shift(-1);

  const [prox, retiros, prenez] = await Promise.all([getProximas(), getRetiros(), getPrenezPendientes()]);

  // Yesterday's activity counts.
  const countYesterday = async (table: string, extra: Record<string, string> = {}) => {
    let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('fecha', ayer);
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
    const { count } = await q;
    return count || 0;
  };
  const [vac, trat, desp, pes, serv, parto, muertes] = await Promise.all([
    countYesterday('eventos_sanitarios', { tipo: 'vacuna' }),
    countYesterday('eventos_sanitarios', { tipo: 'tratamiento' }),
    countYesterday('eventos_sanitarios', { tipo: 'desparasitacion' }),
    countYesterday('pesajes'),
    countYesterday('eventos_reproductivos', { tipo: 'servicio' }),
    countYesterday('eventos_reproductivos', { tipo: 'parto' }),
    countYesterday('movimientos', { tipo: 'muerte' }),
  ]);

  // ---- Build the message ----
  const proxLineas = prox.length
    ? prox.map((p) => `${p.vencida ? '🔴' : '🟡'} ${p.arete} · ${p.tipo} (${p.producto}) → ${p.proxima_fecha}`).join('\n')
    : '_Nada pendiente._';

  const retLineas = retiros.length
    ? retiros.map((r) => `🥛 ${r.arete} · ${r.producto} hasta ${r.hasta}`).join('\n')
    : '_Sin retiros activos._';

  const prenezLineas = prenez.length
    ? prenez.map((a) => `🔍 ${a} · servida hace +${PRENEZ_DIAS}d → revisar preñez`).join('\n')
    : '_Ninguna pendiente._';

  const resumen = `💉 ${vac} · 🔴 ${trat} · 🪱 ${desp} · ⚖️ ${pes} · 🐂 ${serv} · 🍼 ${parto} · 💀 ${muertes}`;
  const totalAlertas = prox.length + retiros.length + prenez.length;

  const mensaje =
    `🌅 *Alertas del día* (${hoy})\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📅 *Próximas / vencidas (7 días):*\n${proxLineas}\n\n` +
    `🥛 *Retiro de leche vigente:*\n${retLineas}\n\n` +
    `🔍 *Revisar preñez:*\n${prenezLineas}\n\n` +
    `📊 *Ayer:* ${resumen}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `Escribe *menú* para registrar o consultar. 🐄`;

  // ---- Recipients: active owners ----
  const { data: duenos } = await supabase
    .from('whatsapp_users')
    .select('telefono')
    .eq('rol', 'dueno')
    .eq('activo', true);

  const destinatarios = (duenos || []).map((u: any) => u.telefono);

  // Prefer the approved template (works at 6 AM, outside the 24h window).
  // Fall back to free-form text (only delivers if within the 24h window) when the
  // template isn't approved yet, so we still get the full detail during testing.
  const params = [hoy, String(prox.length), String(retiros.length), String(prenez.length)];
  let viaTemplate = 0;
  let viaTexto = 0;
  for (const to of destinatarios) {
    const okT = await sendTemplate(to, ALERT_TEMPLATE, ALERT_TEMPLATE_LANG, params);
    if (okT) { viaTemplate++; continue; }
    if (await sendText(to, mensaje)) viaTexto++;
  }

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    total_alertas: totalAlertas,
    destinatarios: destinatarios.length,
    enviados: viaTemplate + viaTexto,
    via_template: viaTemplate,
    via_texto: viaTexto,
  });
}
