// Animal lookup helpers shared by every flow that records an event against an arete.

import { supabase } from './supabase';
import { FINCA_ID } from './tenant';

// Columns the animal record shows. Kept in one place so the WhatsApp ficha and
// the dashboard ficha cannot drift apart — the dashboard one (src/lib/ficha.ts)
// renders every field, WhatsApp shows the subset that fits a phone message.
export const CAMPOS_FICHA =
  'id, arete, nombre, sexo, raza, categoria, estado, estado_reproductivo, ' +
  'registro_oficial, fecha_nacimiento, foto_url, origen, peso_nacimiento, notas';

// Finds an animal by arete (read-only). Returns null when it doesn't exist.
export async function findAnimal(arete: string): Promise<any | null> {
  const { data } = await supabase
    .from('animales')
    .select(CAMPOS_FICHA)
    .eq('arete', arete)
    .maybeSingle();
  return data;
}

// Reverse of findAnimal: the protocol functions hold an animal_id and need the
// arete back to call the event-recording domain functions, which key on arete.
export async function findAnimalById(id: string): Promise<any | null> {
  const { data } = await supabase
    .from('animales')
    .select(CAMPOS_FICHA)
    .eq('id', id)
    .maybeSingle();
  return data;
}

/** An animal resolved from an arete, plus whether this call had to create it. */
export type AnimalResuelto = { id: string; creado: boolean };

// Finds the animal by arete; creates a minimal record if it doesn't exist yet.
// `origen` is a Spanish noun phrase used in the audit note, e.g. 'un pesaje'.
//
// `creado` matters to the caller: on WhatsApp, auto-creating from a typo is an
// acceptable trade (the vaquero is in the field and cannot fix it there), but a
// dashboard form should surface it and ask for confirmation.
export async function findOrCreateAnimal(arete: string, origen: string): Promise<AnimalResuelto> {
  const { data: animal, error: findError } = await supabase
    .from('animales')
    .select('id')
    .eq('arete', arete)
    .maybeSingle();
  if (findError) throw new Error(`buscar animal ${arete}: ${findError.message}`);
  if (animal) return { id: animal.id, creado: false };

  const { data: nuevo, error: insertError } = await supabase
    .from('animales')
    .insert({ finca_id: FINCA_ID, arete, sexo: 'H', notas: `Creado automáticamente desde ${origen} por WhatsApp` })
    .select('id')
    .single();
  // Returning undefined here used to cascade into an insert with a null
  // animal_id, which fails far from the real cause.
  if (insertError || !nuevo?.id) {
    throw new Error(`crear animal ${arete}: ${insertError?.message ?? 'sin id devuelto'}`);
  }
  return { id: nuevo.id, creado: true };
}

// Animal categories (dual-purpose cattle lifecycle stages).
export const CATEGORIAS: { id: string; title: string }[] = [
  { id: 'ternero', title: '🐄 Ternero(a)' },
  { id: 'levante', title: '🐂 Levante' },
  { id: 'ceba', title: '🥩 Ceba' },
  { id: 'novilla', title: '🐄 Novilla' },
  { id: 'vaca', title: '🐄 Vaca' },
  { id: 'vaca_seca', title: '🌵 Vaca seca' },
  { id: 'toro', title: '🐂 Toro' },
];

export const catTitle = (id: string) => CATEGORIAS.find((c) => c.id === id)?.title || id;

export const sexoTitle = (s: string) => (s === 'H' ? 'Hembra' : 'Macho');
