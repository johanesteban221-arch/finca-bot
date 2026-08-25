// Control lechero manual: el hato en ordeño pesado en un ordeño concreto.
//
// Un control es de UN ordeño, no de un día. Antes era uno por día con columnas
// de mañana y tarde, y eso hacía imposible el uso real: la mañana se pesa a las
// 5 y la tarde a las 3, y el segundo guardado chocaba con la unicidad por
// (finca, fecha). Ver db/05_control_leche_ordeno.sql.
//
// El detalle por vaca NO va en una tabla propia. Aterriza en `produccion_leche`,
// que ya tiene exactamente la forma necesaria (animal_id, fecha, ordeno, litros).
// Una tabla paralela dejaría la sección de leche del tablero vacía para siempre
// (analytics.ts lee produccion_leche), partiría la línea de tiempo del animal en
// dos y dejaría el control fuera de vw_respaldo_completo.
//
// ⚠️ EL TOTAL NO SE GUARDA. Mañana → ordeno='manana', tarde → 'tarde', y el total
// se deriva sumando. analytics.ts suma `litros` de TODAS las filas sin mirar
// `ordeno`, así que una tercera fila 'total' duplicaría la producción del hato.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import * as S from './schemas';

export type ControlLecheResult = {
  controlId: string;
  fecha: string;
  ordeno: 'manana' | 'tarde';
  /** Vacas registradas en este ordeño. */
  vacas: number;
  totalLitros: number;
};

/** Se lanza cuando ese ordeño de ese día ya está registrado. */
export class ControlDuplicado extends Error {
  constructor(readonly fecha: string, readonly ordeno: string) {
    super(
      `Ya hay un control de la ${ordeno === 'manana' ? 'mañana' : 'tarde'} del ${fecha}. ` +
        'Si necesita corregirlo, hay que borrarlo primero.',
    );
    this.name = 'ControlDuplicado';
  }
}

// Postgres: violación de unicidad. Se distingue del resto de errores porque es
// el único que el operario puede entender y accionar — casi siempre es un doble
// toque en "Guardar" con la señal del corral, no un fallo.
const esDuplicado = (mensaje: string | undefined): boolean =>
  !!mensaje && (mensaje.includes('23505') || /duplicate key|unique constraint/i.test(mensaje));

export async function registrarControlLeche(input: S.ControlLecheInput): Promise<ControlLecheResult> {
  const d = S.controlLeche.parse(input);
  const aretes = d.mediciones.map((m) => m.arete);

  // Resolver todos los aretes en un viaje, antes de escribir nada.
  //
  // Nada de findOrCreateAnimal: la pantalla lista cuarenta vacas y un arete mal
  // tecleado crearía en silencio un animal fantasma que después aparece en el
  // inventario. Y nada de escritura parcial: supabase-js no tiene transacciones,
  // así que la validación entera va por delante o una fila mala deja el control
  // a medio registrar.
  const { data: encontrados, error: buscarError } = await supabase
    .from('animales')
    .select('id, arete')
    .eq('finca_id', FINCA_ID)
    .in('arete', aretes);
  if (buscarError) throw new Error(`buscar animales del control: ${buscarError.message}`);

  const idPorArete = new Map<string, string>();
  for (const a of encontrados ?? []) idPorArete.set(a.arete, a.id);

  const faltantes = aretes.filter((a) => !idPorArete.has(a));
  if (faltantes.length) {
    throw new Error(
      `Estos aretes no existen en el hato: ${faltantes.join(', ')}. Regístralos antes de guardar el control.`,
    );
  }

  const { data: control, error: controlError } = await supabase
    .from('controles_leche')
    .insert({
      finca_id: FINCA_ID,
      fecha: d.fecha,
      ordeno: d.ordeno,
      // created_by es la FK autoritativa; medido_por es la copia del nombre, que
      // sigue sirviendo si algún día se borra la cuenta del operario.
      created_by: d.createdBy,
      medido_por: d.medidoPor,
      notas: d.notas,
    })
    .select('id')
    .single();

  if (controlError || !control?.id) {
    if (esDuplicado(controlError?.message)) throw new ControlDuplicado(d.fecha, d.ordeno);
    throw new Error(`registrar control de leche: ${controlError?.message ?? 'sin id devuelto'}`);
  }

  const filas = d.mediciones.map((m) => ({
    finca_id: FINCA_ID,
    animal_id: idPorArete.get(m.arete)!,
    fecha: d.fecha,
    ordeno: d.ordeno,
    litros: m.litros,
    control_id: control.id,
    fuente: 'control',
  }));

  const { error: filasError } = await supabase.from('produccion_leche').insert(filas);
  if (filasError) {
    // Borrado compensatorio: sin transacción, un detalle fallido dejaría una
    // cabecera huérfana, y uq_control_finca_fecha_ordeno rechazaría después todo
    // reintento de ese ordeño — el control no se podría volver a capturar nunca.
    await supabase.from('controles_leche').delete().eq('id', control.id);
    if (esDuplicado(filasError.message)) throw new ControlDuplicado(d.fecha, d.ordeno);
    throw new Error(`registrar mediciones del control: ${filasError.message}`);
  }

  return {
    controlId: control.id,
    fecha: d.fecha,
    ordeno: d.ordeno,
    vacas: filas.length,
    totalLitros: Math.round(filas.reduce((s, r) => s + r.litros, 0) * 10) / 10,
  };
}
