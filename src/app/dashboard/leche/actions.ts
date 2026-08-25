'use server';

// Leche — canales de entrada del tablero. Son DOS, como el trabajo real:
//
//   · registrarTotalAction    → el total de cantina del ordeño. Un número. Casi
//     todos los días.
//   · registrarControlAction  → el conteo individual, vaca por vaca. Cada 2-3
//     semanas.
//
// La lógica vive en domain/leche.ts. Aquí solo se traduce el FormData, y se pone
// la identidad: `createdBy` y `medidoPor` salen de la SESIÓN, nunca del
// formulario. Antes `medidoPor` era un campo de
// texto editable y el operario podía escribir cualquier cosa o dejarlo vacío;
// una firma que el propio firmante puede cambiar no sirve para auditar nada.

import { revalidatePath } from 'next/cache';
import { requerirPermiso } from '@/lib/auth/server';
import { registrarControlLeche, registrarProduccionDiaria } from '@/lib/domain/leche';
import { ORDENO_LABEL } from '@/lib/dates';
import { mensajeDeError, numeroOpcional, opcion, texto, textoOpcional } from '@/lib/forms';
import { volverCon } from '../_resultado';

const RUTA = '/dashboard/leche';

/**
 * El total de cantina de un ordeño: un campo y guardar.
 *
 * No escribe una sola fila en produccion_leche — eso es el otro modo. Aquí no
 * hay vacas, hay un número.
 */
export async function registrarTotalAction(formData: FormData): Promise<void> {
  let ok = '';
  let error = '';
  let ordeno: 'manana' | 'tarde' = 'manana';
  let fecha = '';
  try {
    // Primera línea, siempre. Lanza, así que un olvido no puede leerse como éxito.
    const usuario = await requerirPermiso('leche.registrar');

    fecha = texto(formData, 'fecha', 'la fecha del ordeño');
    ordeno = opcion(formData, 'ordeno', ['manana', 'tarde'] as const, 'el ordeño');

    // Obligatorio, y por eso se lee con numeroOpcional y se rechaza el vacío a
    // mano: aquí la casilla en blanco no significa «dio cero» como en el conteo
    // por vaca, significa «no tengo el dato», y guardar un 0 por ella metería un
    // día de producción nula en la serie del hato.
    const litros = numeroOpcional(formData, 'litros', 'Los litros del ordeño');
    if (litros === null) {
      throw new Error('Escribe los litros de cantina de este ordeño.');
    }

    const r = await registrarProduccionDiaria({
      fecha,
      ordeno,
      litros,
      createdBy: usuario.id,
      medidoPor: usuario.nombre,
      notas: textoOpcional(formData, 'notas'),
    });

    ok = `${ORDENO_LABEL[r.ordeno]} del ${r.fecha}: ${r.litros} L de cantina. Verifíquelo en el historial de arriba.`;
    revalidatePath(RUTA);
  } catch (e) {
    error = mensajeDeError(e);
  }
  volverCon(RUTA, { ok, error }, { modo: 'total', ordeno, fecha: fecha || undefined });
}

export async function registrarControlAction(formData: FormData): Promise<void> {
  let ok = '';
  let error = '';
  let ordeno: 'manana' | 'tarde' = 'manana';
  let fecha = '';
  try {
    // Primera línea, siempre. Lanza, así que un olvido no puede leerse como éxito.
    const usuario = await requerirPermiso('leche.registrar');

    fecha = texto(formData, 'fecha', 'la fecha del control');
    ordeno = opcion(formData, 'ordeno', ['manana', 'tarde'] as const, 'el ordeño');

    // Los campos vienen como `l:<arete>`. El arete se valida con /^[\w-]{1,15}$/,
    // que no admite ':', así que el prefijo nunca es ambiguo.
    const mediciones = [];
    for (const clave of formData.keys()) {
      if (!clave.startsWith('l:')) continue;
      const arete = clave.slice(2);
      const litros = numeroOpcional(formData, clave, `Litros de ${arete}`);
      // Casilla en blanco = "no la ordeñé", y NO se registra. Un 0 sí: significa
      // "dio cero". Se ven igual en la pantalla y significan lo contrario, y esta
      // línea es el único sitio donde se distinguen.
      if (litros === null) continue;
      mediciones.push({ arete, litros });
    }

    if (!mediciones.length) {
      throw new Error('No llenaste ninguna vaca. Escribe al menos los litros de una.');
    }

    const r = await registrarControlLeche({
      fecha,
      ordeno,
      createdBy: usuario.id,
      medidoPor: usuario.nombre,
      notas: textoOpcional(formData, 'notas'),
      mediciones,
    });

    ok =
      `${ORDENO_LABEL[r.ordeno]} del ${r.fecha}: ${r.vacas} ${r.vacas === 1 ? 'vaca' : 'vacas'}, ` +
      `${r.totalLitros} L. Verifíquelo en el historial de arriba.`;
    revalidatePath(RUTA);
  } catch (e) {
    error = mensajeDeError(e);
  }
  // El ordeño y la fecha vuelven en la URL para que la pantalla se repinte donde
  // el operario estaba. Sin esto, un error lo devolvería al ordeño sugerido por
  // el reloj y tendría que volver a elegir antes de reintentar.
  volverCon(RUTA, { ok, error }, { modo: 'individual', ordeno, fecha: fecha || undefined });
}
