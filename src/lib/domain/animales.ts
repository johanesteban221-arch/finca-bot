// Animal registry writes. Channel-agnostic: the WhatsApp flow and the dashboard
// form both land here, so the rules live in one place.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import * as S from './schemas';

export type RegistrarAnimalResult = { animalId: string };
export type CategorizarAnimalResult = { animalId: string };

/** Creates a new animal. Fails if the arete is already taken (unique in the schema). */
export async function registrarAnimal(input: S.CrearAnimalInput): Promise<RegistrarAnimalResult> {
  const d = S.crearAnimal.parse(input);

  const { data, error } = await supabase
    .from('animales')
    .insert({
      finca_id: FINCA_ID,
      arete: d.arete,
      sexo: d.sexo,
      raza: d.raza,
      categoria: d.categoria,
      notas: d.notas ?? 'Registrado por WhatsApp',
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`registrar animal ${d.arete}: ${error?.message ?? 'sin id devuelto'}`);
  }
  return { animalId: data.id };
}

/** Updates only the category of an animal that already exists. */
export async function categorizarAnimal(input: S.CategorizarAnimalInput): Promise<CategorizarAnimalResult> {
  const d = S.categorizarAnimal.parse(input);

  const { error } = await supabase
    .from('animales')
    .update({ categoria: d.categoria })
    .eq('id', d.animalId);

  if (error) throw new Error(`categorizar animal ${d.animalId}: ${error.message}`);
  return { animalId: d.animalId };
}
