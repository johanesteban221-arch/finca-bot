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
