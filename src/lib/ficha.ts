// Read layer for the animal record (hoja de vida) rendered at
// /dashboard/animales/[arete]: unified timeline + family tree + offspring.
//
// Read-only on purpose: la ficha no escribe nada. Desde Fase 2 la página que la
// usa exige sesión y el permiso `animal.ver`, y estas consultas filtran por
// finca_id explícitamente — RLS sigue dormida bajo service_role.
//
// Every query reports its failure loudly instead of the `data || []` idiom: on
// this page an unreachable database would otherwise render as "animal sin
// eventos registrados", which looks exactly like a healthy animal nobody has
// recorded anything for. The page decides how to degrade, section by section.

import { supabase, unwrapList } from './supabase';
import { FINCA_ID } from './tenant';
import { CAMPOS_FICHA } from './animals';
import { daysBetween, today } from './dates';

// A very active cow accumulates a few dozen events a year; 200 covers a full
// life and still bounds the query (see pending item #7 in CLAUDE.md). The page
// says so when it truncates, rather than pretending that is the whole history.
export const HISTORIAL_LIMITE = 200;

export type AnimalFicha = {
  id: string;
  arete: string;
  nombre: string | null;
  sexo: 'M' | 'H';
  raza: string | null;
  categoria: string | null;
  estado: string;
  estado_reproductivo: string | null;
  registro_oficial: string | null;
  fecha_nacimiento: string | null;
  foto_url: string | null;
  origen: string | null;
  peso_nacimiento: number | null;
  notas: string | null;
};

/** One row of vw_historial_animal — every event table folded into one shape. */
export type EventoHistorial = {
  fecha: string;
  categoria: string;
  evento: string;
  descripcion: string | null;
  created_at: string;
  ref_id: string;
};

/** One ancestor slot: a name plus whether it is a real animal we can link to. */
export type Ancestro = { arete: string | null; id: string | null; enSistema: boolean };

export type Genealogia = {
  padre: Ancestro;
  madre: Ancestro;
  abueloPaterno: Ancestro;
  abuelaPaterna: Ancestro;
  abueloMaterno: Ancestro;
  abuelaMaterna: Ancestro;
};

export type Cria = {
  id: string;
  arete: string;
  nombre: string | null;
  sexo: string;
  fecha_nacimiento: string | null;
  estado: string;
};

/** URL of an animal's record. One place so links cannot drift from the route. */
export const fichaUrl = (arete: string) => `/dashboard/animales/${encodeURIComponent(arete)}`;

/**
 * The animal itself. Returns null when the arete does not exist — which the
 * page must distinguish from a failed query, hence the explicit error check
 * rather than reusing `findAnimal`, which swallows it.
 */
export async function getAnimalPorArete(arete: string): Promise<AnimalFicha | null> {
  const { data, error } = await supabase
    .from('animales')
    .select(CAMPOS_FICHA)
    .eq('finca_id', FINCA_ID)
    .eq('arete', arete)
    .maybeSingle();
  if (error) throw new Error(`consulta a animales (ficha ${arete}): ${error.message}`);
  // CAMPOS_FICHA es una constante compartida, no un literal: supabase-js no
  // puede inferir la fila a partir de ella, así que el tipo lo pone esta capa.
  return (data as unknown as AnimalFicha) ?? null;
}

/** Unified timeline, newest first. created_at breaks ties within a day. */
export async function getHistorial(
  animalId: string,
  limite = HISTORIAL_LIMITE,
): Promise<EventoHistorial[]> {
  const res = await supabase
    .from('vw_historial_animal')
    .select('fecha, categoria, evento, descripcion, created_at, ref_id')
    .eq('finca_id', FINCA_ID)
    .eq('animal_id', animalId)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limite);
  return unwrapList<EventoHistorial>(res, 'vw_historial_animal');
}

const ancestro = (arete: unknown, id: unknown, enSistema: unknown): Ancestro => ({
  arete: (arete as string) || null,
  id: (id as string) || null,
  enSistema: Boolean(enSistema),
});

/**
 * Parents and grandparents, already resolved by vw_genealogia: the in-herd link
 * wins and the manual text is the fallback. Returns null when the view has no
 * row for the animal, which only happens if the animal itself vanished between
 * the two queries.
 */
export async function getGenealogia(animalId: string): Promise<Genealogia | null> {
  const { data, error } = await supabase
    .from('vw_genealogia')
    .select(
      'padre, padre_id, padre_en_sistema, madre, madre_id, madre_en_sistema, ' +
      'abuelo_paterno, abuelo_paterno_id, abuelo_paterno_en_sistema, ' +
      'abuela_paterna, abuela_paterna_id, abuela_paterna_en_sistema, ' +
      'abuelo_materno, abuelo_materno_id, abuelo_materno_en_sistema, ' +
      'abuela_materna, abuela_materna_id, abuela_materna_en_sistema',
    )
    .eq('finca_id', FINCA_ID)
    .eq('animal_id', animalId)
    .maybeSingle();
  if (error) throw new Error(`consulta a vw_genealogia: ${error.message}`);
  if (!data) return null;

  const g = data as unknown as Record<string, unknown>;
  return {
    padre: ancestro(g.padre, g.padre_id, g.padre_en_sistema),
    madre: ancestro(g.madre, g.madre_id, g.madre_en_sistema),
    abueloPaterno: ancestro(g.abuelo_paterno, g.abuelo_paterno_id, g.abuelo_paterno_en_sistema),
    abuelaPaterna: ancestro(g.abuela_paterna, g.abuela_paterna_id, g.abuela_paterna_en_sistema),
    abueloMaterno: ancestro(g.abuelo_materno, g.abuelo_materno_id, g.abuelo_materno_en_sistema),
    abuelaMaterna: ancestro(g.abuela_materna, g.abuela_materna_id, g.abuela_materna_en_sistema),
  };
}

/**
 * Offspring. Which column to follow comes from the animal's sex — a cow is
 * always the `madre_id` of her calves and a bull the `padre_id` — so this stays
 * one query instead of two ORed halves that PostgREST would have to union.
 */
export async function getCrias(animal: Pick<AnimalFicha, 'id' | 'sexo'>): Promise<Cria[]> {
  const columna = animal.sexo === 'H' ? 'madre_id' : 'padre_id';
  const res = await supabase
    .from('animales')
    .select('id, arete, nombre, sexo, fecha_nacimiento, estado')
    .eq('finca_id', FINCA_ID)
    .eq(columna, animal.id)
    .order('fecha_nacimiento', { ascending: false })
    .limit(100);
  return unwrapList<Cria>(res, `animales (crías por ${columna})`);
}

/**
 * Age against the farm's today, said the way the vaquero says it: days for a
 * newborn, months up to two years, then years and months.
 *
 * Months are counted on the calendar, not as `días / 30.44`: an animal born on
 * the 4th of January is seven months old on the 4th of August, and the average
 * -month division rounds that down to six.
 */
export function edadTexto(fechaNacimiento: string | null): string | null {
  if (!fechaNacimiento) return null;
  const hoy = today();
  const dias = daysBetween(fechaNacimiento, hoy);
  if (dias < 0) return null; // a birth date in the future is bad data, not an age
  if (dias < 60) return `${dias} ${dias === 1 ? 'día' : 'días'}`;

  const [y1, m1, d1] = fechaNacimiento.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = hoy.split('-').map(Number);
  // The day-of-month check is what stops "1 mes" from appearing the day before
  // the month is actually complete.
  const meses = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (meses < 24) return `${meses} meses`;

  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  return resto ? `${anios} años ${resto} m` : `${anios} años`;
}
