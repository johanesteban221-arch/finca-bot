// Test harness: catalog seeds, a fetch stub that captures outgoing WhatsApp
// payloads, and Incoming builders for driving a conversation.

import { vi } from 'vitest';
import type { Incoming } from '../../src/lib/whatsapp';
import type { SeedTables } from './fake-supabase';

export const PHONE = '573001112233';

/** Frozen clock. Midday UTC keeps `today()` (UTC-based) and `addDays()`
 *  (local-date arithmetic) on the same calendar day for any timezone within ±12. */
export const NOW = new Date('2026-08-04T12:00:00.000Z');
export const TODAY = '2026-08-04';

// ---------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------
export function baseSeed(overrides: SeedTables = {}): SeedTables {
  return {
    // `rol` values are unaccented in the real schema (db/01_bot_schema.sql).
    whatsapp_users: [{ telefono: PHONE, nombre: 'Johan', rol: 'dueno', activo: true }],
    whatsapp_sessions: [],
    animales: [],
    eventos_sanitarios: [],
    eventos_reproductivos: [],
    pesajes: [],
    cat_vacunas: [
      { nombre: 'Aftosa', activo: true, orden: 1, retiro_default_dias: 180 },
      { nombre: 'Brucelosis', activo: true, orden: 2, retiro_default_dias: null },
    ],
    cat_diagnosticos: [
      { nombre: 'Mastitis', activo: true, orden: 1 },
      { nombre: 'Cojera', activo: true, orden: 2 },
    ],
    cat_medicamentos: [
      { nombre: 'Oxitetraciclina', activo: true, orden: 1, retiro_horas_default: 72 },
      { nombre: 'Penicilina', activo: true, orden: 2, retiro_horas_default: 0 },
      { nombre: 'Ivermectina', activo: true, orden: 3, retiro_horas_default: 48 },
    ],
    cat_tecnicos: [{ nombre: 'Juan Pérez', activo: true, orden: 1 }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Outgoing WhatsApp capture
// ---------------------------------------------------------------------
export type SentMessage = Record<string, any>;

const sentMessages: SentMessage[] = [];

/** Replaces global fetch. whatsapp.ts talks to Meta through it and nothing else,
 *  so this captures every outgoing message without mocking the module. */
export function installFetchStub(): SentMessage[] {
  sentMessages.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      sentMessages.push(JSON.parse(String(init?.body ?? '{}')));
      return { ok: true, status: 200, text: async () => '' } as unknown as Response;
    }),
  );
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-pnid';
  process.env.WHATSAPP_TOKEN = 'test-token';
  return sentMessages;
}

/** Human-readable body of every message sent, in order. */
export function bodies(): string[] {
  return sentMessages.map(
    (m) => m.text?.body ?? m.interactive?.body?.text ?? `[${m.type}]`,
  );
}

export const lastBody = (): string => bodies().at(-1) ?? '';

/** Row/button ids offered in the most recent interactive message. */
export function lastOptionIds(): string[] {
  const m = sentMessages.at(-1);
  const buttons = m?.interactive?.action?.buttons ?? [];
  const rows = (m?.interactive?.action?.sections ?? []).flatMap((s: any) => s.rows ?? []);
  return [...buttons.map((b: any) => b.reply.id), ...rows.map((r: any) => r.id)];
}

/** True when any message sent so far contains `needle`. */
export const sentAny = (needle: string): boolean => bodies().some((b) => b.includes(needle));

// ---------------------------------------------------------------------
// Incoming builders
// ---------------------------------------------------------------------
export const text = (body: string, from = PHONE): Incoming => ({ from, kind: 'text', text: body });
export const button = (id: string, from = PHONE): Incoming => ({ from, kind: 'button', id });
export const listPick = (id: string, from = PHONE): Incoming => ({ from, kind: 'list', id });
