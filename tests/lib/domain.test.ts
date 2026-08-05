// Tests for the extracted domain layer.
//
// The flow tests already cover the WhatsApp path end to end. What they cannot
// reach is what the domain adds on top: schema validation (the flows validate
// step by step and never submit a bad payload) and explicit dates, which the
// dashboard forms will use in Fase 3.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase', async () => {
  const { dbRef } = await import('../helpers/db');
  const actual = await vi.importActual<typeof import('../../src/lib/supabase')>('../../src/lib/supabase');
  return { ...actual, supabase: { from: (name: string) => dbRef.current.from(name) } };
});

import { registrarAnimal, categorizarAnimal } from '../../src/lib/domain/animales';
import { registrarVacunacion, registrarTratamiento, registrarDesparasitacion } from '../../src/lib/domain/sanidad';
import { registrarServicio, registrarDxPrenez, registrarParto } from '../../src/lib/domain/reproduccion';
import { registrarPesaje } from '../../src/lib/domain/pesajes';
import { registrarBaja } from '../../src/lib/domain/mortalidad';
import { FINCA_ID } from '../../src/lib/tenant';
import { resetDb } from '../helpers/db';
import type { FakeSupabase } from '../helpers/fake-supabase';
import { NOW, TODAY, baseSeed } from '../helpers/harness';

let db: FakeSupabase;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = resetDb(baseSeed());
});

afterEach(() => {
  vi.useRealTimers();
});

// =====================================================================
describe('validación de entrada', () => {
  it.each([
    ['arete vacío', () => registrarPesaje({ arete: '', peso: 300, tipo: 'control' })],
    ['arete con espacios', () => registrarPesaje({ arete: '045 A', peso: 300, tipo: 'control' })],
    ['arete demasiado largo', () => registrarPesaje({ arete: 'x'.repeat(16), peso: 300, tipo: 'control' })],
    ['peso negativo', () => registrarPesaje({ arete: '045', peso: -5, tipo: 'control' })],
    ['peso implausible', () => registrarPesaje({ arete: '045', peso: 3000, tipo: 'control' })],
    ['condición corporal fuera de rango', () => registrarPesaje({ arete: '045', peso: 300, tipo: 'control', condicionCorporal: 9 })],
    ['tipo de pesaje inexistente', () => registrarPesaje({ arete: '045', peso: 300, tipo: 'ordeno' as any })],
  ])('rechaza %s sin escribir nada', async (_caso, ejecutar) => {
    await expect(ejecutar()).rejects.toThrow();
    expect(db.inserts).toHaveLength(0);
  });

  it('rechaza una fecha futura', async () => {
    await expect(
      registrarPesaje({ arete: '045', peso: 300, tipo: 'control', fecha: '2027-01-01' }),
    ).rejects.toThrow(/futuro/);
    expect(db.inserts).toHaveLength(0);
  });

  it('exige inseminador cuando el método es IA', async () => {
    await expect(
      registrarServicio({ arete: '045', metodo: 'IA', pajilla: 'ABC' }),
    ).rejects.toThrow(/inseminó/);
    expect(db.inserts).toHaveLength(0);
  });

  it('no permite que la cría tenga el arete de la madre', async () => {
    await expect(
      registrarParto({ madre: '045', cria: '045', sexo: 'H' }),
    ).rejects.toThrow(/mismo arete/);
    expect(db.inserts).toHaveLength(0);
  });

  it('rechaza un peso al nacer implausible', async () => {
    await expect(
      registrarParto({ madre: '045', cria: '201', sexo: 'H', peso: 250 }),
    ).rejects.toThrow(/100 kg/);
  });
});

// =====================================================================
describe('fechas explícitas (base de los formularios de Fase 3)', () => {
  it('usa hoy en la finca cuando no se indica fecha', async () => {
    await registrarPesaje({ arete: '045', peso: 300, tipo: 'control' });

    expect(db.insertsInto('pesajes')[0].fecha).toBe(TODAY);
  });

  it('respeta una fecha pasada explícita', async () => {
    await registrarPesaje({ arete: '045', peso: 300, tipo: 'control', fecha: '2026-06-15' });

    expect(db.insertsInto('pesajes')[0].fecha).toBe('2026-06-15');
  });

  it('calcula las fechas derivadas desde la fecha del evento, no desde hoy', async () => {
    // Una vacunación retrofechada agenda la próxima dosis desde ese día.
    const { proximaFecha } = await registrarVacunacion({
      arete: '045', vacuna: 'Aftosa', dosis: '2 ml', fecha: '2026-07-01',
    });

    expect(proximaFecha).toBe('2026-12-28'); // 2026-07-01 + 180 días
    expect(db.insertsInto('eventos_sanitarios')[0].proxima_fecha).toBe('2026-12-28');
  });

  it('calcula el retiro de leche desde la fecha del tratamiento', async () => {
    const { retiroLecheHasta } = await registrarTratamiento({
      arete: '045', diagnostico: 'Mastitis', medicamento: 'Oxitetraciclina',
      dosis: '10 ml', via: 'IM', fecha: '2026-06-15',
    });

    expect(retiroLecheHasta).toBe('2026-06-18'); // +3 días (72 h)
  });
});

