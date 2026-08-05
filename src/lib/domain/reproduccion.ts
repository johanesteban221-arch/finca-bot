// Reproductive event writes: servicio (IA / monta), diagnóstico de preñez, parto.
//
// Every one of these also moves the cow's `estado_reproductivo`, which is what
// the alert queries and the dashboard KPIs read. Event and state must stay in
// step, so both writes live here rather than at the call site.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import { findAnimal, findOrCreateAnimal } from '../animals';
import * as S from './schemas';

export type ServicioResult = { animalId: string; eventoId: string; animalCreado: boolean };
export type DxPrenezResult = { animalId: string; eventoId: string; animalCreado: boolean; estado: 'prenada' | 'vacia' };
export type PartoResult = {
  madreId: string;
  criaId: string;
  eventoId: string;
  /** False when the calf's arete already existed and was reused. */
  criaCreada: boolean;
  /** True when a birth weight was also recorded as a weighing. */
  pesoRegistrado: boolean;
};

async function insertarEvento(row: Record<string, unknown>, etiqueta: string): Promise<string> {
  const { data, error } = await supabase
    .from('eventos_reproductivos')
    .insert(row)
    .select('id')
    .single();
  if (error || !data?.id) {
    throw new Error(`registrar ${etiqueta}: ${error?.message ?? 'sin id devuelto'}`);
  }
  return data.id;
}

async function actualizarEstado(animalId: string, estado: string): Promise<void> {
  const { error } = await supabase
    .from('animales')
    .update({ estado_reproductivo: estado })
    .eq('id', animalId);
  if (error) throw new Error(`actualizar estado reproductivo: ${error.message}`);
}

// ---------------------------------------------------------------------

export async function registrarServicio(input: S.ServicioInput): Promise<ServicioResult> {
  const d = S.servicio.parse(input);
  const animal = await findOrCreateAnimal(d.arete, 'un servicio');

  const eventoId = await insertarEvento({
    finca_id: FINCA_ID,
    animal_id: animal.id,
    tipo: 'servicio',
    fecha: d.fecha,
    metodo: d.metodo,
    inseminador: d.metodo === 'IA' ? d.inseminador : null,
    pajilla: d.metodo === 'IA' ? d.pajilla : null,
    // The herd bull is recorded as a note: toro_id expects an animal uuid, and
    // the flow only asks for a free-text tag that may not be a registered animal.
    notas: d.metodo === 'monta' && d.toro ? `Toro: ${d.toro}` : null,
  }, 'servicio');

  await actualizarEstado(animal.id, 'servida');
  return { animalId: animal.id, eventoId, animalCreado: animal.creado };
}

export async function registrarDxPrenez(input: S.DxPrenezInput): Promise<DxPrenezResult> {
  const d = S.dxPrenez.parse(input);
  const animal = await findOrCreateAnimal(d.arete, 'un diagnóstico');

  const eventoId = await insertarEvento({
    finca_id: FINCA_ID,
    animal_id: animal.id,
    tipo: 'diagnostico_prenez',
    fecha: d.fecha,
    resultado: d.resultado,
  }, 'diagnóstico de preñez');

  await actualizarEstado(animal.id, d.resultado);
  return { animalId: animal.id, eventoId, animalCreado: animal.creado, estado: d.resultado };
}

export async function registrarParto(input: S.PartoInput): Promise<PartoResult> {
  const d = S.parto.parse(input);
  const madre = await findOrCreateAnimal(d.madre, 'un parto');

  // Create the calf, or reuse the record if the arete was already registered.
  let cria = await findAnimal(d.cria);
  let criaCreada = false;
  if (!cria) {
    const { data, error } = await supabase
      .from('animales')
      .insert({
        finca_id: FINCA_ID,
        arete: d.cria,
        sexo: d.sexo,
        madre_id: madre.id,
        fecha_nacimiento: d.fecha,
        peso_nacimiento: d.peso,
        origen: 'nacido_en_finca',
        categoria: 'ternero',
        notas: 'Registrada desde un parto por WhatsApp',
      })
      .select('id')
      .single();
    if (error || !data?.id) {
      throw new Error(`crear cría ${d.cria}: ${error?.message ?? 'sin id devuelto'}`);
    }
    cria = data;
    criaCreada = true;
  }

  // The birth weight is also a weighing, so it shows up in the calf's history.
  let pesoRegistrado = false;
  if (d.peso) {
    const { error } = await supabase.from('pesajes').insert({
      finca_id: FINCA_ID,
      animal_id: cria.id,
      fecha: d.fecha,
      peso_kg: d.peso,
      tipo: 'nacimiento',
    });
    if (error) throw new Error(`registrar peso al nacer: ${error.message}`);
    pesoRegistrado = true;
  }

  const eventoId = await insertarEvento({
    finca_id: FINCA_ID,
    animal_id: madre.id,
    tipo: 'parto',
    fecha: d.fecha,
    cria_id: cria.id,
  }, 'parto');

  await actualizarEstado(madre.id, 'parida');
  return { madreId: madre.id, criaId: cria.id, eventoId, criaCreada, pesoRegistrado };
}
