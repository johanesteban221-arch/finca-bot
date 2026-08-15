// Integration tests for the reproduction flows, driven through `handleMessage`.
// Parto gets the most coverage: it is the only flow that writes to three tables and
// creates a second animal linked by genealogy.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  return { supabase: { from: (name: string) => dbRef.current.from(name) } };
});

import { handleMessage } from '../../src/lib/handler';
import { FINCA_ID } from '../../src/lib/tenant';
import { resetDb } from '../helpers/db';
import type { FakeSupabase } from '../helpers/fake-supabase';
import {
  NOW, TODAY, baseSeed, installFetchStub,
  lastBody, lastOptionIds, sentAny,
  text, button, listPick,
} from '../helpers/harness';

let db: FakeSupabase;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb(baseSeed());
  installFetchStub();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function converse(...messages: Parameters<typeof handleMessage>[0][]) {
  for (const m of messages) await handleMessage(m);
}

const session = () => db.rows('whatsapp_sessions')[0];
const eventos = () => db.insertsInto('eventos_reproductivos');

// =====================================================================
describe('reproduccion.servicio', () => {
  it('records an AI service and marks the cow as servida', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:servicio'),
      text('045'),
      button('servmet:IA'),
      listPick('insem:Juan Pérez'),
      text('ABC-123'),
    );

    expect(lastBody()).toContain('Método: IA');
    expect(lastBody()).toContain('Inseminador: Juan Pérez');
    expect(lastBody()).toContain('Pajilla: ABC-123');

    await handleMessage(button('conf:si'));

    const [animal] = db.insertsInto('animales');
    expect(eventos()).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        animal_id: animal.id,
        tipo: 'servicio',
        fecha: TODAY,
        metodo: 'IA',
        inseminador: 'Juan Pérez',
        pajilla: 'ABC-123',
        notas: null,
      }),
    ]);

    expect(db.updatesTo('animales')).toEqual([
      expect.objectContaining({
        patch: { estado_reproductivo: 'servida' },
        filters: [['id', animal.id]],
      }),
    ]);
    expect(session().current_flow).toBeNull();
  });

  it('records a natural service with the bull in notas and no AI fields', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:servicio'),
      text('045'),
      button('servmet:monta'),
      text('900'),
      button('conf:si'),
    );

    expect(eventos()[0]).toMatchObject({
      metodo: 'monta',
      inseminador: null,
      pajilla: null,
      notas: 'Toro: 900',
    });
  });

  it('treats NINGUNO as "not recorded" for the optional free-text fields', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:servicio'),
      text('045'),
      button('servmet:IA'),
      listPick('insem:Juan Pérez'),
      text('NINGUNO'),
      button('conf:si'),
    );

    expect(eventos()[0].pajilla).toBeNull();
  });

  it('offers the active technicians from the catalog', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:servicio'),
      text('045'),
      button('servmet:IA'),
    );

    expect(lastOptionIds()).toEqual(['insem:Juan Pérez']);
  });

  it('saves nothing when cancelled at the confirmation step', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:servicio'),
      text('045'),
      button('servmet:monta'),
      text('NINGUNO'),
      button('conf:no'),
    );

    expect(eventos()).toHaveLength(0);
    expect(db.updatesTo('animales')).toHaveLength(0);
    expect(lastBody()).toContain('Cancelado');
  });
});

// =====================================================================
describe('reproduccion.dxprenez', () => {
  it.each([
    ['dx:prenada', 'prenada', 'PREÑADA'],
    ['dx:vacia', 'vacia', 'VACÍA'],
  ])('records %s and syncs estado_reproductivo', async (input, resultado, label) => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:dxprenez'),
      text('045'),
      button(input),
    );

    expect(lastBody()).toContain(label);

    await handleMessage(button('conf:si'));

    expect(eventos()).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        tipo: 'diagnostico_prenez',
        fecha: TODAY,
        resultado,
      }),
    ]);
    expect(db.updatesTo('animales')[0].patch).toEqual({ estado_reproductivo: resultado });
  });
});

