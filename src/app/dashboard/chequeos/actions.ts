'use server';

// Chequeo reproductivo — canal de entrada del tablero (Bloque D, #2).
//
// El dominio (domain/chequeos.ts) hace lo que importa: mapea el código clínico a
// estado_reproductivo, escribe el chequeo y —si hubo producto— lo rutea por
// aplicarProducto() para que `retiro_leche_hasta` salga de cat_medicamentos.
// Aquí solo se traduce el formulario.

import { revalidatePath } from 'next/cache';
import { requerirPermiso } from '@/lib/auth/server';
import { registrarChequeo } from '@/lib/domain/chequeos';
import { CODIGOS_CHEQUEO, ESTRUCTURAS_OVARICAS } from '@/lib/domain/schemas';
import { estadoLegible } from '@/lib/vocabulario';
import {
  mensajeDeError, numeroOpcional, opcion, opcionDe, texto, textoOpcional,
} from '@/lib/forms';
import { volverCon } from '../_resultado';

const RUTA = '/dashboard/chequeos';

export async function registrarChequeoAction(formData: FormData): Promise<void> {
  let ok = '';
  let error = '';
  try {
    await requerirPermiso('chequeo.registrar');

    const r = await registrarChequeo({
      arete: texto(formData, 'arete', 'el arete'),
      fecha: texto(formData, 'fecha', 'la fecha'),
      veterinario: texto(formData, 'veterinario', 'quién hizo el chequeo'),
      estadoCodigo: opcion(formData, 'estadoCodigo', CODIGOS_CHEQUEO, 'el hallazgo'),
      ovarioDerMm: numeroOpcional(formData, 'ovarioDerMm', 'Ovario derecho (mm)'),
      ovarioDerEstructura: opcionDe(formData, 'ovarioDerEstructura', ESTRUCTURAS_OVARICAS, 'Estructura derecha'),
      ovarioIzqMm: numeroOpcional(formData, 'ovarioIzqMm', 'Ovario izquierdo (mm)'),
      ovarioIzqEstructura: opcionDe(formData, 'ovarioIzqEstructura', ESTRUCTURAS_OVARICAS, 'Estructura izquierda'),
      observaciones: textoOpcional(formData, 'observaciones'),
      producto: textoOpcional(formData, 'producto'),
      dosis: textoOpcional(formData, 'dosis'),
      via: textoOpcional(formData, 'via'),
    });

    const arete = texto(formData, 'arete');
    // El estado se informa siempre, y en el caso RECHE se dice explícitamente que
    // NO cambió: si el aviso callara, el veterinario podría leer «guardado» como
    // «quedó descartada», que es justo lo contrario de lo que RECHE significa.
    const estado = r.estadoReproductivo
      ? `Queda ${estadoLegible(r.estadoReproductivo)}.`
      : 'La vaca conserva su estado anterior y queda en la lista de rechequeos.';
    const retiro = r.retiroLecheHasta
      ? ` ⚠️ Leche retenida hasta el ${r.retiroLecheHasta}.`
      : '';

    ok = `Chequeo de ${arete} guardado. ${estado}${retiro}`;
    revalidatePath(RUTA);
  } catch (e) {
    error = mensajeDeError(e);
  }
  volverCon(RUTA, { ok, error });
}
