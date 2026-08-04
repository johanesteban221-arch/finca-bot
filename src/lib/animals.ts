// Animal lookup helpers shared by every flow that records an event against an arete.

import { supabase } from './supabase';

// Finds an animal by arete (read-only). Returns null when it doesn't exist.
export async function findAnimal(arete: string): Promise<any | null> {
  const { data } = await supabase
    .from('animales')
    .select('id, arete, nombre, sexo, raza, categoria, estado, estado_reproductivo')
    .eq('arete', arete)
    .maybeSingle();
  return data;
}

// Finds the animal by arete; creates a minimal record if it doesn't exist yet.
// `origen` is a Spanish noun phrase used in the audit note, e.g. 'un pesaje'.
export async function findOrCreateAnimal(arete: string, origen: string): Promise<string | undefined> {
  const { data: animal } = await supabase
    .from('animales')
    .select('id')
    .eq('arete', arete)
    .maybeSingle();
  if (animal) return animal.id;

  const { data: nuevo } = await supabase
    .from('animales')
    .insert({ arete, sexo: 'H', notas: `Creado automáticamente desde ${origen} por WhatsApp` })
    .select('id')
    .single();
  return nuevo?.id;
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
