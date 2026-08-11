// Health event writes: vacunación, tratamiento, desparasitación.
//
// The derived dates are the reason this module must not be duplicated. A
// treatment sets `retiro_leche_hasta`, the date until which the cow's milk
// cannot be shipped. Computing it in two places invites the two from drifting,
// and the failure mode is contaminated milk reaching the tank.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import { shiftDate } from '../dates';
import { findOrCreateAnimal } from '../animals';
import * as S from './schemas';

/** Dewormings are repeated roughly every three months. */
const DESPARASITACION_INTERVALO_DIAS = 90;

export type SanidadResult = {
  animalId: string;
  eventoId: string;
  /** True when the arete did not exist and a minimal animal was created. */
  animalCreado: boolean;
  /** Next due date, when the catalog defines an interval. */
  proximaFecha: string | null;
  /** Milk-withdrawal end date, when the product defines one. */
  retiroLecheHasta: string | null;
};

// ---------------------------------------------------------------------
// Catalog lookups that feed the derived dates
// ---------------------------------------------------------------------

/** Next dose date for a vaccine, from its catalog interval. */
async function proximaDosis(vacuna: string, desde: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('cat_vacunas')
    .select('retiro_default_dias')
    .eq('nombre', vacuna)
    .maybeSingle();
  if (error) throw new Error(`consultar cat_vacunas (${vacuna}): ${error.message}`);
  return data?.retiro_default_dias ? shiftDate(desde, data.retiro_default_dias) : null;
}

/**
 * Milk-withdrawal end date for a product, from the medicine catalog.
 * Null when the product has no withdrawal period, or is not in the catalog at
 * all — which is also what happens for a free-text product the user typed in.
 */
async function retiroLecheHasta(producto: string, desde: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('cat_medicamentos')
    .select('retiro_horas_default')
    .eq('nombre', producto)
    .maybeSingle();
  if (error) throw new Error(`consultar cat_medicamentos (${producto}): ${error.message}`);
  const horas = data?.retiro_horas_default || 0;
  return horas > 0 ? shiftDate(desde, Math.ceil(horas / 24)) : null;
}

// ---------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------

async function insertarEvento(row: Record<string, unknown>, etiqueta: string): Promise<string> {
  const { data, error } = await supabase
    .from('eventos_sanitarios')
    .insert(row)
    .select('id')
    .single();
  if (error || !data?.id) {
    throw new Error(`registrar ${etiqueta}: ${error?.message ?? 'sin id devuelto'}`);
  }
  return data.id;
}

/**
 * Records a product applied as part of a bigger event — the intramammary of a
 * dry-off, the hormone given during a reproductive check-up, each step of a
 * synchronization protocol.
 *
 * Those three could each have stored `producto` + `dosis` in their own table.
 * They must not: `retiro_leche_hasta` is derived from `cat_medicamentos` and
 * exists in exactly one place. A hormone or a dry-cow antibiotic recorded
 * outside `eventos_sanitarios` is a withdrawal period the milk alerts cannot
 * see, and the failure mode is contaminated milk reaching the tank.
 *
 * Takes an already-resolved `animalId` (not an arete) because every caller has
 * looked the animal up already, and a second findOrCreate would report a
 * misleading `animalCreado`.
 */
export async function aplicarProducto(input: {
  animalId: string;
  producto: string;
  dosis?: string | null;
  /** eventos_sanitarios.tipo — 'tratamiento' unless the caller knows better. */
  tipo?: 'vacuna' | 'desparasitacion' | 'tratamiento' | 'revision';
  via?: string | null;
  diagnostico?: string | null;
  responsable?: string | null;
  fecha: string;
}): Promise<{ eventoId: string; retiroLecheHasta: string | null }> {
  const retiro = await retiroLecheHasta(input.producto, input.fecha);

  const eventoId = await insertarEvento({
    finca_id: FINCA_ID,
    animal_id: input.animalId,
    tipo: input.tipo ?? 'tratamiento',
    fecha: input.fecha,
    producto: input.producto,
    dosis: input.dosis ?? null,
    via: input.via ?? null,
    diagnostico: input.diagnostico ?? null,
    responsable: input.responsable ?? null,
    retiro_leche_hasta: retiro,
  }, `aplicación de ${input.producto}`);

  return { eventoId, retiroLecheHasta: retiro };
}

export async function registrarVacunacion(input: S.VacunacionInput): Promise<SanidadResult> {
  const d = S.vacunacion.parse(input);
  const animal = await findOrCreateAnimal(d.arete, 'una vacunación');
  const proximaFecha = await proximaDosis(d.vacuna, d.fecha);

  const eventoId = await insertarEvento({
    finca_id: FINCA_ID,
    animal_id: animal.id,
    tipo: 'vacuna',
    fecha: d.fecha,
    producto: d.vacuna,
    dosis: d.dosis,
    proxima_fecha: proximaFecha,
  }, 'vacunación');

  return { animalId: animal.id, eventoId, animalCreado: animal.creado, proximaFecha, retiroLecheHasta: null };
}

export async function registrarTratamiento(input: S.TratamientoInput): Promise<SanidadResult> {
  const d = S.tratamiento.parse(input);
  const animal = await findOrCreateAnimal(d.arete, 'un tratamiento');
  const retiro = await retiroLecheHasta(d.medicamento, d.fecha);

  const eventoId = await insertarEvento({
    finca_id: FINCA_ID,
    animal_id: animal.id,
    tipo: 'tratamiento',
    fecha: d.fecha,
    producto: d.medicamento,
    dosis: d.dosis,
    via: d.via,
    diagnostico: d.diagnostico,
    retiro_leche_hasta: retiro,
  }, 'tratamiento');

  return { animalId: animal.id, eventoId, animalCreado: animal.creado, proximaFecha: null, retiroLecheHasta: retiro };
}

export async function registrarDesparasitacion(input: S.DesparasitacionInput): Promise<SanidadResult> {
  const d = S.desparasitacion.parse(input);
  const animal = await findOrCreateAnimal(d.arete, 'una desparasitación');
  const retiro = await retiroLecheHasta(d.producto, d.fecha);
  const proximaFecha = shiftDate(d.fecha, DESPARASITACION_INTERVALO_DIAS);

  const eventoId = await insertarEvento({
    finca_id: FINCA_ID,
    animal_id: animal.id,
    tipo: 'desparasitacion',
    fecha: d.fecha,
    producto: d.producto,
    dosis: d.dosis,
    proxima_fecha: proximaFecha,
    retiro_leche_hasta: retiro,
  }, 'desparasitación');

  return { animalId: animal.id, eventoId, animalCreado: animal.creado, proximaFecha, retiroLecheHasta: retiro };
}
