// Tests for the "hoja de vida" domain layer (db/03_hoja_de_vida.sql):
// secado, chequeos reproductivos, protocolos de sincronización y control de
// leche manual.
//
// El hilo común de casi todas estas pruebas es que los datos NO se quedan en la
// tabla nueva: el producto aplicado tiene que aterrizar en eventos_sanitarios
// (para que se calcule el retiro de leche) y la IA de un protocolo en
// eventos_reproductivos (para que la vean las alertas y los KPIs). Si alguien
// "simplifica" alguno de esos caminos, estas pruebas son las que lo detectan.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

import { registrarSecado } from '../../src/lib/domain/reproduccion';
import { registrarChequeo, ESTADO_CANONICO } from '../../src/lib/domain/chequeos';
import {
  iniciarProtocolo, registrarAplicacion, registrarIaProtocolo,
  cerrarProtocolo, cancelarProtocolo,
} from '../../src/lib/domain/protocolos';
import { registrarControlLeche } from '../../src/lib/domain/leche';
import { getAnalytics } from '../../src/lib/analytics';
import { FINCA_ID } from '../../src/lib/tenant';
import { resetDb } from '../helpers/db';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW, TODAY, baseSeed } from '../helpers/harness';

let db: FakeSupabase;

/** Real-shaped animal row. The fake does not simulate defaults, so finca_id is explicit. */
const animal = (id: string, arete: string, extra: Record<string, any> = {}) => ({
  id, arete, finca_id: FINCA_ID, sexo: 'H', estado: 'activo',
  estado_reproductivo: 'vacia', categoria: 'vaca', ...extra,
});

const SECANTE = 'Secante intramamario (larga accion)';

