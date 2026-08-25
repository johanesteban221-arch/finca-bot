// Listados del hato para los formularios del tablero (Bloque D).
//
// Lecturas, no escrituras: por eso viven aquí y no en `domain/`, que es el
// contrato de escritura. Van por `unwrapList` como el resto de las lecturas —
// un fallo de consulta tiene que ser ruidoso, porque una lista de ordeño vacía
// «porque la base no respondió» se ve idéntica a una finca sin vacas, y el
// operario llenaría el control creyendo que no falta nadie.
//
// Todas filtran por `finca_id`: RLS sigue dormida bajo service_role, así que ese
// `.eq()` ES el aislamiento entre fincas (CLAUDE.md, punto 6), no un cinturón
// de más. Cualquier lectura nueva tiene que llevarlo.

import { supabase, unwrapList } from './supabase';
import { FINCA_ID } from './tenant';

export type VacaOrdeno = {
  id: string;
  arete: string;
  nombre: string | null;
  estadoReproductivo: string | null;
};

/**
 * El hato en ordeño: lo que el control lechero tiene que listar.
 *
 * «En ordeño» se define por exclusión y a propósito: activa, categoría `vaca`, y
 * que NO esté seca. Una vaca seca no da leche, y ofrecerle una casilla al
 * operario invita a escribir un 0 — que es un dato válido y falso a la vez: el
 * promedio del hato bajaría con vacas que nadie ordeñó.
 *
 * `vaca_seca` se excluye por categoría y `seca` por estado reproductivo porque
 * en la práctica las dos marcas conviven y no siempre se actualizan juntas.
 */
export async function listarOrdeno(): Promise<VacaOrdeno[]> {
  const res = await supabase
    .from('animales')
    .select('id, arete, nombre, estado_reproductivo, categoria')
    .eq('finca_id', FINCA_ID)
    .eq('estado', 'activo')
    .eq('categoria', 'vaca')
    .order('arete', { ascending: true })
    .limit(500);

  return unwrapList<any>(res, 'animales (hato en ordeño)')
    .filter((a) => a.estado_reproductivo !== 'seca')
    .map((a) => ({
      id: a.id,
      arete: a.arete,
      nombre: a.nombre ?? null,
      estadoReproductivo: a.estado_reproductivo ?? null,
    }));
}

export type ControlReciente = { id: string; fecha: string; vacas: number };

/**
 * Los últimos controles de leche, para que la pantalla muestre cuándo se hizo el
 * anterior. `controles_leche` tiene único (finca_id, fecha): si ya hay uno de
 * hoy, guardar otro falla, y es mejor avisarlo antes de que el operario teclee
 * cuarenta vacas.
 */
export async function ultimosControles(limite = 5): Promise<ControlReciente[]> {
  const res = await supabase
    .from('controles_leche')
    .select('id, fecha')
    .eq('finca_id', FINCA_ID)
    .order('fecha', { ascending: false })
    .limit(limite);
  const controles = unwrapList<any>(res, 'controles_leche');
  if (!controles.length) return [];

  // Cuántas vacas trae cada control. Una consulta aparte y no un embed: el
  // detalle vive en produccion_leche, que tiene una sola FK a controles_leche
  // pero varias filas por vaca (mañana y tarde), así que el conteo se hace aquí.
  const mediciones = unwrapList<any>(
    await supabase
      .from('produccion_leche')
      .select('control_id, animal_id')
      .eq('finca_id', FINCA_ID)
      .in('control_id', controles.map((c) => c.id)),
    'produccion_leche (conteo por control)',
  );

  const vacasPorControl = new Map<string, Set<string>>();
  for (const m of mediciones) {
    if (!vacasPorControl.has(m.control_id)) vacasPorControl.set(m.control_id, new Set());
    vacasPorControl.get(m.control_id)!.add(m.animal_id);
  }

  return controles.map((c) => ({
    id: c.id,
    fecha: c.fecha,
    vacas: vacasPorControl.get(c.id)?.size ?? 0,
  }));
}

/**
 * Hembras activas, para el `<datalist>` de chequeo y protocolo.
 *
 * Ahí el veterinario escribe el arete a mano (revisa una vaca, no el hato
 * entero), así que esto es una ayuda de escritura, no la fuente de verdad: el
 * dominio vuelve a resolver el arete y falla si no existe.
 */
export async function listarHembrasActivas(): Promise<VacaOrdeno[]> {
  const res = await supabase
    .from('animales')
    .select('id, arete, nombre, estado_reproductivo')
    .eq('finca_id', FINCA_ID)
    .eq('estado', 'activo')
    .eq('sexo', 'H')
    .order('arete', { ascending: true })
    .limit(1000);

  return unwrapList<any>(res, 'animales (hembras activas)').map((a) => ({
    id: a.id,
    arete: a.arete,
    nombre: a.nombre ?? null,
    estadoReproductivo: a.estado_reproductivo ?? null,
  }));
}

