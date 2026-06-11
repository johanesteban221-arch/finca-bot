import { supabase } from './supabase';
import { getProximas, getRetiros, getPrenezPendientes, shift, Proxima, Retiro } from './alerts';

const count = async (table: string, extra: Record<string, string> = {}) => {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  const { count } = await q;
  return count || 0;
};

const countSince = async (table: string, fecha: string, extra: Record<string, string> = {}) => {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).gte('fecha', fecha);
  for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
  const { count } = await q;
  return count || 0;
};

export type DashboardData = {
  hato: { activos: number; hembras: number; machos: number; prenadas: number; servidas: number; terneros: number };
  alertas: { proximas: Proxima[]; retiros: Retiro[]; prenez: string[] };
  actividad7d: { sanitarios: number; pesajes: number; reproductivos: number; partos: number; bajas: number };
  litros7d: number;
};

export async function getDashboard(): Promise<DashboardData> {
  const d7 = shift(-7);

  const [activos, hembras, machos, prenadas, servidas, terneros] = await Promise.all([
    count('animales', { estado: 'activo' }),
    count('animales', { estado: 'activo', sexo: 'H' }),
    count('animales', { estado: 'activo', sexo: 'M' }),
    count('animales', { estado: 'activo', estado_reproductivo: 'prenada' }),
    count('animales', { estado: 'activo', estado_reproductivo: 'servida' }),
    count('animales', { estado: 'activo', categoria: 'ternero' }),
  ]);

  const [proximas, retiros, prenez] = await Promise.all([getProximas(), getRetiros(), getPrenezPendientes()]);

  const [sanitarios, pesajes, reproductivos, partos, bajas] = await Promise.all([
    countSince('eventos_sanitarios', d7),
    countSince('pesajes', d7),
    countSince('eventos_reproductivos', d7),
    countSince('eventos_reproductivos', d7, { tipo: 'parto' }),
    countSince('movimientos', d7, { tipo: 'muerte' }),
  ]);

  const { data: leche } = await supabase.from('produccion_leche').select('litros').gte('fecha', d7);
  const litros7d = (leche || []).reduce((s: number, r: any) => s + Number(r.litros || 0), 0);

  return {
    hato: { activos, hembras, machos, prenadas, servidas, terneros },
    alertas: { proximas, retiros, prenez },
    actividad7d: { sanitarios, pesajes, reproductivos, partos, bajas },
    litros7d,
  };
}
