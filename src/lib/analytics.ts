import { supabase, unwrapList, paginar } from './supabase';
import { FINCA_ID } from './tenant';
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
  // Todas filtran por finca_id explícitamente. RLS está dormida bajo service_role,
  // así que este .eq() ES el aislamiento entre fincas — no un respaldo de otro.
  //
  // Y todas menos la de leche van por `paginar`: PostgREST corta en 1000 filas
  // sin avisar y estas se agregan en memoria, así que sin paginar el tablero
  // mostraría promedios calculados sobre datos truncados. Cada orden termina en
  // `id` como desempate — sin él, dos filas de la misma fecha pueden cruzarse
  // entre páginas y una se repite mientras otra se pierde.
  //
  // La de leche NO se pagina porque ya no trae filas crudas: vw_leche_ordeno
  // (db/06) agrega en Postgres y devuelve DOS filas por día en vez de una por
  // vaca y ordeño. Con medición diaria eso son ~60 filas en 30 días contra las
  // 1200+ de antes, que es lo que estaba a punto de pasarse del tope.
  //
  // A failed query must not read as "no hay datos" — see unwrapList.
  const [animales, pesajes, repro, lRes, sanitarios, muertes] = await Promise.all([
    paginar<any>((d, h) => supabase.from('animales')
      .select('id, arete, sexo, categoria, estado, estado_reproductivo')
      .eq('finca_id', FINCA_ID)
      .order('id', { ascending: true }).range(d, h), 'animales'),
    paginar<any>((d, h) => supabase.from('pesajes')
      .select('animal_id, fecha, peso_kg, tipo')
      .eq('finca_id', FINCA_ID)
      .order('fecha', { ascending: true }).order('id', { ascending: true }).range(d, h), 'pesajes'),
    paginar<any>((d, h) => supabase.from('eventos_reproductivos')
      .select('animal_id, tipo, fecha, resultado')
      .eq('finca_id', FINCA_ID)
      .order('fecha', { ascending: true }).order('id', { ascending: true }).range(d, h), 'eventos_reproductivos'),
    supabase.from('vw_leche_ordeno').select('fecha, ordeno, litros, vacas')
      .eq('finca_id', FINCA_ID).gte('fecha', addDays(-30)),
    paginar<any>((d, h) => supabase.from('eventos_sanitarios')
      .select('animal_id, tipo, fecha, producto, diagnostico')
      .eq('finca_id', FINCA_ID).gte('fecha', addDays(-SANIDAD_DIAS))
      .order('fecha', { ascending: true }).order('id', { ascending: true }).range(d, h), 'eventos_sanitarios'),
    paginar<any>((d, h) => supabase.from('movimientos')
      .select('animal_id, fecha, notas')
      .eq('finca_id', FINCA_ID).eq('tipo', 'muerte')
      .order('fecha', { ascending: true }).order('id', { ascending: true }).range(d, h), 'movimientos'),
  ]);
  const leche = unwrapList<any>(lRes, 'vw_leche_ordeno');

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
  //
  // 'seca' cuenta igual que 'prenada'. Una vaca secada sigue preñada, pero
  // estado_reproductivo es una sola columna y registrarSecado() la mueve a
  // 'seca' ~60 días antes del parto. Filtrar solo por 'prenada' la sacaría de
  // esta lista justo en la recta final, que es cuando más importa. vw_alertas
  // lleva la misma regla — si cambia una, cambia la otra.
  const PRENADAS = ['prenada', 'seca'];
  const hoy = today();
  const proximosPartos: ProxParto[] = [];
  for (const h of hembrasAct.filter((a) => PRENADAS.includes(a.estado_reproductivo))) {
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
  // El hato se mide vaca por vaca con medidor, en los DOS ordeños, TODOS los
  // días: no hay pesaje periódico ni reporte de total aparte — el total del
  // ordeño es la suma del desglose. Por eso estas tres cifras son literales:
  // totalLitros30d ES la producción del período, y no «la suma de los días de
  // control» como cuando produccion_leche solo se llenaba cada 2-3 semanas.
  //
  // ⚠️ Con esa frecuencia, la consulta de arriba se acerca al tope de filas de
  // PostgREST (~1000 por defecto): 20 vacas × 2 ordeños × 30 días = 1200. Pasado
  // el tope, esto suma datos TRUNCADOS sin ningún síntoma. Es la tarea #7 de
  // CLAUDE.md y con el registro diario dejó de ser teórica.
  //
  // Un día a medias (solo la mañana registrada) baja el promedio por día, que es
  // el comportamiento correcto mientras la tarde no exista: no se inventa.
  //
  // La vista trae una fila por ordeño; el día se arma juntando sus dos ordeños.
  const porDia = new Map<string, { litros: number; vacas: number }>();
  for (const o of leche) {
    const litros = Number(o.litros) || 0;
    const vacas = Number(o.vacas) || 0;
    const dia = porDia.get(o.fecha);
    if (!dia) {
      porDia.set(o.fecha, { litros, vacas });
    } else {
      dia.litros += litros;
      // Las vacas NO se suman entre ordeños: la misma vaca se mide en los dos.
      // El ordeño más numeroso es el tamaño del hato ese día.
      dia.vacas = Math.max(dia.vacas, vacas);
    }
  }
  const dias = [...porDia.values()];
  const totalLitros30d = dias.reduce((s, d) => s + d.litros, 0);
  const diasConRegistro = dias.length;
  // «Vacas en ordeño» = el hato más grande medido en un día del período. Antes
  // era el número de vacas DISTINTAS vistas en 30 días, que sube con cada vaca
  // secada a mitad de mes y hundía litros/vaca/día repartiendo entre ordeños que
  // ya no existen.
  const vacasEnOrdeno = dias.reduce((m, d) => Math.max(m, d.vacas), 0);
  const lecheData = {
    hayDatos: leche.length > 0,
    totalLitros30d: round(totalLitros30d, 1) || 0,
    promLitrosDia: diasConRegistro ? round(totalLitros30d / diasConRegistro, 1) : null,
    vacasEnOrdeno,
    // Promedio de los promedios diarios, no total ÷ días ÷ vacas: si el hato
    // cambió de tamaño dentro del mes, un solo divisor reparte mal.
    promPorVacaDia: diasConRegistro
      ? round(dias.reduce((s, d) => s + (d.vacas ? d.litros / d.vacas : 0), 0) / diasConRegistro, 1)
      : null,
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
