// Weight records. Feeds the GDP (ganancia diaria de peso) figures on the
// dashboard, which need at least two weighings per animal to mean anything.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import { findOrCreateAnimal } from '../animals';
import * as S from './schemas';

export type PesajeResult = { animalId: string; pesajeId: string; animalCreado: boolean };

export async function registrarPesaje(input: S.PesajeInput): Promise<PesajeResult> {
  const d = S.pesaje.parse(input);
  const animal = await findOrCreateAnimal(d.arete, 'un pesaje');

  const { data, error } = await supabase
    .from('pesajes')
    .insert({
      finca_id: FINCA_ID,
      animal_id: animal.id,
      fecha: d.fecha,
      peso_kg: d.peso,
      tipo: d.tipo,
      condicion_corporal: d.condicionCorporal,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`registrar pesaje de ${d.arete}: ${error?.message ?? 'sin id devuelto'}`);
  }
  return { animalId: animal.id, pesajeId: data.id, animalCreado: animal.creado };
}
