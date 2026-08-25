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

// A calendar day with no direction constraint. Exists for `fecha_probable_parto`,
// which is by definition in the future — running it through `fecha` above would
// reject every dry-off. Do not reach for this to dodge the no-future rule on an
// event date: an event that has not happened yet must not be recorded.
export const fechaEstimada = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida: usa el formato AAAA-MM-DD.')
  .nullable()
  .optional()
  .transform((v) => v ?? null);

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
  // z.uuid() rather than z.string().uuid(), which zod 4 deprecates.
  animalId: z.uuid('Id de animal inválido.'),
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
// Secado  (eventos_reproductivos.tipo CHECK already allows 'secado')
// ---------------------------------------------------------------------
// The intramammary product is optional here on purpose: a cow can be dried off
// by simply stopping the milking routine. When it IS given, the domain routes it
// through eventos_sanitarios so the withdrawal date gets computed.
export const secado = z
  .object({
    arete,
    producto: opcional,
    dosis: opcional,
    responsable: opcional,
    /** Left null to let the domain derive it from the last service + gestation. */
    fechaProbableParto: fechaEstimada,
    fecha,
  })
  .refine((s) => !s.producto || !!s.dosis, {
    message: 'Si registras un producto de secado, indica la dosis.',
    path: ['dosis'],
  });

// ---------------------------------------------------------------------
// Chequeo reproductivo  (db/03_hoja_de_vida.sql)
// ---------------------------------------------------------------------
// Clinical vocabulary. Mirrors the CHECK constraints exactly — widening one
// without the other produces a Postgres error the vet cannot act on.
export const CODIGOS_CHEQUEO = ['P', 'V', 'SE', 'VAS', 'VAP', 'PP', 'RECHE'] as const;
export const ESTRUCTURAS_OVARICAS = [
  'CL1', 'CL2', 'CL3', 'MF', 'QF', 'QL', 'F8mm', 'F10mm', 'F12mm', 'FPre',
] as const;

export type CodigoChequeo = (typeof CODIGOS_CHEQUEO)[number];
export type EstructuraOvarica = (typeof ESTRUCTURAS_OVARICAS)[number];

const estructuraOvarica = z
  .enum(ESTRUCTURAS_OVARICAS)
  .nullable()
  .optional()
  .transform((v) => v ?? null);

// numeric(4,1) in the schema. The cap catches a slipped decimal point (a 12 mm
// follicle typed as 120); the largest structure a vet realistically measures is
// a follicular cyst around 40 mm.
const milimetros = z
  .number()
  .positive('La medida debe ser mayor que 0.')
  .max(100, 'Medida implausible en mm (máx. 100).')
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const chequeoReproductivo = z
  .object({
    arete,
    veterinario: z.string().trim().min(1, 'Indica quién hizo el chequeo.'),
    estadoCodigo: z.enum(CODIGOS_CHEQUEO),
    ovarioDerMm: milimetros,
    ovarioDerEstructura: estructuraOvarica,
    ovarioIzqMm: milimetros,
    ovarioIzqEstructura: estructuraOvarica,
    observaciones: opcional,
    // Treatment applied during the check-up. Stored as an eventos_sanitarios row,
    // never as columns here — see domain/chequeos.ts.
    producto: opcional,
    dosis: opcional,
    via: opcional,
    fecha,
  })
  .refine((c) => !c.producto || !!c.dosis, {
    message: 'Si registras un producto, indica la dosis.',
    path: ['dosis'],
  });

// ---------------------------------------------------------------------
// Protocolos de sincronización  (db/03_hoja_de_vida.sql)
// ---------------------------------------------------------------------
const protocoloId = z.uuid('Id de protocolo inválido.');

export const iniciarProtocolo = z.object({
  arete,
  nombreProtocolo: z.string().trim().min(1, 'Indica el nombre del protocolo.'),
  veterinario: opcional,
  notas: opcional,
  fecha, // fecha_inicio
});

export const aplicacionProtocolo = z.object({
  protocoloId,
  // Day 0 is the start of the protocol. The cap is a typo guard: no synchronization
  // protocol in use runs longer than a couple of months.
  diaNumero: z.number().int('El día debe ser un número entero.').min(0, 'El día no puede ser negativo.').max(60, 'Día fuera de rango (máx. 60).'),
  producto: z.string().trim().min(1, 'Indica el producto aplicado.'),
  dosis: opcional,
  via: opcional,
  aplicadoPor: opcional,
  fecha,
});

