import { supabase, unwrapList } from './supabase';
import { today, addDays, shiftDate, daysBetween } from './dates';

// Zootechnical analytics for the meeting dashboard: productive (weight/milk) and
// reproductive (days open, calving interval, pregnancy rate) KPIs computed in JS
// from the raw event tables.

const GESTACION_DIAS = 283; // average bovine gestation
const SANIDAD_DIAS = 90;    // rolling window for the health summary
const ANIO_DIAS = 365;

// The mortalidad flow has no `causa` column to write to — it stores the cause
// inside `movimientos.notas` as "Causa: X" (see flows/mortalidad.ts). Parse it
// back out here. Promoting it to a real column is pending (see CLAUDE.md).
const causaDeNotas = (notas: string | null | undefined): string =>
  (notas || '').replace(/^causa:\s*/i, '').trim() || 'Sin causa registrada';

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null, dp = 0): number | null =>
  x === null ? null : Math.round(x * 10 ** dp) / 10 ** dp;

function groupCount<T>(items: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[key(it)] = (out[key(it)] || 0) + 1;
  return out;
}

export type PesoRow = { arete: string; categoria: string; pesoActual: number; gdp: number | null; nPesajes: number };
export type ProxParto = { arete: string; fechaEstimada: string; diasRestantes: number };
export type EventoSanitario = { arete: string; tipo: string; producto: string; diagnostico: string | null; fecha: string };
export type Muerte = { arete: string; causa: string; fecha: string };

export type Analytics = {
  inventario: {
    activos: number; hembras: number; machos: number; muertos: number; vendidos: number;
    porCategoria: Record<string, number>;
  };
  reproductivo: {
    distribucion: Record<string, number>;       // estado_reproductivo de hembras activas
    tasaPrenezPct: number | null;               // % diagnósticos positivos
    diagnosticos: number; prenadasDx: number;
    serviciosPorConcepcion: number | null;
    diasAbiertosProm: number | null;            // parto -> preñez confirmada
    diasParto1erServicioProm: number | null;    // parto -> primer servicio
    iepProm: number | null;                     // intervalo entre partos (días)
    proximosPartos: ProxParto[];
  };
  peso: {
    porCategoria: { categoria: string; nAnimales: number; pesoProm: number | null; gdpProm: number | null }[];
    gdpHatoProm: number | null;                 // g/día promedio del hato
    conGdp: number; sinSegundoPesaje: number;
    top: PesoRow[];                             // animales con mejor GDP
  };
  leche: {
    hayDatos: boolean;
    totalLitros30d: number; promLitrosDia: number | null; vacasEnOrdeno: number; promPorVacaDia: number | null;
  };
  sanidad: {
    ventanaDias: number;                        // rolling window these figures cover
    total: number;                              // events in the window
    porTipo: Record<string, number>;            // vacuna / tratamiento / desparasitacion / revision
    diagnosticosTop: { diagnostico: string; n: number }[];
    recientes: EventoSanitario[];
  };
  mortalidad: {
    total: number;                              // all time
    ultimos12Meses: number;
    tasaAnualPct: number | null;                // approximate, see the comment at the call site
    porCausa: Record<string, number>;           // last 12 months
    recientes: Muerte[];
  };
};

