'use server';

// Control lechero — canal de entrada del tablero.
//
// Toda la lógica vive en domain/leche.ts: resolver los aretes, escribir la
// cabecera, escribir el detalle en produccion_leche y compensar si el detalle
// falla. Aquí solo se traduce el FormData de una pantalla con cuarenta vacas al
// input que el dominio espera.

import { revalidatePath } from 'next/cache';
import { requerirPermiso } from '@/lib/auth/server';
import { registrarControlLeche } from '@/lib/domain/leche';
import { mensajeDeError, numeroOpcional, texto, textoOpcional } from '@/lib/forms';
import { volverCon } from '../_resultado';

const RUTA = '/dashboard/leche';

export async function registrarControlAction(formData: FormData): Promise<void> {
  let ok = '';
  let error = '';
  try {
    // Primera línea, siempre. Lanza, así que un olvido no puede leerse como éxito.
    await requerirPermiso('leche.registrar');

    const fecha = texto(formData, 'fecha', 'la fecha del control');
    const medidoPor = textoOpcional(formData, 'medidoPor');
    const notas = textoOpcional(formData, 'notas');

    // Los campos vienen como `am:<arete>` / `pm:<arete>`. El arete se valida con
    // /^[\w-]{1,15}$/, que no admite ':', así que el prefijo nunca es ambiguo.
    const aretes = new Set<string>();
    for (const clave of formData.keys()) {
      if (clave.startsWith('am:') || clave.startsWith('pm:')) aretes.add(clave.slice(3));
    }

    // Una vaca sin ninguna casilla llena NO se registra: la pantalla lista el
    // hato entero y el operario deja en blanco a la que no ordeñó. Mandarla como
    // 0 sería inventar una medición — y 0 es un valor legítimo, así que el
    // dominio no podría distinguirla de una vaca que de verdad no dio nada.
    const mediciones = [];
    for (const arete of aretes) {
      const litrosAm = numeroOpcional(formData, `am:${arete}`, `Mañana de ${arete}`);
      const litrosPm = numeroOpcional(formData, `pm:${arete}`, `Tarde de ${arete}`);
      if (litrosAm === null && litrosPm === null) continue;
      mediciones.push({ arete, litrosAm, litrosPm });
    }

    if (!mediciones.length) {
      throw new Error('No llenaste ningún ordeño. Escribe al menos los litros de una vaca.');
    }

    const r = await registrarControlLeche({ fecha, medidoPor, notas, mediciones });
    ok =
      `Control del ${r.fecha} guardado: ${r.vacas} ${r.vacas === 1 ? 'vaca' : 'vacas'}, ` +
      `${r.mediciones} ${r.mediciones === 1 ? 'ordeño' : 'ordeños'}, ${r.totalLitros} L en total.`;
    revalidatePath(RUTA);
  } catch (e) {
    error = mensajeDeError(e);
  }
  volverCon(RUTA, { ok, error });
}
