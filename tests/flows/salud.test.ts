// Integration tests for the health flows, driven through `handleMessage` — the same
// entry point the Meta webhook calls. Only Supabase and the outgoing fetch are faked,
// so routing, session persistence and step logic are all exercised for real.

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
  PHONE, NOW, TODAY, baseSeed, installFetchStub,
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

/** Feeds a sequence of incoming messages through the bot, in order. */
async function converse(...messages: Parameters<typeof handleMessage>[0][]) {
  for (const m of messages) await handleMessage(m);
}

const session = () => db.rows('whatsapp_sessions')[0];

/** Seeds an active session so a test can start mid-flow. */
function seedSession(flow: string, step: number, temp: Record<string, any> = {}) {
  db.rows('whatsapp_sessions').push({
    telefono: PHONE,
    current_flow: flow,
    current_step: step,
    temp_data: temp,
    updated_at: NOW.toISOString(),
  });
}

// =====================================================================
describe('auth', () => {
  it('rejects a number that is not registered and writes nothing', async () => {
    await handleMessage(text('hola', '573009998877'));

    expect(lastBody()).toContain('no está registrado');
    expect(db.inserts).toHaveLength(0);
    expect(db.rows('whatsapp_sessions')).toHaveLength(0);
  });

  it('rejects a registered but inactive number', async () => {
    db.rows('whatsapp_users').push({ telefono: '573004445566', nombre: 'Ex', activo: false });

    await handleMessage(text('hola', '573004445566'));

    expect(lastBody()).toContain('no está registrado');
  });
});

// =====================================================================
describe('salud.vacunacion', () => {
  it('records a vaccination end to end and computes the next dose date', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:vacunacion'),
      text('045'),
      listPick('vac:Aftosa'),
      button('dosis:2 ml'),
    );

    // Confirmation summary shows everything the user is about to save.
    expect(lastBody()).toContain('Arete: 045');
    expect(lastBody()).toContain('Vacuna: Aftosa');
    expect(lastBody()).toContain('Dosis: 2 ml');
    expect(db.insertsInto('eventos_sanitarios')).toHaveLength(0); // nothing saved yet

    await handleMessage(button('conf:si'));

    const [animal] = db.insertsInto('animales');
    expect(animal).toMatchObject({ arete: '045', finca_id: FINCA_ID });

    expect(db.insertsInto('eventos_sanitarios')).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        animal_id: animal.id,
        tipo: 'vacuna',
        fecha: TODAY,
        producto: 'Aftosa',
        dosis: '2 ml',
        proxima_fecha: '2027-01-31', // TODAY + retiro_default_dias (180)
      }),
    ]);

    expect(lastBody()).toContain('Vacunación guardada');
    expect(lastBody()).toContain('Próxima: 2027-01-31');
    expect(session().current_flow).toBeNull();
  });

  it('leaves proxima_fecha null when the vaccine has no default interval', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:vacunacion'),
      text('045'),
      listPick('vac:Brucelosis'),
      button('dosis:5 ml'),
      button('conf:si'),
    );

    expect(db.insertsInto('eventos_sanitarios')[0].proxima_fecha).toBeNull();
    expect(sentAny('Próxima:')).toBe(false);
  });

  it('offers exactly the active catalog vaccines as list options', async () => {
    await converse(listPick('menu:salud'), button('salud:vacunacion'), text('045'));

    expect(lastOptionIds()).toEqual(['vac:Aftosa', 'vac:Brucelosis']);
  });

  it('reuses an existing animal instead of creating a duplicate', async () => {
    db.rows('animales').push({ id: 'a-045', arete: '045', sexo: 'H', finca_id: FINCA_ID });

    await converse(
      listPick('menu:salud'),
      button('salud:vacunacion'),
      text('045'),
      listPick('vac:Aftosa'),
      button('dosis:2 ml'),
      button('conf:si'),
    );

    expect(db.insertsInto('animales')).toHaveLength(0);
    expect(db.insertsInto('eventos_sanitarios')[0].animal_id).toBe('a-045');
  });

  it('accepts a free-text dose behind "Otra dosis"', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:vacunacion'),
      text('045'),
      listPick('vac:Aftosa'),
      button('dosis:otra'),
    );
    expect(lastBody()).toContain('Escribe la dosis');

    await converse(text('3.5 ml'), button('conf:si'));

    expect(db.insertsInto('eventos_sanitarios')[0].dosis).toBe('3.5 ml');
  });

  it('rejects an invalid arete without advancing the step', async () => {
    await converse(listPick('menu:salud'), button('salud:vacunacion'), text('045 A'));

    expect(lastBody()).toContain('Arete inválido');
    expect(session().current_step).toBe(1);
    expect(db.inserts).toHaveLength(0);
  });

  it('saves nothing when the user cancels at the confirmation step', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:vacunacion'),
      text('045'),
      listPick('vac:Aftosa'),
      button('dosis:2 ml'),
      button('conf:no'),
    );

    expect(db.insertsInto('eventos_sanitarios')).toHaveLength(0);
    expect(lastBody()).toContain('Cancelado');
    expect(session().current_flow).toBeNull();
  });
});

