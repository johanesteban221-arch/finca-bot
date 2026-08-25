'use server';

// Protocolos de sincronización — canal de entrada del tablero (Bloque D, #3).
//
// A diferencia de los otros dos formularios, un protocolo no es un envío: es un
// ciclo (inicio → aplicaciones por día → IA → resultado), así que aquí hay cinco
// acciones y no una. Todas guardan el mismo contrato: permiso primero, dominio
// después, y ni una escritura directa a Supabase.
//
// `cancelar` no es un lujo administrativo: uq_protocolo_activo permite UN
// protocolo 'en_curso' por animal, así que un protocolo abandonado (la vaca se
// vendió, se cayó el CIDR) bloquea a ese animal para siempre si no hay forma de
// cerrarlo.

import { revalidatePath } from 'next/cache';
import { requerirPermiso } from '@/lib/auth/server';
import {
  iniciarProtocolo, registrarAplicacion, registrarIaProtocolo,
  cerrarProtocolo, cancelarProtocolo,
} from '@/lib/domain/protocolos';
import { estadoLegible } from '@/lib/vocabulario';
import { entero, mensajeDeError, opcion, texto, textoOpcional } from '@/lib/forms';
import { volverCon } from '../_resultado';

const RUTA = '/dashboard/protocolos';

/** Envuelve el contrato común: permiso → dominio → aviso por la URL. */
async function ejecutar(trabajo: () => Promise<string>): Promise<never> {
  let ok = '';
  let error = '';
  try {
    await requerirPermiso('protocolo.registrar');
    ok = await trabajo();
    revalidatePath(RUTA);
  } catch (e) {
    error = mensajeDeError(e);
  }
  // Fuera del try: redirect() lanza, y dentro el catch se lo tragaría.
  return volverCon(RUTA, { ok, error });
}

export async function iniciarProtocoloAction(formData: FormData): Promise<void> {
  await ejecutar(async () => {
    const arete = texto(formData, 'arete', 'el arete');
    await iniciarProtocolo({
      arete,
      nombreProtocolo: texto(formData, 'nombreProtocolo', 'el nombre del protocolo'),
      veterinario: textoOpcional(formData, 'veterinario'),
      notas: textoOpcional(formData, 'notas'),
      fecha: texto(formData, 'fecha', 'la fecha de inicio'),
    });
    return `Protocolo iniciado para ${arete}. El día 0 es la fecha de inicio.`;
  });
}

export async function registrarAplicacionAction(formData: FormData): Promise<void> {
  await ejecutar(async () => {
    const dia = entero(formData, 'diaNumero', 'El día del protocolo');
    const r = await registrarAplicacion({
      protocoloId: texto(formData, 'protocoloId', 'el protocolo'),
      diaNumero: dia,
      producto: texto(formData, 'producto', 'el producto aplicado'),
      dosis: textoOpcional(formData, 'dosis'),
      via: textoOpcional(formData, 'via'),
      aplicadoPor: textoOpcional(formData, 'aplicadoPor'),
      fecha: texto(formData, 'fecha', 'la fecha'),
    });
    const retiro = r.retiroLecheHasta ? ` ⚠️ Leche retenida hasta el ${r.retiroLecheHasta}.` : '';
    return `Aplicación del día ${dia} registrada.${retiro}`;
  });
}

export async function registrarIaAction(formData: FormData): Promise<void> {
  await ejecutar(async () => {
    const r = await registrarIaProtocolo({
      protocoloId: texto(formData, 'protocoloId', 'el protocolo'),
      inseminador: texto(formData, 'inseminador', 'quién inseminó'),
      pajilla: textoOpcional(formData, 'pajilla'),
      fecha: texto(formData, 'fecha', 'la fecha de la IA'),
    });
    // La IA del protocolo genera un eventos_reproductivos de verdad: sin él, ni
    // vw_alertas ni getPrenezPendientes() ni los KPIs de analytics.ts la verían.
    return `IA del ${r.fechaIa} registrada. Queda como servicio en la hoja de vida del animal.`;
  });
}

export async function cerrarProtocoloAction(formData: FormData): Promise<void> {
  await ejecutar(async () => {
    const r = await cerrarProtocolo({
      protocoloId: texto(formData, 'protocoloId', 'el protocolo'),
      resultado: opcion(formData, 'resultado', ['preno', 'no_preno'] as const, 'el resultado'),
      fecha: texto(formData, 'fecha', 'la fecha del diagnóstico'),
    });
    return `Protocolo cerrado: ${r.resultado === 'preno' ? 'preñada' : 'vacía'}. ` +
      `La vaca queda ${estadoLegible(r.estadoReproductivo)}.`;
  });
}

export async function cancelarProtocoloAction(formData: FormData): Promise<void> {
  await ejecutar(async () => {
    await cancelarProtocolo({
      protocoloId: texto(formData, 'protocoloId', 'el protocolo'),
      motivo: textoOpcional(formData, 'motivo'),
    });
    return 'Protocolo cancelado. El animal queda libre para empezar otro.';
  });
}