export const iaProtocolo = z.object({
  protocoloId,
  inseminador: z.string().trim().min(1, 'Indica quién inseminó.'),
  pajilla: opcional,
  fecha,
});

export const cerrarProtocolo = z.object({
  protocoloId,
  resultado: z.enum(['preno', 'no_preno']),
  fecha, // date of the pregnancy diagnosis
});

export const cancelarProtocolo = z.object({
  protocoloId,
  motivo: opcional,
});

// ---------------------------------------------------------------------
// Control de leche manual  (db/03_hoja_de_vida.sql)
// ---------------------------------------------------------------------
// 0 es una lectura VÁLIDA (la vaca no dio nada ese ordeño), así que min(0) y no
// positive(). El tope es guarda-erratas: una vaca doble propósito que dé más de
// 50 L en un solo ordeño no existe.
//
// Ya no es nullable: una medición que llega al dominio tiene litros. La casilla
// en blanco —que significa "no la ordeñé", no "dio cero"— se descarta antes, en
// la acción del formulario, y nunca se convierte en medición.
const litros = z
  .number()
  .min(0, 'Los litros no pueden ser negativos.')
  .max(50, 'Litros implausibles en un ordeño (máx. 50).');

export const medicionLeche = z.object({
  arete,
  litros,
});

export const controlLeche = z
  .object({
    fecha,
    // Un control es de UN ordeño. Antes era uno por día con columnas AM y PM, y
    // eso hacía imposible registrar la tarde después de la mañana: el segundo
    // guardado chocaba con la unicidad por (finca, fecha). Ver db/05.
    ordeno: z.enum(['manana', 'tarde']),
    // Identidad, no texto libre. La pone el servidor desde la sesión: `createdBy`
    // es la FK autoritativa y `medidoPor` la copia del nombre, que sobrevive si
    // algún día se borra la cuenta. Ninguno de los dos es editable en el formulario.
    createdBy: z.uuid('Sesión inválida.').nullable().optional().transform((v) => v ?? null),
    medidoPor: opcional,
    notas: opcional,
    mediciones: z.array(medicionLeche).min(1, 'Registra al menos una vaca.'),
  })
  // La pantalla lista el hato entero, así que un arete repetido significa que la
  // misma vaca se llenó dos veces. Se corta aquí y no en el índice único, que
  // fallaría a mitad del lote.
  .refine(
    (c) => new Set(c.mediciones.map((m) => m.arete)).size === c.mediciones.length,
    { message: 'Hay aretes repetidos en el control.', path: ['mediciones'] },
  );

// Total de CANTINA de un ordeño: un número, sin desglose por vaca. Es lo que se
// registra casi todos los días; el conteo individual es cada 2-3 semanas y va
// por `controlLeche`, arriba. Los dos pueden existir para el mismo ordeño — ver
// db/07: la cantina es lo que se vendió y el desglose cómo se repartió.
export const produccionDiaria = z.object({
  fecha,
  ordeno: z.enum(['manana', 'tarde']),
  // Tope de absurdo, no de finca: 5000 L en un ordeño son ~330 vacas. No atrapa
  // el cero de más (4280 por 428); eso lo atrapa la pantalla, que muestra al
  // lado el último total registrado.
  litros: z
    .number()
    .min(0, 'Los litros no pueden ser negativos.')
    .max(5000, 'Litros implausibles para un ordeño (máx. 5000).'),
  // Igual que en el control individual: la identidad la pone el servidor desde
  // la sesión, nunca el formulario.
  createdBy: z.uuid('Sesión inválida.').nullable().optional().transform((v) => v ?? null),
  medidoPor: opcional,
  notas: opcional,
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
export type SecadoInput = z.input<typeof secado>;
export type ChequeoReproductivoInput = z.input<typeof chequeoReproductivo>;
export type IniciarProtocoloInput = z.input<typeof iniciarProtocolo>;
export type AplicacionProtocoloInput = z.input<typeof aplicacionProtocolo>;
export type IaProtocoloInput = z.input<typeof iaProtocolo>;
export type CerrarProtocoloInput = z.input<typeof cerrarProtocolo>;
export type CancelarProtocoloInput = z.input<typeof cancelarProtocolo>;
export type ControlLecheInput = z.input<typeof controlLeche>;
export type ProduccionDiariaInput = z.input<typeof produccionDiaria>;
