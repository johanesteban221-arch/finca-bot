// Manual milk control: the whole milking herd weighed on one day, every two or
// three weeks. Entry channel is a single dashboard screen listing the cows.
//
// The per-cow readings do NOT go into a table of their own. They land in
// `produccion_leche`, which already has exactly the right shape (animal_id,
// fecha, ordeno, litros). A parallel table would leave the dashboard's milk
// section permanently empty (analytics.ts reads produccion_leche), split the
// animal's timeline in two, and drop the control out of vw_respaldo_completo.
//
// ⚠️ The total is never stored. AM -> ordeno='manana', PM -> ordeno='tarde', and
// the total is derived by summing. analytics.ts adds up `litros` across all rows
// without looking at `ordeno`, so a third 'total' row would double the herd's
// production.

import { supabase } from '../supabase';
import { FINCA_ID } from '../tenant';
import * as S from './schemas';

export type ControlLecheResult = {
  controlId: string;
  fecha: string;
  /** Cows with at least one reading. */
  vacas: number;
  /** Rows written to produccion_leche (one per ordeño recorded). */
  mediciones: number;
  totalLitros: number;
};

export async function registrarControlLeche(input: S.ControlLecheInput): Promise<ControlLecheResult> {
  const d = S.controlLeche.parse(input);
  const aretes = d.mediciones.map((m) => m.arete);

  // Resolve every arete in one round trip, before writing anything.
  //
  // No findOrCreateAnimal here: the form lists 40-odd cows, and a mistyped arete
  // would quietly create 1 ghost animal that then shows up in the inventory
  // count and in the "sin 2º pesaje" figures. And no partial write either —
  // there are no transactions in supabase-js, so validation has to happen
  // entirely up front or a bad row leaves the control half-recorded.
  const { data: encontrados, error: buscarError } = await supabase
    .from('animales')
    .select('id, arete')
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
      medido_por: d.medidoPor,
      notas: d.notas,
    })
    .select('id')
    .single();
  if (controlError || !control?.id) {
    throw new Error(`registrar control de leche: ${controlError?.message ?? 'sin id devuelto'}`);
  }

  const filas = d.mediciones.flatMap((m) => {
    const base = { finca_id: FINCA_ID, animal_id: idPorArete.get(m.arete)!, fecha: d.fecha, control_id: control.id, fuente: 'control' };
    return [
      m.litrosAm !== null ? { ...base, ordeno: 'manana', litros: m.litrosAm } : null,
      m.litrosPm !== null ? { ...base, ordeno: 'tarde', litros: m.litrosPm } : null,
    ].filter((r): r is NonNullable<typeof r> => r !== null);
  });

  const { error: filasError } = await supabase.from('produccion_leche').insert(filas);
  if (filasError) {
    // Compensating delete: without a transaction, a failed detail insert would
    // leave an empty header behind, and uq_control_finca_fecha would then reject
    // every retry for that date — the control could never be re-entered.
    await supabase.from('controles_leche').delete().eq('id', control.id);
    throw new Error(`registrar mediciones del control: ${filasError.message}`);
  }

  return {
    controlId: control.id,
    fecha: d.fecha,
    vacas: d.mediciones.length,
    mediciones: filas.length,
    totalLitros: Math.round(filas.reduce((s, r) => s + r.litros, 0) * 10) / 10,
  };
}