// =====================================================================
describe('reproduccion.parto', () => {
  const walkToConfirm = (peso: string) =>
    converse(
      listPick('menu:reproduccion'),
      button('repro:parto'),
      text('045'),
      button('sexo:H'),
      text('201'),
      text(peso),
    );

  it('creates the calf, links it to the dam and records the birth weight', async () => {
    await walkToConfirm('32');

    expect(lastBody()).toContain('Madre: 045');
    expect(lastBody()).toContain('Cría: 201 (Hembra)');
    expect(lastBody()).toContain('Peso: 32 kg');

    await handleMessage(button('conf:si'));

    const [madre, cria] = db.insertsInto('animales');
    expect(madre).toMatchObject({ arete: '045' });
    expect(cria).toMatchObject({
      finca_id: FINCA_ID,
      arete: '201',
      sexo: 'H',
      madre_id: madre.id,
      fecha_nacimiento: TODAY,
      peso_nacimiento: 32,
      origen: 'nacido_en_finca',
      categoria: 'ternero',
    });

    // Birth weight is also a weighing, so it shows up in the calf's weight history.
    expect(db.insertsInto('pesajes')).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        animal_id: cria.id,
        fecha: TODAY,
        peso_kg: 32,
        tipo: 'nacimiento',
      }),
    ]);

    expect(eventos()).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        animal_id: madre.id,
        tipo: 'parto',
        fecha: TODAY,
        cria_id: cria.id,
      }),
    ]);

    expect(db.updatesTo('animales')).toEqual([
      expect.objectContaining({
        patch: { estado_reproductivo: 'parida' },
        filters: [['id', madre.id]],
      }),
    ]);
  });

  it('skips the weighing when the weight is NINGUNO', async () => {
    await walkToConfirm('NINGUNO');
    expect(lastBody()).toContain('Peso: —');

    await handleMessage(button('conf:si'));

    expect(db.insertsInto('pesajes')).toHaveLength(0);
    expect(db.insertsInto('animales')[1].peso_nacimiento).toBeNull();
    expect(eventos()).toHaveLength(1); // the parto event is still recorded
  });

  it('accepts a comma as the decimal separator', async () => {
    await walkToConfirm('32,5');
    await handleMessage(button('conf:si'));

    expect(db.insertsInto('pesajes')[0].peso_kg).toBe(32.5);
  });

  it.each(['0', '-5', '150', 'abc'])('rejects the implausible birth weight %s', async (peso) => {
    await walkToConfirm(peso);

    expect(lastBody()).toContain('Peso inválido');
    expect(session().current_step).toBe(4);
    expect(db.inserts).toHaveLength(0);
  });

  it('rejects an invalid calf arete without advancing', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:parto'),
      text('045'),
      button('sexo:H'),
      text('201 bis'),
    );

    expect(lastBody()).toContain('Arete inválido');
    expect(session().current_step).toBe(3);
  });

  it('reuses an already-registered calf arete instead of duplicating it', async () => {
    db.rows('animales').push(
      { id: 'a-045', arete: '045', sexo: 'H', finca_id: FINCA_ID },
      { id: 'a-201', arete: '201', sexo: 'H', finca_id: FINCA_ID },
    );

    await walkToConfirm('30');
    await handleMessage(button('conf:si'));

    expect(db.insertsInto('animales')).toHaveLength(0);
    expect(eventos()[0]).toMatchObject({ animal_id: 'a-045', cria_id: 'a-201' });
    expect(db.insertsInto('pesajes')[0].animal_id).toBe('a-201');
  });

  it('records a male calf with the right label', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:parto'),
      text('045'),
      button('sexo:M'),
      text('202'),
      text('NINGUNO'),
    );

    expect(lastBody()).toContain('Cría: 202 (Macho)');

    await handleMessage(button('conf:si'));
    expect(db.insertsInto('animales')[1].sexo).toBe('M');
  });

  it('saves nothing when cancelled at the confirmation step', async () => {
    await walkToConfirm('32');
    await handleMessage(button('conf:no'));

    expect(db.inserts).toHaveLength(0);
    expect(sentAny('Parto guardado')).toBe(false);
    expect(session().current_flow).toBeNull();
  });
});