// =====================================================================
describe('valores derivados devueltos al llamante', () => {
  it('informa cuándo tuvo que crear el animal', async () => {
    const nuevo = await registrarPesaje({ arete: '999', peso: 300, tipo: 'control' });
    expect(nuevo.animalCreado).toBe(true);

    const repetido = await registrarPesaje({ arete: '999', peso: 310, tipo: 'control' });
    expect(repetido.animalCreado).toBe(false);
    expect(repetido.animalId).toBe(nuevo.animalId);
  });

  it('devuelve la próxima fecha de desparasitación', async () => {
    const r = await registrarDesparasitacion({ arete: '045', producto: 'Ivermectina', dosis: '5 ml' });

    expect(r.proximaFecha).toBe('2026-11-02');      // +90 días
    expect(r.retiroLecheHasta).toBe('2026-08-06');  // +2 días (48 h)
  });

  it('informa si reutilizó una cría ya registrada', async () => {
    db.rows('animales').push({ id: 'a-201', arete: '201', sexo: 'H', finca_id: FINCA_ID });

    const r = await registrarParto({ madre: '045', cria: '201', sexo: 'H', peso: 32 });

    expect(r.criaCreada).toBe(false);
    expect(r.criaId).toBe('a-201');
    expect(r.pesoRegistrado).toBe(true);
  });

  it('no registra pesaje cuando el parto no trae peso', async () => {
    const r = await registrarParto({ madre: '045', cria: '201', sexo: 'H' });

    expect(r.pesoRegistrado).toBe(false);
    expect(db.insertsInto('pesajes')).toHaveLength(0);
  });
});

// =====================================================================
describe('NINGUNO y campos opcionales', () => {
  it('convierte NINGUNO en null', async () => {
    await registrarServicio({
      arete: '045', metodo: 'IA', inseminador: 'Juan Pérez', pajilla: 'NINGUNO',
    });

    expect(db.insertsInto('eventos_reproductivos')[0].pajilla).toBeNull();
  });

  it('convierte la cadena vacía en null', async () => {
    await registrarAnimal({ arete: '300', sexo: 'H', categoria: 'novilla', raza: '' });

    expect(db.insertsInto('animales')[0].raza).toBeNull();
  });
});

// =====================================================================
describe('estado del animal sincronizado con el evento', () => {
  it.each([
    ['prenada' as const, 'prenada'],
    ['vacia' as const, 'vacia'],
  ])('dx %s deja el estado en %s', async (resultado, esperado) => {
    await registrarDxPrenez({ arete: '045', resultado });

    expect(db.updatesTo('animales')[0].patch).toEqual({ estado_reproductivo: esperado });
  });

  it('una baja marca el animal como muerto', async () => {
    await registrarBaja({ arete: '045', causa: 'Neumonía' });

    expect(db.insertsInto('movimientos')[0]).toMatchObject({
      tipo: 'muerte', notas: 'Causa: Neumonía', finca_id: FINCA_ID,
    });
    expect(db.updatesTo('animales')[0].patch).toEqual({ estado: 'muerto' });
  });
});

// =====================================================================
describe('propagación de errores', () => {
  it('falla ruidosamente si no puede crear el animal', async () => {
    db.failOn('animales', 'timeout');

    await expect(registrarPesaje({ arete: '045', peso: 300, tipo: 'control' }))
      .rejects.toThrow(/animal 045.*timeout/);
  });

  it('falla si no puede leer el catálogo de medicamentos', async () => {
    db.failOn('cat_medicamentos', 'timeout');

    await expect(registrarTratamiento({
      arete: '045', diagnostico: 'Mastitis', medicamento: 'Penicilina', dosis: '5 ml', via: 'IM',
    })).rejects.toThrow(/cat_medicamentos/);
  });

  it('falla si no puede escribir el evento', async () => {
    db.failOn('eventos_sanitarios', 'permiso denegado');

    await expect(registrarVacunacion({ arete: '045', vacuna: 'Aftosa', dosis: '2 ml' }))
      .rejects.toThrow(/vacunación.*permiso denegado/);
  });
});

// =====================================================================
describe('multi-tenant', () => {
  it('estampa finca_id en todo lo que escribe cualquier función de dominio', async () => {
    await registrarAnimal({ arete: '300', sexo: 'H', categoria: 'novilla' });
    await registrarVacunacion({ arete: '045', vacuna: 'Aftosa', dosis: '2 ml' });
    await registrarTratamiento({ arete: '046', diagnostico: 'Mastitis', medicamento: 'Penicilina', dosis: '5 ml', via: 'IM' });
    await registrarDesparasitacion({ arete: '047', producto: 'Ivermectina', dosis: '5 ml' });
    await registrarServicio({ arete: '048', metodo: 'monta', toro: '900' });
    await registrarDxPrenez({ arete: '049', resultado: 'prenada' });
    await registrarParto({ madre: '050', cria: '201', sexo: 'M', peso: 30 });
    await registrarPesaje({ arete: '051', peso: 300, tipo: 'control' });
    await registrarBaja({ arete: '052', causa: 'Culebra' });

    expect(db.inserts.length).toBeGreaterThan(10);
    for (const { table, rows } of db.inserts) {
      for (const row of rows) {
        expect(row.finca_id, `${table} sin finca_id`).toBe(FINCA_ID);
      }
    }
  });

  it('categorizarAnimal solo cambia la categoría', async () => {
    const { animalId } = await registrarAnimal({ arete: '300', sexo: 'H', categoria: 'novilla' });

    await categorizarAnimal({ animalId, categoria: 'vaca' });

    expect(db.updatesTo('animales')[0].patch).toEqual({ categoria: 'vaca' });
  });
});
