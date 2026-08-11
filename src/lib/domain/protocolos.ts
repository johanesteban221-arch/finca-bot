// Synchronization protocols (Ovsynch, J-Synch, CIDR...): a header per animal
// plus one row per step applied.
//
// The load-bearing decision here is that the protocol does NOT own its
// reproductive outcome. `fecha_ia` and `resultado` are reflections of rows in
// `eventos_reproductivos`, written through registrarServicio / registrarDxPrenez
// and linked back. Storing the insemination only on the protocol would hide it
// from vw_alertas, getPrenezPendientes() and every reproductive KPI in
// analytics.ts, all of which read eventos_reproductivos and nothing else — so a
// synchronized cow would silently drop out of the pregnancy-check alert.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import { findAnimal, findAnimalById } from '../animals';
import { aplicarProducto } from './sanidad';
import { registrarServicio, registrarDxPrenez } from './reproduccion';
import * as S from './schemas';

export type IniciarProtocoloResult = { protocoloId: string; animalId: string };
export type AplicacionResult = {
  aplicacionId: string;
  eventoSanitarioId: string;
  retiroLecheHasta: string | null;
};
export type IaProtocoloResult = {
  protocoloId: string;
  animalId: string;
  servicioEventoId: string;
  fechaIa: string;
};
export type CerrarProtocoloResult = {
  protocoloId: string;
  resultado: 'preno' | 'no_preno';
  dxEventoId: string;
  estadoReproductivo: 'prenada' | 'vacia';
};

type ProtocoloRow = {
  id: string;
  animal_id: string;
  estado: string;
  fecha_inicio: string;
  fecha_ia: string | null;
};

async function cargarProtocolo(protocoloId: string): Promise<ProtocoloRow> {
  const { data, error } = await supabase
    .from('protocolos_sincronizacion')
    .select('id, animal_id, estado, fecha_inicio, fecha_ia')
    .eq('id', protocoloId)
    .maybeSingle();
  if (error) throw new Error(`consultar protocolo: ${error.message}`);
  if (!data) throw new Error(`No existe el protocolo ${protocoloId}.`);
  return data as ProtocoloRow;
}

/** The arete is what the event-recording domain functions key on. */
async function areteDe(animalId: string): Promise<string> {
  const animal = await findAnimalById(animalId);
  if (!animal) throw new Error(`El animal ${animalId} del protocolo ya no existe.`);
  return animal.arete;
}

// ---------------------------------------------------------------------

export async function iniciarProtocolo(input: S.IniciarProtocoloInput): Promise<IniciarProtocoloResult> {
  const d = S.iniciarProtocolo.parse(input);

  // Dashboard-only channel: a typo'd arete must fail rather than create a ghost
  // animal. Same reasoning as domain/chequeos.ts.
  const animal = await findAnimal(d.arete);
  if (!animal) {
    throw new Error(`No existe ningún animal con arete ${d.arete}. Regístralo antes de iniciar un protocolo.`);
  }

  // uq_protocolo_activo enforces this in the database too, but a unique-violation
  // message is not something the vet can act on.
  const { data: activo, error: activoError } = await supabase
    .from('protocolos_sincronizacion')
    .select('id, nombre_protocolo')
    .eq('animal_id', animal.id)
    .eq('estado', 'en_curso')
    .maybeSingle();
  if (activoError) throw new Error(`consultar protocolos activos: ${activoError.message}`);
  if (activo) {
    throw new Error(
      `El animal ${d.arete} ya tiene un protocolo en curso (${activo.nombre_protocolo}). Ciérralo o cancélalo primero.`,
    );
  }

  const { data, error } = await supabase
    .from('protocolos_sincronizacion')
    .insert({
      finca_id: FINCA_ID,
      animal_id: animal.id,
      nombre_protocolo: d.nombreProtocolo,
      fecha_inicio: d.fecha,
      veterinario: d.veterinario,
      notas: d.notas,
      estado: 'en_curso',
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`iniciar protocolo de ${d.arete}: ${error?.message ?? 'sin id devuelto'}`);
  }
  return { protocoloId: data.id, animalId: animal.id };
}