// =====================================================================
describe('reproduccion.secado', () => {
  const sanitarios = () => db.insertsInto('eventos_sanitarios');

  const walkToConfirm = (...extra: Parameters<typeof handleMessage>[0][]) =>
    converse(
      listPick('menu:reproduccion'),
      listPick('repro:secado'),
      text('045'),
      ...extra,
    );

  it('offers secado in the reproduction sub-menu', async () => {
    await handleMessage(listPick('menu:reproduccion'));

    expect(lastOptionIds()).toEqual([
      'repro:servicio', 'repro:dxprenez', 'repro:parto', 'repro:secado',
    ]);
  });

  it('routes the intramammary through eventos_sanitarios with its withdrawal date', async () => {
    await walkToConfirm(
      button('sec:si'),
      listPick('secmed:Oxitetraciclina'),
      button('secdosis:4 cánulas'),
    );

    expect(lastBody()).toContain('Producto: Oxitetraciclina');
    expect(lastBody()).toContain('Dosis: 4 cánulas');

    await handleMessage(button('conf:si'));

    const [animal] = db.insertsInto('animales');
    // El producto NO vive en columnas del evento reproductivo: va como fila de
    // eventos_sanitarios, que es donde se deriva retiro_leche_hasta.
    expect(sanitarios()).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        animal_id: animal.id,
        tipo: 'tratamiento',
        fecha: TODAY,
        producto: 'Oxitetraciclina',
        dosis: '4 cánulas',
        via: 'intramamaria',
        diagnostico: 'Secado',
        retiro_leche_hasta: '2026-08-07', // 72 h de catálogo → 3 días
      }),
    ]);

    expect(eventos()).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        animal_id: animal.id,
        tipo: 'secado',
        fecha: TODAY,
        evento_sanitario_id: sanitarios()[0].id,
      }),
    ]);

    expect(db.updatesTo('animales')).toEqual([
      expect.objectContaining({
        patch: { estado_reproductivo: 'seca' },
        filters: [['id', animal.id]],
      }),
    ]);
    expect(lastBody()).toContain('Retiro de leche hasta: 2026-08-07');
  });

  it('dries a cow off with no product at all', async () => {
    await walkToConfirm(button('sec:no'));

    expect(lastBody()).toContain('Sin producto (secado seco)');

    await handleMessage(button('conf:si'));

    expect(sanitarios()).toHaveLength(0);
    expect(eventos()[0]).toMatchObject({ tipo: 'secado', evento_sanitario_id: null });
    expect(db.updatesTo('animales')[0].patch).toEqual({ estado_reproductivo: 'seca' });
    expect(lastBody()).not.toContain('Retiro de leche');
  });

  it('derives the expected calving date from the last service, not from today', async () => {
    db.rows('animales').push({ id: 'a-045', arete: '045', sexo: 'H', finca_id: FINCA_ID });
    db.rows('eventos_reproductivos').push({
      id: 'e-1', animal_id: 'a-045', tipo: 'servicio', fecha: '2026-01-10', finca_id: FINCA_ID,
    });

    await walkToConfirm(button('sec:no'));
    await handleMessage(button('conf:si'));

    // 2026-01-10 + 283 días de gestación.
    expect(eventos()[0].fecha_probable_parto).toBe('2026-10-20');
    expect(lastBody()).toContain('Parto probable: 2026-10-20');
  });

  it('accepts a free-text dose when the vaquero picks "Otra"', async () => {
    await walkToConfirm(
      button('sec:si'),
      listPick('secmed:Penicilina'),
      button('secdosis:otra'),
      text('1 cánula por cuarto'),
    );

    expect(lastBody()).toContain('Dosis: 1 cánula por cuarto');

    await handleMessage(button('conf:si'));

    expect(sanitarios()[0]).toMatchObject({
      producto: 'Penicilina',
      dosis: '1 cánula por cuarto',
      retiro_leche_hasta: null, // el catálogo la trae en 0 horas
    });
  });

  it('saves nothing when cancelled at the confirmation step', async () => {
    await walkToConfirm(
      button('sec:si'),
      listPick('secmed:Oxitetraciclina'),
      button('secdosis:2 cánulas'),
      button('conf:no'),
    );

    expect(db.inserts).toHaveLength(0);
    expect(db.updatesTo('animales')).toHaveLength(0);
    expect(lastBody()).toContain('Cancelado');
    expect(session().current_flow).toBeNull();
  });

  it('stamps finca_id on both tables the dry-off writes', async () => {
    await walkToConfirm(
      button('sec:si'),
      listPick('secmed:Oxitetraciclina'),
      button('secdosis:4 cánulas'),
      button('conf:si'),
    );

    const tables = db.inserts.map((i) => i.table);
    expect(tables).toEqual(
      expect.arrayContaining(['eventos_sanitarios', 'eventos_reproductivos']),
    );
    for (const { table, rows } of db.inserts) {
      for (const row of rows) {
        expect(row.finca_id, `${table} row is missing finca_id`).toBe(FINCA_ID);
      }
    }
  });
});

// =====================================================================
describe('multi-tenant guard', () => {
  it('stamps finca_id on every row the parto flow writes across all three tables', async () => {
    await converse(
      listPick('menu:reproduccion'),
      button('repro:parto'),
      text('045'),
      button('sexo:H'),
      text('201'),
      text('32'),
      button('conf:si'),
    );

    const tables = db.inserts.map((i) => i.table);
    expect(tables).toEqual(
      expect.arrayContaining(['animales', 'pesajes', 'eventos_reproductivos']),
    );
    for (const { table, rows } of db.inserts) {
      for (const row of rows) {
        expect(row.finca_id, `${table} row is missing finca_id`).toBe(FINCA_ID);
      }
    }
  });
});
