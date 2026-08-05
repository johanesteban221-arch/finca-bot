// Death records. Writes a `movimientos` row of tipo 'muerte' and marks the
// animal as dead — the two must happen together or the herd inventory and the
// mortality figures disagree.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import { findOrCreateAnimal } from '../animals';
import * as S from './schemas';

export type MortalidadResult = { animalId: string; movimientoId: string; animalCreado: boolean };

/**
 * `movimientos` has no `causa` column, so the cause is stored in `notas` with a
 * "Causa: " prefix. analytics.ts parses it back out with the matching regex —
 * keep the two in step. Promoting it to a real column is item #10 in CLAUDE.md.
 */
export const CAUSA_PREFIJO = 'Causa: ';

export async function registrarBaja(input: S.MortalidadInput): Promise<MortalidadResult> {
  const d = S.mortalidad.parse(input);
  const animal = await findOrCreateAnimal(d.arete, 'una baja');

  const { data, error } = await supabase
    .from('movimientos')
    .insert({
      finca_id: FINCA_ID,
      animal_id: animal.id,
      tipo: 'muerte',
      fecha: d.fecha,
      notas: `${CAUSA_PREFIJO}${d.causa}`,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`registrar baja de ${d.arete}: ${error?.message ?? 'sin id devuelto'}`);
  }

  const { error: estadoError } = await supabase
    .from('animales')
    .update({ estado: 'muerto' })
    .eq('id', animal.id);
  if (estadoError) throw new Error(`marcar animal como muerto: ${estadoError.message}`);

  return { animalId: animal.id, movimientoId: data.id, animalCreado: animal.creado };
}
