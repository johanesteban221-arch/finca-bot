// Cómo se le enseña al veterinario el vocabulario clínico que la base guarda
// en código. Los códigos (`P`, `VAP`, `CL2`…) son la fuente de verdad y viven en
// domain/schemas.ts, espejo de los CHECK de db/03_hoja_de_vida.sql. Esto es solo
// la capa visible, y va aparte por la misma razón que ROL_LABEL: el dominio no
// debe saber cómo se escribe una etiqueta en pantalla.
//
// ⚠️ Si algún día se agrega un código, se agrega en los tres sitios: el CHECK de
// Postgres, el enum de zod y este mapa. Un código sin etiqueta aquí no rompe
// nada — se muestra crudo — pero el vet lee «VAP» en vez de qué significa.

import type { CodigoChequeo, EstructuraOvarica } from './domain/schemas';

export const CHEQUEO_LABEL: Record<CodigoChequeo, string> = {
  P: 'P · Preñada',
  V: 'V · Vacía',
  SE: 'SE · Servida',
  VAS: 'VAS · Vacía, anestro superficial',
  VAP: 'VAP · Vacía, anestro profundo',
  PP: 'PP · Post-parto',
  RECHE: 'RECHE · Rechequeo (volver a ecografiar)',
};

/**
 * RECHE no es un hallazgo: es «no pude definirla». El animal CONSERVA su estado
 * anterior — ponerle uno sería inventar un diagnóstico que el veterinario no
 * hizo. Lo que sí genera es la alerta de rechequeo, que se cierra sola con el
 * chequeo siguiente. Este texto va en la pantalla para que no se lea como
 * descarte.
 */
export const NOTA_RECHE =
  'RECHE no cambia el estado de la vaca: queda en la lista de rechequeos hasta que la vuelva a revisar.';

export const ESTRUCTURA_LABEL: Record<EstructuraOvarica, string> = {
  CL1: 'CL1 · Cuerpo lúteo grado 1',
  CL2: 'CL2 · Cuerpo lúteo grado 2',
  CL3: 'CL3 · Cuerpo lúteo grado 3',
  MF: 'MF · Multifolicular',
  QF: 'QF · Quiste folicular',
  QL: 'QL · Quiste luteínico',
  F8mm: 'F8mm · Folículo 8 mm',
  F10mm: 'F10mm · Folículo 10 mm',
  F12mm: 'F12mm · Folículo 12 mm',
  FPre: 'FPre · Folículo preovulatorio',
};

export const ESTADO_REPRODUCTIVO_LABEL: Record<string, string> = {
  vacia: 'vacía',
  servida: 'servida',
  prenada: 'preñada',
  parida: 'parida',
  seca: 'seca',
};

export const estadoLegible = (v: string | null): string =>
  v ? ESTADO_REPRODUCTIVO_LABEL[v] ?? v : '—';