export type ProtocoloAbierto = {
  id: string;
  arete: string;
  nombre: string | null;
  nombreProtocolo: string;
  estado: string;
  fechaInicio: string;
  fechaIa: string | null;
  aplicaciones: number;
};

/**
 * Protocolos que siguen corriendo, con su animal y cuántas aplicaciones llevan.
 *
 * Es lo que convierte la pantalla de protocolos en algo usable: un protocolo es
 * un ciclo de días (0, 7, 9…), no un formulario de una sola vez, así que lo
 * primero que el veterinario necesita ver es qué tiene abierto y en qué día va.
 */
export async function protocolosAbiertos(): Promise<ProtocoloAbierto[]> {
  const res = await supabase
    .from('protocolos_sincronizacion')
    .select('id, animal_id, nombre_protocolo, estado, fecha_inicio, fecha_ia')
    .eq('finca_id', FINCA_ID)
    // 'en_curso' es el único estado abierto: registrar la IA NO cambia el estado,
    // solo llena fecha_ia (ver registrarIaProtocolo). Lo cierra cerrarProtocolo
    // ('finalizado') o cancelarProtocolo ('cancelado').
    .eq('estado', 'en_curso')
    .order('fecha_inicio', { ascending: false })
    .limit(200);
  const protocolos = unwrapList<any>(res, 'protocolos_sincronizacion');
  if (!protocolos.length) return [];

  const [animales, aplicaciones] = await Promise.all([
    supabase
      .from('animales')
      .select('id, arete, nombre')
      .eq('finca_id', FINCA_ID)
      .in('id', protocolos.map((p) => p.animal_id))
      .then((r) => unwrapList<any>(r, 'animales (protocolos)')),
    supabase
      .from('protocolo_aplicaciones')
      .select('protocolo_id')
      .eq('finca_id', FINCA_ID)
      .in('protocolo_id', protocolos.map((p) => p.id))
      .then((r) => unwrapList<any>(r, 'protocolo_aplicaciones')),
  ]);

  const animalPorId = new Map(animales.map((a) => [a.id, a]));
  const conteo = new Map<string, number>();
  for (const a of aplicaciones) conteo.set(a.protocolo_id, (conteo.get(a.protocolo_id) ?? 0) + 1);

  return protocolos.map((p) => ({
    id: p.id,
    arete: animalPorId.get(p.animal_id)?.arete ?? '?',
    nombre: animalPorId.get(p.animal_id)?.nombre ?? null,
    nombreProtocolo: p.nombre_protocolo,
    estado: p.estado,
    fechaInicio: p.fecha_inicio,
    fechaIa: p.fecha_ia ?? null,
    aplicaciones: conteo.get(p.id) ?? 0,
  }));
}

export type ChequeoReciente = {
  id: string;
  arete: string;
  fecha: string;
  estadoCodigo: string;
  veterinario: string;
  observaciones: string | null;
};

/**
 * Los últimos chequeos, para que el veterinario vea lo que acaba de registrar
 * sin salir de la pantalla. Es el acuse de recibo de verdad: el aviso verde dice
 * «se guardó», esto muestra QUÉ se guardó.
 */
export async function ultimosChequeos(limite = 10): Promise<ChequeoReciente[]> {
  const res = await supabase
    .from('chequeos_reproductivos')
    .select('id, animal_id, fecha, estado_codigo, veterinario, observaciones, created_at')
    .eq('finca_id', FINCA_ID)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limite);
  const chequeos = unwrapList<any>(res, 'chequeos_reproductivos (recientes)');
  if (!chequeos.length) return [];

  // Sin embed: chequeos_reproductivos llega a animales por una FK compuesta
  // (animal_id, finca_id), y resolver el arete aparte deja la consulta legible
  // y el filtro por finca explícito en las dos.
  const animales = unwrapList<any>(
    await supabase
      .from('animales')
      .select('id, arete')
      .eq('finca_id', FINCA_ID)
      .in('id', chequeos.map((c) => c.animal_id)),
    'animales (chequeos recientes)',
  );
  const aretePorId = new Map(animales.map((a) => [a.id, a.arete]));

  return chequeos.map((c) => ({
    id: c.id,
    arete: aretePorId.get(c.animal_id) ?? '?',
    fecha: c.fecha,
    estadoCodigo: c.estado_codigo,
    veterinario: c.veterinario ?? '',
    observaciones: c.observaciones ?? null,
  }));
}
