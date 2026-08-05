// Single definition of what a valid write looks like, shared by every entry
// channel: the WhatsApp state machines today, the dashboard forms in Fase 3.
//
// The constraints here mirror the CHECK constraints in db/schema.sql and
// db/01_bot_schema.sql on purpose. If you change one, change the other — a
// mismatch surfaces as a Postgres error the user cannot act on.

import { z } from 'zod';
import { today } from '../dates';

// ---------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------

// Same rule the flows enforce interactively (state-machine.ts `validArete`).
export const arete = z
  .string()
  .trim()
  .regex(/^[\w-]{1,15}$/, 'Arete inválido: solo números, letras, guión o guión bajo (máx. 15).');

// Calendar day on the farm. Defaults to today; never accepts the future, which
// matters once the dashboard forms let the user pick a date (Fase 3).
export const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida: usa el formato AAAA-MM-DD.')
  .refine((f) => f <= today(), 'La fecha no puede estar en el futuro.')
  .default(() => today());

// Free-text optional field: the flows accept the literal NINGUNO to mean
// "not recorded", and empty strings must land as NULL, not ''.
export const opcional = z
  .string()
  .trim()
  .transform((v) => (v === '' || /^ninguno$/i.test(v) ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const sexo = z.enum(['H', 'M']);

// animales.categoria has no CHECK in the schema, but these are the only values
// the bot offers (animals.ts CATEGORIAS) and the dashboard must not widen them.
export const categoria = z.enum([
  'ternero', 'levante', 'ceba', 'novilla', 'vaca', 'vaca_seca', 'toro',
]);

// ---------------------------------------------------------------------
// Animales
// ---------------------------------------------------------------------
export const crearAnimal = z.object({
  arete,
  sexo,
  categoria,
  raza: opcional,
  notas: opcional,
});

export const categorizarAnimal = z.object({
  animalId: z.string().uuid('Id de animal inválido.'),
  categoria,
});

// ---------------------------------------------------------------------
// Sanidad  (eventos_sanitarios.tipo CHECK: vacuna|desparasitacion|tratamiento|revision)
// ---------------------------------------------------------------------
export const vacunacion = z.object({
  arete,
  vacuna: z.string().trim().min(1, 'Indica la vacuna aplicada.'),
  dosis: z.string().trim().min(1, 'Indica la dosis aplicada.'),
  fecha,
});

export const tratamiento = z.object({
  arete,
  diagnostico: z.string().trim().min(1, 'Indica el diagnóstico.'),
  medicamento: z.string().trim().min(1, 'Indica el medicamento aplicado.'),
  dosis: z.string().trim().min(1, 'Indica la dosis aplicada.'),
  via: z.string().trim().min(1, 'Indica la vía de aplicación.'),
  fecha,
});

export const desparasitacion = z.object({
  arete,
  producto: z.string().trim().min(1, 'Indica el producto aplicado.'),
  dosis: z.string().trim().min(1, 'Indica la dosis aplicada.'),
  fecha,
});

// ---------------------------------------------------------------------
// Reproducción
// ---------------------------------------------------------------------
export const servicio = z
  .object({
    arete,
    metodo: z.enum(['IA', 'monta']),
    inseminador: opcional, // IA
    pajilla: opcional,     // IA
    toro: opcional,        // monta
    fecha,
  })
  // The inseminator is the one field the IA branch always collects; requiring it
  // here keeps a dashboard form from saving a half-filled IA record.
  .refine((s) => s.metodo !== 'IA' || !!s.inseminador, {
    message: 'Para inseminación hay que indicar quién inseminó.',
    path: ['inseminador'],
  });

export const dxPrenez = z.object({
  arete,
  resultado: z.enum(['prenada', 'vacia']),
  fecha,
});

export const parto = z
  .object({
    madre: arete,
    cria: arete,
    sexo,
    // Birth weight bound: the flow rejects anything over 100 kg as a typo.
    peso: z.number().positive('El peso debe ser mayor que 0.').max(100, 'Peso al nacer implausible (máx. 100 kg).').nullable().optional().transform((v) => v ?? null),
    fecha,
  })
  .refine((p) => p.madre !== p.cria, {
    message: 'La cría no puede tener el mismo arete que la madre.',
    path: ['cria'],
  });

// ---------------------------------------------------------------------
// Pesajes  (pesajes.tipo CHECK; condicion_corporal CHECK between 1 and 5)
// ---------------------------------------------------------------------
export const pesaje = z.object({
  arete,
  peso: z.number().positive('El peso debe ser mayor que 0.').max(2000, 'Peso implausible (máx. 2000 kg).'),
  tipo: z.enum(['nacimiento', 'destete', 'control', 'venta']),
  condicionCorporal: z.number().int().min(1).max(5).nullable().optional().transform((v) => v ?? null),
  fecha,
});

// ---------------------------------------------------------------------
// Mortalidad  (movimientos.tipo CHECK: compra|venta|traslado|muerte|descarte)
// ---------------------------------------------------------------------
export const mortalidad = z.object({
  arete,
  causa: z.string().trim().min(1, 'Indica la causa de la baja.'),
  fecha,
});

// ---------------------------------------------------------------------
// Inferred input types — what callers pass in.
// ---------------------------------------------------------------------
export type CrearAnimalInput = z.input<typeof crearAnimal>;
export type CategorizarAnimalInput = z.input<typeof categorizarAnimal>;
export type VacunacionInput = z.input<typeof vacunacion>;
export type TratamientoInput = z.input<typeof tratamiento>;
export type DesparasitacionInput = z.input<typeof desparasitacion>;
export type ServicioInput = z.input<typeof servicio>;
export type DxPrenezInput = z.input<typeof dxPrenez>;
export type PartoInput = z.input<typeof parto>;
export type PesajeInput = z.input<typeof pesaje>;
export type MortalidadInput = z.input<typeof mortalidad>;