/** One step of the protocol: the product given on day N. */
export async function registrarAplicacion(input: S.AplicacionProtocoloInput): Promise<AplicacionResult> {
  const d = S.aplicacionProtocolo.parse(input);
  const protocolo = await cargarProtocolo(d.protocoloId);

  if (protocolo.estado !== 'en_curso') {
    throw new Error(`El protocolo está ${protocolo.estado}; no admite aplicaciones nuevas.`);
  }
  if (d.fecha < protocolo.fecha_inicio) {
    throw new Error(`La aplicación no puede ser anterior al inicio del protocolo (${protocolo.fecha_inicio}).`);
  }

  // Prostaglandins and progesterone carry withdrawal periods too — same route as
  // every other product on the farm.
  const aplicacion = await aplicarProducto({
    animalId: protocolo.animal_id,
    producto: d.producto,
    dosis: d.dosis,
    via: d.via,
    diagnostico: 'Protocolo de sincronización',
    responsable: d.aplicadoPor,
    fecha: d.fecha,
  });

  const { data, error } = await supabase
    .from('protocolo_aplicaciones')
    .insert({
      finca_id: FINCA_ID,
      protocolo_id: protocolo.id,
      animal_id: protocolo.animal_id,
      dia_numero: d.diaNumero,
      fecha: d.fecha,
      producto: d.producto,
      dosis: d.dosis,
      aplicado_por: d.aplicadoPor,
      evento_sanitario_id: aplicacion.eventoId,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`registrar aplicación del día ${d.diaNumero}: ${error?.message ?? 'sin id devuelto'}`);
  }
  return {
    aplicacionId: data.id,
    eventoSanitarioId: aplicacion.eventoId,
    retiroLecheHasta: aplicacion.retiroLecheHasta,
  };
}

/**
 * The insemination that closes the protocol's application phase. Creates a real
 * `servicio` event (which is what moves the cow to 'servida' and starts the
 * pregnancy-check clock) and links it back to the protocol.
 */
export async function registrarIaProtocolo(input: S.IaProtocoloInput): Promise<IaProtocoloResult> {
  const d = S.iaProtocolo.parse(input);
  const protocolo = await cargarProtocolo(d.protocoloId);

  if (protocolo.estado !== 'en_curso') {
    throw new Error(`El protocolo está ${protocolo.estado}; no admite una IA nueva.`);
  }
  if (d.fecha < protocolo.fecha_inicio) {
    throw new Error(`La IA no puede ser anterior al inicio del protocolo (${protocolo.fecha_inicio}).`);
  }

  const arete = await areteDe(protocolo.animal_id);
  const servicio = await registrarServicio({
    arete,
    metodo: 'IA',
    inseminador: d.inseminador,
    pajilla: d.pajilla,
    fecha: d.fecha,
  });

  const { error } = await supabase
    .from('protocolos_sincronizacion')
    .update({ fecha_ia: d.fecha, servicio_evento_id: servicio.eventoId })
    .eq('id', protocolo.id);
  if (error) throw new Error(`enlazar la IA al protocolo: ${error.message}`);

  return {
    protocoloId: protocolo.id,
    animalId: protocolo.animal_id,
    servicioEventoId: servicio.eventoId,
    fechaIa: d.fecha,
  };
}

/** Pregnancy diagnosis that closes the protocol. */
export async function cerrarProtocolo(input: S.CerrarProtocoloInput): Promise<CerrarProtocoloResult> {
  const d = S.cerrarProtocolo.parse(input);
  const protocolo = await cargarProtocolo(d.protocoloId);

  if (protocolo.estado !== 'en_curso') {
    throw new Error(`El protocolo ya está ${protocolo.estado}.`);
  }
  // ck_protocolos_resultado enforces the same thing; failing here says why.
  if (!protocolo.fecha_ia) {
    throw new Error('No se puede cerrar un protocolo sin IA registrada.');
  }
  if (d.fecha < protocolo.fecha_ia) {
    throw new Error(`El diagnóstico no puede ser anterior a la IA (${protocolo.fecha_ia}).`);
  }

  const arete = await areteDe(protocolo.animal_id);
  const estadoReproductivo = d.resultado === 'preno' ? 'prenada' : 'vacia';
  const dx = await registrarDxPrenez({ arete, resultado: estadoReproductivo, fecha: d.fecha });

  const { error } = await supabase
    .from('protocolos_sincronizacion')
    .update({ estado: 'finalizado', resultado: d.resultado, dx_evento_id: dx.eventoId })
    .eq('id', protocolo.id);
  if (error) throw new Error(`cerrar protocolo: ${error.message}`);

  return {
    protocoloId: protocolo.id,
    resultado: d.resultado,
    dxEventoId: dx.eventoId,
    estadoReproductivo,
  };
}

/**
 * Abandons a protocol without a result.
 *
 * Not optional housekeeping: uq_protocolo_activo allows one 'en_curso' protocol
 * per animal, so a protocol that was started and then dropped (the cow was sold,
 * the CIDR fell out) would block that animal from ever starting another one.
 */
export async function cancelarProtocolo(input: S.CancelarProtocoloInput): Promise<{ protocoloId: string }> {
  const d = S.cancelarProtocolo.parse(input);
  const protocolo = await cargarProtocolo(d.protocoloId);

  if (protocolo.estado !== 'en_curso') {
    throw new Error(`El protocolo ya está ${protocolo.estado}.`);
  }

  const { error } = await supabase
    .from('protocolos_sincronizacion')
    .update({ estado: 'cancelado', notas: d.motivo })
    .eq('id', protocolo.id);
  if (error) throw new Error(`cancelar protocolo: ${error.message}`);

  return { protocoloId: protocolo.id };
}