// =====================================================================
describe('salud.tratamiento', () => {
  it('records a treatment with the milk-withdrawal date from the catalog', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:tratamiento'),
      text('077'),
      listPick('diag:Mastitis'),
      listPick('med:Oxitetraciclina'),
      button('tdosis:10 ml'),
      button('via:IM'),
    );

    expect(lastBody()).toContain('Diagnóstico: Mastitis');
    expect(lastBody()).toContain('Vía: IM');

    await handleMessage(button('conf:si'));

    expect(db.insertsInto('eventos_sanitarios')).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        tipo: 'tratamiento',
        fecha: TODAY,
        diagnostico: 'Mastitis',
        producto: 'Oxitetraciclina',
        dosis: '10 ml',
        via: 'IM',
        retiro_leche_hasta: '2026-08-07', // ceil(72h / 24) = 3 days
      }),
    ]);
    expect(lastBody()).toContain('Retiro de leche hasta: 2026-08-07');
  });

  it('leaves retiro_leche_hasta null for a medicine with no withdrawal period', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:tratamiento'),
      text('077'),
      listPick('diag:Cojera'),
      listPick('med:Penicilina'),
      button('tdosis:5 ml'),
      button('via:Oral'),
      button('conf:si'),
    );

    expect(db.insertsInto('eventos_sanitarios')[0].retiro_leche_hasta).toBeNull();
    expect(sentAny('Retiro de leche')).toBe(false);
  });
});

// =====================================================================
describe('salud.desparasitacion', () => {
  it('records a deworming and schedules the next one 90 days out', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:desparasitacion'),
      text('012'),
      button('desp:Ivermectina'),
      button('dosis:10 ml'),
      button('conf:si'),
    );

    expect(db.insertsInto('eventos_sanitarios')).toEqual([
      expect.objectContaining({
        finca_id: FINCA_ID,
        tipo: 'desparasitacion',
        fecha: TODAY,
        producto: 'Ivermectina',
        dosis: '10 ml',
        proxima_fecha: '2026-11-02',      // TODAY + 90
        retiro_leche_hasta: '2026-08-06', // ceil(48h / 24) = 2 days
      }),
    ]);
    expect(lastBody()).toContain('Próxima sugerida: 2026-11-02');
  });

  it('accepts a free-text product behind "Otro producto"', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:desparasitacion'),
      text('012'),
      button('desp:otra'),
      text('Fenbendazol'),
      button('dosis:5 ml'),
      button('conf:si'),
    );

    const evento = db.insertsInto('eventos_sanitarios')[0];
    expect(evento.producto).toBe('Fenbendazol');
    expect(evento.retiro_leche_hasta).toBeNull(); // not in cat_medicamentos
  });
});

// =====================================================================
describe('navigation safety nets', () => {
  it('resets to the main menu when the user types "menú" mid-flow', async () => {
    await converse(listPick('menu:salud'), button('salud:vacunacion'), text('045'), text('menú'));

    expect(session().current_flow).toBeNull();
    expect(lastOptionIds()).toContain('menu:salud');
    expect(db.inserts).toHaveLength(0);
  });

  it('recovers from a step number no branch handles', async () => {
    seedSession('salud.vacunacion', 99, { arete: '045' });

    await handleMessage(button('conf:si'));

    expect(lastBody()).toContain('Se perdió el hilo');
    expect(session().current_flow).toBeNull();
    expect(db.inserts).toHaveLength(0);
  });

  it('clears a flow id that no longer exists after a deploy', async () => {
    seedSession('salud.flujo_eliminado', 3);

    await handleMessage(button('conf:si'));

    expect(session().current_flow).toBeNull();
    expect(lastOptionIds()).toContain('menu:salud');
  });

  it('ignores an unrecognised menu key without starting a flow', async () => {
    await handleMessage(listPick('menu:no_existe'));

    expect(lastBody()).toContain('Opción no reconocida');
    expect(session().current_flow).toBeNull();
  });
});

// =====================================================================
describe('multi-tenant guard', () => {
  it('stamps finca_id on every row the health flows write', async () => {
    await converse(
      listPick('menu:salud'),
      button('salud:vacunacion'),
      text('045'),
      listPick('vac:Aftosa'),
      button('dosis:2 ml'),
      button('conf:si'),
    );

    expect(db.inserts.length).toBeGreaterThan(0);
    for (const { table, rows } of db.inserts) {
      for (const row of rows) {
        expect(row.finca_id, `${table} row is missing finca_id`).toBe(FINCA_ID);
      }
    }
  });
});