function seed() {
  return baseSeed({
    animales: [
      animal('a-045', '045'),
      animal('a-046', '046'),
      animal('a-047', '047'),
    ],
    cat_medicamentos: [
      { nombre: 'Oxitetraciclina', activo: true, orden: 1, retiro_horas_default: 72 },
      { nombre: 'Prostaglandina (PGF2a)', activo: true, orden: 2, retiro_horas_default: 0 },
      // 1440 h = 60 días: el orden de magnitud real de un secante de larga acción.
      { nombre: SECANTE, activo: true, orden: 3, retiro_horas_default: 1440 },
    ],
    produccion_leche: [],
    movimientos: [],
    controles_leche: [],
    chequeos_reproductivos: [],
    protocolos_sincronizacion: [],
    protocolo_aplicaciones: [],
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb(seed());
});

afterEach(() => {
  vi.useRealTimers();
});

// =====================================================================
describe('secado', () => {
  const servida = () => {
    db.rows('eventos_reproductivos').push({
      id: 'e-1', animal_id: 'a-045', tipo: 'servicio', fecha: '2026-01-15', finca_id: FINCA_ID,
    });
  };

  it('deriva la fecha probable de parto del último servicio + gestación', async () => {
    servida();

    const r = await registrarSecado({ arete: '045' });

    expect(r.fechaProbableParto).toBe('2026-10-25'); // 2026-01-15 + 283 días
    expect(db.insertsInto('eventos_reproductivos')[0]).toMatchObject({
      tipo: 'secado', fecha: TODAY, fecha_probable_parto: '2026-10-25', finca_id: FINCA_ID,
    });
  });

  it('usa el último servicio, no el primero', async () => {
    db.rows('eventos_reproductivos').push(
      { id: 'e-1', animal_id: 'a-045', tipo: 'servicio', fecha: '2025-11-02', finca_id: FINCA_ID },
      { id: 'e-2', animal_id: 'a-045', tipo: 'servicio', fecha: '2026-01-15', finca_id: FINCA_ID },
    );

    const r = await registrarSecado({ arete: '045' });

    expect(r.fechaProbableParto).toBe('2026-10-25');
  });

  it('deja la fecha probable en null cuando la vaca nunca fue servida', async () => {
    const r = await registrarSecado({ arete: '045' });

    expect(r.fechaProbableParto).toBeNull();
  });

  it('respeta una fecha probable de parto explícita, aunque esté en el futuro', async () => {
    servida();

    const r = await registrarSecado({ arete: '045', fechaProbableParto: '2026-11-30' });

    expect(r.fechaProbableParto).toBe('2026-11-30');
  });

  it('mueve el estado reproductivo a seca', async () => {
    await registrarSecado({ arete: '045' });

    expect(db.updatesTo('animales')[0].patch).toEqual({ estado_reproductivo: 'seca' });
  });

  it('manda el intramamario a eventos_sanitarios y calcula el retiro de leche', async () => {
    const r = await registrarSecado({ arete: '045', producto: SECANTE, dosis: '1 jeringa/cuarto' });

    // 1440 h = 60 días desde la fecha del secado.
    expect(r.retiroLecheHasta).toBe('2026-10-03');

    const sanitario = db.insertsInto('eventos_sanitarios')[0];
    expect(sanitario).toMatchObject({
      tipo: 'tratamiento', producto: SECANTE, via: 'intramamaria',
      diagnostico: 'Secado', retiro_leche_hasta: '2026-10-03', finca_id: FINCA_ID,
    });
    // Y el evento reproductivo queda enlazado al sanitario.
    expect(db.insertsInto('eventos_reproductivos')[0].evento_sanitario_id).toBe(sanitario.id);
  });

  it('no escribe nada en sanidad cuando el secado no lleva producto', async () => {
    const r = await registrarSecado({ arete: '045' });

    expect(db.insertsInto('eventos_sanitarios')).toHaveLength(0);
    expect(r.eventoSanitarioId).toBeNull();
    expect(r.retiroLecheHasta).toBeNull();
  });

  it('rechaza un producto sin dosis', async () => {
    await expect(registrarSecado({ arete: '045', producto: SECANTE }))
      .rejects.toThrow(/dosis/);
    expect(db.inserts).toHaveLength(0);
  });

  it('calcula el retiro desde la fecha del secado, no desde hoy', async () => {
    const r = await registrarSecado({
      arete: '045', producto: SECANTE, dosis: '1 jeringa/cuarto', fecha: '2026-07-01',
    });

    expect(r.retiroLecheHasta).toBe('2026-08-30'); // 2026-07-01 + 60 días
  });
});

// =====================================================================
// La regresión que introduce el secado: estado_reproductivo es una sola columna,
// así que secar una vaca preñada la saca de 'prenada'. Todo lo que busca partos
// próximos tiene que aceptar 'seca' o la vaca desaparece del aviso justo en los
// últimos 60 días de gestación.
describe('una vaca secada sigue contando como preñada', () => {
  it('sigue apareciendo en próximos partos después del secado', async () => {
    db.rows('animales')[0].estado_reproductivo = 'prenada';
    db.rows('eventos_reproductivos').push({
      id: 'e-1', animal_id: 'a-045', tipo: 'servicio', fecha: '2026-01-15', finca_id: FINCA_ID,
    });

    const antes = await getAnalytics();
    expect(antes.reproductivo.proximosPartos.map((p) => p.arete)).toContain('045');

    await registrarSecado({ arete: '045' });

    const despues = await getAnalytics();
    expect(despues.reproductivo.proximosPartos.map((p) => p.arete)).toContain('045');
    expect(despues.reproductivo.proximosPartos[0].fechaEstimada).toBe('2026-10-25');
  });
});

// =====================================================================
describe('chequeo reproductivo', () => {
  const base = { arete: '045', veterinario: 'Juan Pérez', estadoCodigo: 'P' as const };

  it('falla si el animal no existe y no escribe nada', async () => {
    await expect(registrarChequeo({ ...base, arete: '999' }))
      .rejects.toThrow(/No existe ningún animal con arete 999/);
    expect(db.inserts).toHaveLength(0);
  });

  it('guarda estructuras y medidas de ambos ovarios', async () => {
    await registrarChequeo({
      ...base,
      estadoCodigo: 'VAP',
      ovarioDerMm: 12.5, ovarioDerEstructura: 'CL2',
      ovarioIzqMm: 8, ovarioIzqEstructura: 'F8mm',
      observaciones: 'Útero sin tono',
    });

    expect(db.insertsInto('chequeos_reproductivos')[0]).toMatchObject({
      animal_id: 'a-045', fecha: TODAY, veterinario: 'Juan Pérez',
      estado_codigo: 'VAP',
      ovario_der_mm: 12.5, ovario_der_estruct: 'CL2',
      ovario_izq_mm: 8, ovario_izq_estruct: 'F8mm',
      observaciones: 'Útero sin tono', finca_id: FINCA_ID,
    });
  });

  it.each([
    ['P', 'prenada'],
    ['V', 'vacia'],
    ['SE', 'servida'],
    ['VAS', 'vacia'],
    ['VAP', 'vacia'],
    ['PP', 'parida'],
  ] as const)('el código %s deja el estado reproductivo en %s', async (codigo, esperado) => {
    await registrarChequeo({ ...base, estadoCodigo: codigo });

    expect(db.updatesTo('animales')[0].patch).toEqual({ estado_reproductivo: esperado });
  });

  // RECHE = rechequeo: el vet no pudo definir y pidió volver a ecografiar. No es
  // un estado, así que la vaca conserva el que tenía; poner uno sería inventar un
  // hallazgo que el veterinario explícitamente no hizo. Lo que sí produce es una
  // tarea pendiente — ver getRechequeosPendientes en tests/lib/alerts.test.ts.
  it('RECHE registra el código pero deja intacto el estado del animal', async () => {
    db.rows('animales')[0].estado_reproductivo = 'servida';

    const r = await registrarChequeo({ ...base, estadoCodigo: 'RECHE' });

    expect(db.insertsInto('chequeos_reproductivos')[0].estado_codigo).toBe('RECHE');
    expect(r.estadoReproductivo).toBeNull();
    expect(db.updatesTo('animales')).toHaveLength(0);
    expect(db.rows('animales')[0].estado_reproductivo).toBe('servida');
  });

  it('el mapeo cubre exactamente los códigos del CHECK de la tabla', () => {
    expect(Object.keys(ESTADO_CANONICO).sort())
      .toEqual(['P', 'PP', 'RECHE', 'SE', 'V', 'VAP', 'VAS']);
  });

  it('el tratamiento del chequeo va a eventos_sanitarios con su retiro', async () => {
    const r = await registrarChequeo({
      ...base, producto: 'Oxitetraciclina', dosis: '10 ml', via: 'IM',
    });

    expect(r.retiroLecheHasta).toBe('2026-08-07'); // +72 h
    const sanitario = db.insertsInto('eventos_sanitarios')[0];
    expect(sanitario).toMatchObject({
      producto: 'Oxitetraciclina', dosis: '10 ml', via: 'IM',
      diagnostico: 'Chequeo reproductivo', responsable: 'Juan Pérez',
      retiro_leche_hasta: '2026-08-07',
    });
    expect(db.insertsInto('chequeos_reproductivos')[0].evento_sanitario_id).toBe(sanitario.id);
  });

  it.each([
    ['código clínico inexistente', { estadoCodigo: 'XX' as any }],
    ['estructura ovárica inexistente', { ovarioDerEstructura: 'CL9' as any }],
    ['medida implausible', { ovarioDerMm: 500 }],
    ['medida negativa', { ovarioIzqMm: -3 }],
    ['sin veterinario', { veterinario: '' }],
    ['producto sin dosis', { producto: 'Oxitetraciclina' }],
  ])('rechaza %s sin escribir nada', async (_caso, patch) => {
    await expect(registrarChequeo({ ...base, ...patch } as any)).rejects.toThrow();
    expect(db.inserts).toHaveLength(0);
  });
});

// =====================================================================
describe('protocolo de sincronización', () => {
  const iniciar = () => iniciarProtocolo({ arete: '045', nombreProtocolo: 'Ovsynch', veterinario: 'Juan Pérez' });

  it('falla si el animal no existe', async () => {
    await expect(iniciarProtocolo({ arete: '999', nombreProtocolo: 'Ovsynch' }))
      .rejects.toThrow(/No existe ningún animal/);
    expect(db.inserts).toHaveLength(0);
  });

  it('no permite dos protocolos en curso sobre el mismo animal', async () => {
    await iniciar();

    await expect(iniciar()).rejects.toThrow(/ya tiene un protocolo en curso \(Ovsynch\)/);
  });

  it('cancelar libera al animal para un protocolo nuevo', async () => {
    const { protocoloId } = await iniciar();

    await cancelarProtocolo({ protocoloId, motivo: 'Se cayó el CIDR' });
    expect(db.updatesTo('protocolos_sincronizacion').at(-1)!.patch)
      .toMatchObject({ estado: 'cancelado', notas: 'Se cayó el CIDR' });

    await expect(iniciar()).resolves.toBeTruthy();
  });

  it('cada aplicación crea su evento sanitario y desnormaliza el animal', async () => {
    const { protocoloId } = await iniciar();

    const r = await registrarAplicacion({
      protocoloId, diaNumero: 7, producto: 'Prostaglandina (PGF2a)',
      dosis: '2 ml', via: 'IM', aplicadoPor: 'Johan',
    });

    expect(db.insertsInto('protocolo_aplicaciones')[0]).toMatchObject({
      protocolo_id: protocoloId, animal_id: 'a-045', dia_numero: 7,
      producto: 'Prostaglandina (PGF2a)', dosis: '2 ml', aplicado_por: 'Johan',
      evento_sanitario_id: r.eventoSanitarioId, finca_id: FINCA_ID,
    });
    expect(db.insertsInto('eventos_sanitarios')[0]).toMatchObject({
      animal_id: 'a-045', producto: 'Prostaglandina (PGF2a)',
      diagnostico: 'Protocolo de sincronización',
    });
  });

  it('rechaza una aplicación anterior al inicio del protocolo', async () => {
    const { protocoloId } = await iniciar();

    await expect(registrarAplicacion({
      protocoloId, diaNumero: 0, producto: 'Prostaglandina (PGF2a)', fecha: '2026-07-01',
    })).rejects.toThrow(/anterior al inicio/);
  });

  it('la IA del protocolo crea un servicio real y mueve el estado a servida', async () => {
    const { protocoloId } = await iniciar();

    const r = await registrarIaProtocolo({ protocoloId, inseminador: 'Juan Pérez', pajilla: 'GYR-882' });

    // Esto es lo que hace que la vaca la vean vw_alertas y los KPIs de repro.
    expect(db.insertsInto('eventos_reproductivos')[0]).toMatchObject({
      animal_id: 'a-045', tipo: 'servicio', metodo: 'IA',
      inseminador: 'Juan Pérez', pajilla: 'GYR-882', finca_id: FINCA_ID,
    });
    expect(db.updatesTo('animales')[0].patch).toEqual({ estado_reproductivo: 'servida' });

    // Y el protocolo queda apuntando a ese evento, no guardando una copia.
    expect(db.updatesTo('protocolos_sincronizacion')[0].patch).toEqual({
      fecha_ia: TODAY, servicio_evento_id: r.servicioEventoId,
    });
  });

  it('no deja cerrar un protocolo sin IA registrada', async () => {
    const { protocoloId } = await iniciar();

    await expect(cerrarProtocolo({ protocoloId, resultado: 'preno' }))
      .rejects.toThrow(/sin IA registrada/);
  });

  it('cerrar crea el diagnóstico de preñez y finaliza el protocolo', async () => {
    const { protocoloId } = await iniciar();
    await registrarIaProtocolo({ protocoloId, inseminador: 'Juan Pérez' });

    const r = await cerrarProtocolo({ protocoloId, resultado: 'preno' });

    expect(db.insertsInto('eventos_reproductivos').at(-1)).toMatchObject({
      tipo: 'diagnostico_prenez', resultado: 'prenada',
    });
    expect(db.updatesTo('animales').at(-1)!.patch).toEqual({ estado_reproductivo: 'prenada' });
    expect(db.updatesTo('protocolos_sincronizacion').at(-1)!.patch).toEqual({
      estado: 'finalizado', resultado: 'preno', dx_evento_id: r.dxEventoId,
    });
  });

  it('no_preno deja la vaca vacía', async () => {
    const { protocoloId } = await iniciar();
    await registrarIaProtocolo({ protocoloId, inseminador: 'Juan Pérez' });

    const r = await cerrarProtocolo({ protocoloId, resultado: 'no_preno' });

    expect(r.estadoReproductivo).toBe('vacia');
    expect(db.updatesTo('animales').at(-1)!.patch).toEqual({ estado_reproductivo: 'vacia' });
  });

  it('un protocolo finalizado no admite aplicaciones nuevas', async () => {
    const { protocoloId } = await iniciar();
    await registrarIaProtocolo({ protocoloId, inseminador: 'Juan Pérez' });
    await cerrarProtocolo({ protocoloId, resultado: 'preno' });

    await expect(registrarAplicacion({ protocoloId, diaNumero: 9, producto: 'Prostaglandina (PGF2a)' }))
      .rejects.toThrow(/finalizado/);
  });
});

// =====================================================================
describe('control de leche manual', () => {
  const control = (mediciones: any[], extra: Record<string, any> = {}) =>
    registrarControlLeche({ medidoPor: 'Johan', mediciones, ...extra });

  it('escribe una fila por ordeño y ninguna con ordeno=total', async () => {
    const r = await control([
      { arete: '045', litrosAm: 6.5, litrosPm: 4 },
      { arete: '046', litrosAm: 5, litrosPm: 3.5 },
    ]);

    const filas = db.insertsInto('produccion_leche');
    expect(filas).toHaveLength(4);
    expect(filas.map((f) => f.ordeno).sort()).toEqual(['manana', 'manana', 'tarde', 'tarde']);
    // Un tercer registro 'total' duplicaría la producción del hato en analytics.ts.
    expect(filas.some((f) => f.ordeno === 'total')).toBe(false);

    expect(r).toMatchObject({ vacas: 2, mediciones: 4, totalLitros: 19, fecha: TODAY });
  });

  it('marca el origen y enlaza cada fila con la cabecera', async () => {
    await control([{ arete: '045', litrosAm: 6 }]);

    const cabecera = db.insertsInto('controles_leche')[0];
    expect(cabecera).toMatchObject({ fecha: TODAY, medido_por: 'Johan', finca_id: FINCA_ID });
    expect(db.insertsInto('produccion_leche')[0]).toMatchObject({
      animal_id: 'a-045', control_id: cabecera.id, fuente: 'control', ordeno: 'manana', litros: 6,
    });
  });

  it('acepta un solo ordeño y omite el que no se midió', async () => {
    await control([{ arete: '045', litrosPm: 4.5 }]);

    const filas = db.insertsInto('produccion_leche');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ ordeno: 'tarde', litros: 4.5 });
  });

  it('acepta 0 litros como medición válida', async () => {
    await control([{ arete: '045', litrosAm: 0, litrosPm: 0 }]);

    expect(db.insertsInto('produccion_leche')).toHaveLength(2);
  });

  it('rechaza el control completo si algún arete no existe, sin escribir nada', async () => {
    await expect(control([
      { arete: '045', litrosAm: 6 },
      { arete: '888', litrosAm: 5 },
      { arete: '999', litrosAm: 4 },
    ])).rejects.toThrow(/no existen en el hato: 888, 999/);

    expect(db.inserts).toHaveLength(0);
  });

  it.each([
    ['aretes repetidos', [{ arete: '045', litrosAm: 6 }, { arete: '045', litrosPm: 4 }], /repetidos/],
    ['una vaca sin ningún ordeño', [{ arete: '045' }], /al menos un ordeño/],
    ['lista vacía', [], /al menos una vaca/],
    ['litros implausibles', [{ arete: '045', litrosAm: 300 }], /implausibles/],
    ['litros negativos', [{ arete: '045', litrosAm: -2 }], /negativos/],
  ])('rechaza %s', async (_caso, mediciones, mensaje) => {
    await expect(control(mediciones)).rejects.toThrow(mensaje);
    expect(db.inserts).toHaveLength(0);
  });

  it('borra la cabecera si falla el detalle, para que el control se pueda reintentar', async () => {
    db.failOn('produccion_leche', 'timeout');

    await expect(control([{ arete: '045', litrosAm: 6 }])).rejects.toThrow(/timeout/);

    // Sin este borrado compensatorio, uq_control_finca_fecha rechazaría todo
    // reintento de ese día y el control quedaría imposible de capturar.
    expect(db.deletesFrom('controles_leche')).toHaveLength(1);
    expect(db.rows('controles_leche')).toHaveLength(0);
  });
});

// =====================================================================
describe('multi-tenant', () => {
  it('estampa finca_id en todo lo que escriben las funciones nuevas', async () => {
    await registrarSecado({ arete: '045', producto: SECANTE, dosis: '1 jeringa/cuarto' });
    await registrarChequeo({
      arete: '046', veterinario: 'Juan Pérez', estadoCodigo: 'VAS',
      producto: 'Oxitetraciclina', dosis: '10 ml', via: 'IM',
    });
    const { protocoloId } = await iniciarProtocolo({ arete: '047', nombreProtocolo: 'Ovsynch' });
    await registrarAplicacion({ protocoloId, diaNumero: 0, producto: 'Prostaglandina (PGF2a)', dosis: '2 ml' });
    await registrarIaProtocolo({ protocoloId, inseminador: 'Juan Pérez' });
    await cerrarProtocolo({ protocoloId, resultado: 'preno' });
    await registrarControlLeche({ mediciones: [{ arete: '045', litrosAm: 6, litrosPm: 4 }] });

    expect(db.inserts.length).toBeGreaterThan(10);
    for (const { table, rows } of db.inserts) {
      for (const row of rows) {
        expect(row.finca_id, `${table} sin finca_id`).toBe(FINCA_ID);
      }
    }
  });
});
