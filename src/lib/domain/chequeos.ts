// Veterinary reproductive check-ups (palpation / ultrasound).
//
// Entry channel is the mobile dashboard form (Bloque D), not WhatsApp: the vet
// records ovarian structures per side, which is more than a button flow can
// collect without becoming unusable in the corral.
//
// Two rules make this module worth existing:
//   1. The clinical code the vet writes down (P/V/SE/VAS/VAP/PP/RECHE) is finer
//      than animales.estado_reproductivo, whose CHECK every alert and KPI depends
//      on. The mapping below is the only place the two vocabularies meet.
//   2. A product applied during the check-up goes through eventos_sanitarios so
//      the milk-withdrawal date gets computed. It is never stored as loose
//      columns here.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import { findAnimal } from '../animals';
import { aplicarProducto } from './sanidad';
import * as S from './schemas';

export type ChequeoResult = {
  animalId: string;
  chequeoId: string;
  /** Canonical state written to the animal, or null when the code does not map. */
  estadoReproductivo: string | null;
  eventoSanitarioId: string | null;
  retiroLecheHasta: string | null;
};

/**
 * Vet code -> animales.estado_reproductivo.
 *
 *   P     preñada
 *   V     vacía
 *   SE    servida
 *   VAS   vacía en anestro superficial  ┐ dos grados del mismo estado; la
 *   VAP   vacía en anestro profundo     ┘ distinción queda en `estado_codigo`
 *   PP    post-parto
 *   RECHE rechequeo
 *
 * VAS and VAP both collapse to 'vacia': anestro superficial and profundo are two
 * degrees of the same reproductive state. The distinction is what the vet acts
 * on and it is preserved in `estado_codigo` on the check-up row.
 *
 * RECHE maps to null because it is not a state at all — it is "come back and
 * scan her again", usually to confirm a pregnancy the vet could not call. The
 * cow keeps whatever state she already had; overwriting it would be inventing a
 * finding the vet explicitly did not make. What RECHE does produce is a pending
 * task, surfaced by getRechequeosPendientes() in src/lib/alerts.ts.
 */
export const ESTADO_CANONICO: Record<S.CodigoChequeo, string | null> = {
  P: 'prenada',
  V: 'vacia',
  SE: 'servida',
  VAS: 'vacia',
  VAP: 'vacia',
  PP: 'parida',
  RECHE: null,
};

export async function registrarChequeo(input: S.ChequeoReproductivoInput): Promise<ChequeoResult> {
  const d = S.chequeoReproductivo.parse(input);

  // findAnimal, not findOrCreateAnimal. On WhatsApp, auto-creating from a typo'd
  // arete is an acceptable trade — the vaquero is in the field and cannot fix it
  // there. On a form the vet is looking at a screen and can correct the number,
  // so a typo must fail loudly instead of spawning a ghost animal that then
  // shows up in the inventory count.
  const animal = await findAnimal(d.arete);
  if (!animal) {
    throw new Error(`No existe ningún animal con arete ${d.arete}. Regístralo antes de chequearlo.`);
  }

  let eventoSanitarioId: string | null = null;
  let retiroLecheHasta: string | null = null;
  if (d.producto) {
    const aplicacion = await aplicarProducto({
      animalId: animal.id,
      producto: d.producto,
      dosis: d.dosis,
      via: d.via,
      diagnostico: 'Chequeo reproductivo',
      responsable: d.veterinario,
      fecha: d.fecha,
    });
    eventoSanitarioId = aplicacion.eventoId;
    retiroLecheHasta = aplicacion.retiroLecheHasta;
  }

  const { data, error } = await supabase
    .from('chequeos_reproductivos')
    .insert({
      finca_id: FINCA_ID,
      animal_id: animal.id,
      fecha: d.fecha,
      veterinario: d.veterinario,
      estado_codigo: d.estadoCodigo,
      ovario_der_mm: d.ovarioDerMm,
      ovario_der_estruct: d.ovarioDerEstructura,
      ovario_izq_mm: d.ovarioIzqMm,
      ovario_izq_estruct: d.ovarioIzqEstructura,
      observaciones: d.observaciones,
      evento_sanitario_id: eventoSanitarioId,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`registrar chequeo de ${d.arete}: ${error?.message ?? 'sin id devuelto'}`);
  }

  const estadoReproductivo = ESTADO_CANONICO[d.estadoCodigo];
  if (estadoReproductivo) {
    const { error: estadoError } = await supabase
      .from('animales')
      .update({ estado_reproductivo: estadoReproductivo })
      .eq('id', animal.id);
    if (estadoError) throw new Error(`actualizar estado reproductivo: ${estadoError.message}`);
  }

  return {
    animalId: animal.id,
    chequeoId: data.id,
    estadoReproductivo,
    eventoSanitarioId,
    retiroLecheHasta,
  };
}
