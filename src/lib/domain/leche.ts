// Producción de leche: DOS registros distintos del mismo ordeño.
//
//   · registrarProduccionDiaria  — el total de CANTINA. Un número. Es lo que hay
//     casi todos los días. Va solo a `controles_leche` (tipo='diario',
//     litros_total) y NUNCA escribe en produccion_leche: esa tabla es por
//     animal, y un total del hato no tiene animal.
//   · registrarControlLeche      — el conteo INDIVIDUAL, vaca por vaca, cada 2-3
//     semanas. Cabecera en `controles_leche` (tipo='individual', litros_total
//     NULL) y detalle en produccion_leche.
//
// Los dos pueden existir para el mismo ordeño: la cantina es lo que se vendió y
// el desglose cómo se repartió entre las vacas. Su diferencia es el cuadre. Ver
// db/07_produccion_diaria.sql.
//
// Control lechero individual: el hato en ordeño pesado en un ordeño concreto.
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
// ⚠️ EL TOTAL DEL CONTEO NO SE GUARDA. Mañana → ordeno='manana', tarde →
// 'tarde', y el total del conteo se deriva sumando: por eso `litros_total` es
// NULL en las cabeceras tipo='individual'. El `litros_total` con número es otra
// cosa —la cantina— y viene por la otra función.

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

/**
 * Se lanza cuando ESE registro de ese ordeño ya existe.
 *
 * Nombra el tipo porque desde db/07 los dos conviven: decirle «ya está
 * registrado» a quien acaba de teclear el total, cuando lo que hay guardado es
 * el conteo individual, lo mandaría a borrar el dato bueno.
 */
export class ControlDuplicado extends Error {
  constructor(
    readonly fecha: string,
    readonly ordeno: string,
    readonly tipo: 'diario' | 'individual' = 'individual',
  ) {
    const cual = tipo === 'diario' ? 'total de cantina' : 'conteo individual';
    super(
      `Ya hay un ${cual} de la ${ordeno === 'manana' ? 'mañana' : 'tarde'} del ${fecha}. ` +
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
      // Explícito y no por DEFAULT, igual que finca_id: el default de la columna
      // es una red de seguridad del esquema, no el contrato de la aplicación.
      tipo: 'individual',
      // created_by es la FK autoritativa; medido_por es la copia del nombre, que
      // sigue sirviendo si algún día se borra la cuenta del operario.
      created_by: d.createdBy,
      medido_por: d.medidoPor,
      notas: d.notas,
    })
    .select('id')
    .single();

  if (controlError || !control?.id) {
    if (esDuplicado(controlError?.message)) throw new ControlDuplicado(d.fecha, d.ordeno, 'individual');
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
    // cabecera huérfana, y uq_control_finca_fecha_ordeno_tipo rechazaría después
    // todo reintento de ese conteo — no se podría volver a capturar nunca.
    await supabase.from('controles_leche').delete().eq('id', control.id);
    if (esDuplicado(filasError.message)) throw new ControlDuplicado(d.fecha, d.ordeno, 'individual');
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

export type ProduccionDiariaResult = {
  controlId: string;
  fecha: string;
  ordeno: 'manana' | 'tarde';
  litros: number;
};

/**
 * El total de CANTINA de un ordeño. Un número, sin desglose.
 *
 * Es el registro de casi todos los días. Escribe UNA fila en `controles_leche`
 * con tipo='diario' y `litros_total`, y **ni una** en `produccion_leche`: esa
 * tabla es por animal y un total del hato no tiene animal. Meterlo ahí exigiría
 * una vaca fantasma tipo «CANTINA» que saldría en el inventario, en la
 * genealogía y en el listado de ordeño.
 *
 * No choca con el conteo individual del mismo ordeño — desde db/07 la unicidad
 * incluye `tipo`, y que los dos convivan es lo que permite cuadrarlos.
 */
export async function registrarProduccionDiaria(
  input: S.ProduccionDiariaInput,
): Promise<ProduccionDiariaResult> {
  const d = S.produccionDiaria.parse(input);

  const { data: control, error } = await supabase
    .from('controles_leche')
    .insert({
      finca_id: FINCA_ID,
      fecha: d.fecha,
      ordeno: d.ordeno,
      tipo: 'diario',
      litros_total: d.litros,
      created_by: d.createdBy,
      medido_por: d.medidoPor,
      notas: d.notas,
    })
    .select('id')
    .single();

  if (error || !control?.id) {
    if (esDuplicado(error?.message)) throw new ControlDuplicado(d.fecha, d.ordeno, 'diario');
    throw new Error(`registrar total del ordeño: ${error?.message ?? 'sin id devuelto'}`);
  }

  return {
    controlId: control.id,
    fecha: d.fecha,
    ordeno: d.ordeno,
    litros: d.litros,
  };
}