export async function getAnalytics(): Promise<Analytics> {
  const [aRes, pRes, rRes, lRes, sRes, mRes] = await Promise.all([
    supabase.from('animales').select('id, arete, sexo, categoria, estado, estado_reproductivo'),
    supabase.from('pesajes').select('animal_id, fecha, peso_kg, tipo').order('fecha', { ascending: true }),
    supabase.from('eventos_reproductivos').select('animal_id, tipo, fecha, resultado').order('fecha', { ascending: true }),
    supabase.from('produccion_leche').select('animal_id, fecha, litros').gte('fecha', addDays(-30)),
    supabase.from('eventos_sanitarios').select('animal_id, tipo, fecha, producto, diagnostico').gte('fecha', addDays(-SANIDAD_DIAS)),
    supabase.from('movimientos').select('animal_id, fecha, notas').eq('tipo', 'muerte'),
  ]);
  // A failed query must not read as "no hay datos" — see unwrapList.
  const animales = unwrapList<any>(aRes, 'animales');
  const pesajes = unwrapList<any>(pRes, 'pesajes');
  const repro = unwrapList<any>(rRes, 'eventos_reproductivos');
  const leche = unwrapList<any>(lRes, 'produccion_leche');
  const sanitarios = unwrapList<any>(sRes, 'eventos_sanitarios');
  const muertes = unwrapList<any>(mRes, 'movimientos');

  const areteOf = new Map<string, string>();
  const catOf = new Map<string, string>();
  for (const a of animales) { areteOf.set(a.id, a.arete); catOf.set(a.id, a.categoria || 'Sin categoría'); }

  // ---------- Inventario ----------
  const activos = animales.filter((a) => a.estado === 'activo');
  const hembrasAct = activos.filter((a) => a.sexo === 'H');
  const inventario = {
    activos: activos.length,
    hembras: hembrasAct.length,
    machos: activos.filter((a) => a.sexo === 'M').length,
    muertos: animales.filter((a) => a.estado === 'muerto').length,
    vendidos: animales.filter((a) => a.estado === 'vendido').length,
    porCategoria: groupCount(activos, (a) => a.categoria || 'Sin categoría'),
  };

  // ---------- Peso / GDP ----------
  const pesByAnimal = new Map<string, { fecha: string; peso: number }[]>();
  for (const p of pesajes) {
    const arr = pesByAnimal.get(p.animal_id) || [];
    arr.push({ fecha: p.fecha, peso: Number(p.peso_kg) });
    pesByAnimal.set(p.animal_id, arr);
  }
  const pesoRows: PesoRow[] = [];
  let sinSegundoPesaje = 0;
  for (const [animalId, list] of pesByAnimal) {
    const sorted = list.slice().sort((x, y) => x.fecha.localeCompare(y.fecha));
    const first = sorted[0], last = sorted[sorted.length - 1];
    let gdp: number | null = null;
    if (sorted.length >= 2) {
      const d = daysBetween(first.fecha, last.fecha);
      if (d > 0) gdp = round(((last.peso - first.peso) / d) * 1000, 0); // g/día
    } else {
      sinSegundoPesaje++;
    }
    pesoRows.push({
      arete: areteOf.get(animalId) || '?',
      categoria: catOf.get(animalId) || 'Sin categoría',
      pesoActual: last.peso,
      gdp,
      nPesajes: sorted.length,
    });
  }
  const cats = Array.from(new Set(pesoRows.map((r) => r.categoria)));
  const pesoPorCategoria = cats.map((categoria) => {
    const rows = pesoRows.filter((r) => r.categoria === categoria);
    const gdps = rows.map((r) => r.gdp).filter((x): x is number => x !== null);
    return {
      categoria,
      nAnimales: rows.length,
      pesoProm: round(avg(rows.map((r) => r.pesoActual)), 1),
      gdpProm: round(avg(gdps), 0),
    };
  }).sort((a, b) => b.nAnimales - a.nAnimales);
  const allGdps = pesoRows.map((r) => r.gdp).filter((x): x is number => x !== null);
  const peso = {
    porCategoria: pesoPorCategoria,
    gdpHatoProm: round(avg(allGdps), 0),
    conGdp: allGdps.length,
    sinSegundoPesaje,
    top: pesoRows.filter((r) => r.gdp !== null).sort((a, b) => (b.gdp || 0) - (a.gdp || 0)).slice(0, 8),
  };

  // ---------- Reproductivo ----------
  const reproByAnimal = new Map<string, { tipo: string; fecha: string; resultado: string | null }[]>();
  for (const e of repro) {
    const arr = reproByAnimal.get(e.animal_id) || [];
    arr.push({ tipo: e.tipo, fecha: e.fecha, resultado: e.resultado });
    reproByAnimal.set(e.animal_id, arr);
  }
  const diagnosticos = repro.filter((e) => e.tipo === 'diagnostico_prenez');
  const prenadasDx = diagnosticos.filter((e) => e.resultado === 'prenada').length;
  const serviciosTotal = repro.filter((e) => e.tipo === 'servicio').length;

  const diasAbiertos: number[] = [];
  const diasPrimerServicio: number[] = [];
  const ieps: number[] = [];
  for (const [, evs] of reproByAnimal) {
    const sorted = evs.slice().sort((x, y) => x.fecha.localeCompare(y.fecha));
    const partos = sorted.filter((e) => e.tipo === 'parto');
    for (const parto of partos) {
      const primerServicio = sorted.find((e) => e.tipo === 'servicio' && e.fecha > parto.fecha);
      if (primerServicio) diasPrimerServicio.push(daysBetween(parto.fecha, primerServicio.fecha));
      const prenezConfirm = sorted.find((e) => e.tipo === 'diagnostico_prenez' && e.resultado === 'prenada' && e.fecha > parto.fecha);
      if (prenezConfirm) diasAbiertos.push(daysBetween(parto.fecha, prenezConfirm.fecha));
    }
    for (let i = 1; i < partos.length; i++) ieps.push(daysBetween(partos[i - 1].fecha, partos[i].fecha));
  }

  // Próximos partos: hembras preñadas -> último servicio + 283 días.
  const hoy = today();
  const proximosPartos: ProxParto[] = [];
  for (const h of hembrasAct.filter((a) => a.estado_reproductivo === 'prenada')) {
    const evs = (reproByAnimal.get(h.id) || []).filter((e) => e.tipo === 'servicio').sort((x, y) => x.fecha.localeCompare(y.fecha));
    const ult = evs[evs.length - 1];
    if (!ult) continue;
    const fechaEstimada = shiftDate(ult.fecha, GESTACION_DIAS);
    proximosPartos.push({ arete: h.arete, fechaEstimada, diasRestantes: daysBetween(hoy, fechaEstimada) });
  }
  proximosPartos.sort((a, b) => a.fechaEstimada.localeCompare(b.fechaEstimada));

  const reproductivo = {
    distribucion: groupCount(hembrasAct, (a) => a.estado_reproductivo || 'vacia'),
    tasaPrenezPct: diagnosticos.length ? round((prenadasDx / diagnosticos.length) * 100, 0) : null,
    diagnosticos: diagnosticos.length,
    prenadasDx,
    serviciosPorConcepcion: prenadasDx ? round(serviciosTotal / prenadasDx, 1) : null,
    diasAbiertosProm: round(avg(diasAbiertos), 0),
    diasParto1erServicioProm: round(avg(diasPrimerServicio), 0),
    iepProm: round(avg(ieps), 0),
    proximosPartos: proximosPartos.slice(0, 10),
  };

  // ---------- Leche (últimos 30 días) ----------
  const totalLitros30d = leche.reduce((s, r) => s + Number(r.litros || 0), 0);
  const diasConRegistro = new Set(leche.map((r) => r.fecha)).size;
  const vacasEnOrdeno = new Set(leche.map((r) => r.animal_id)).size;
  const lecheData = {
    hayDatos: leche.length > 0,
    totalLitros30d: round(totalLitros30d, 1) || 0,
    promLitrosDia: diasConRegistro ? round(totalLitros30d / diasConRegistro, 1) : null,
    vacasEnOrdeno,
    promPorVacaDia: vacasEnOrdeno && diasConRegistro ? round(totalLitros30d / diasConRegistro / vacasEnOrdeno, 1) : null,
  };

  // ---------- Sanidad (ventana móvil de SANIDAD_DIAS) ----------
  const porFechaDesc = <T extends { fecha: string }>(xs: T[]) =>
    xs.slice().sort((x, y) => y.fecha.localeCompare(x.fecha));

  const sanidad = {
    ventanaDias: SANIDAD_DIAS,
    total: sanitarios.length,
    porTipo: groupCount(sanitarios, (e) => e.tipo || 'otro'),
    diagnosticosTop: Object.entries(
      groupCount(sanitarios.filter((e) => e.diagnostico), (e) => e.diagnostico as string),
    )
      .map(([diagnostico, n]) => ({ diagnostico, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 6),
    recientes: porFechaDesc(sanitarios).slice(0, 8).map((e) => ({
      arete: areteOf.get(e.animal_id) || '?',
      tipo: e.tipo,
      producto: e.producto || '',
      diagnostico: e.diagnostico ?? null,
      fecha: e.fecha,
    })),
  };

  // ---------- Mortalidad ----------
  const desdeUnAnio = shiftDate(hoy, -ANIO_DIAS);
  const muertes12 = muertes.filter((m) => m.fecha >= desdeUnAnio);
  // Approximate annual rate: deaths in the window over the population that was
  // exposed during it (animals alive now + those that died). A proper rate needs
  // average inventory over time, which we do not track historically.
  const expuestos = activos.length + muertes12.length;
  const mortalidad = {
    total: muertes.length,
    ultimos12Meses: muertes12.length,
    tasaAnualPct: expuestos ? round((muertes12.length / expuestos) * 100, 1) : null,
    porCausa: groupCount(muertes12, (m) => causaDeNotas(m.notas)),
    recientes: porFechaDesc(muertes).slice(0, 8).map((m) => ({
      arete: areteOf.get(m.animal_id) || '?',
      causa: causaDeNotas(m.notas),
      fecha: m.fecha,
    })),
  };

  return { inventario, reproductivo, peso, leche: lecheData, sanidad, mortalidad };
}
