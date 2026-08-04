// Shared types and helpers for the WhatsApp conversational state machines.
// Every flow in `flows/` is a step machine driven by `Session.current_step`.

import { Incoming, sendButtons, Button } from './whatsapp';
import { Session, saveSession } from './session';

// A flow module exposes two entry points:
//  - start:  called when the user picks the flow from the main menu (step 0 -> 1)
//  - handle: called on every subsequent message while the flow is active
export type FlowStarter = (to: string, session: Session) => Promise<void>;
export type FlowHandler = (inc: Incoming, session: Session) => Promise<void>;
export type Flow = { start: FlowStarter; handle: FlowHandler };

// ---------- Dates ----------
// Re-exported so flows keep importing dates from the state machine. The farm
// timezone rules live in dates.ts — never build a date any other way.
export { today, addDays } from './dates';

// ---------- Input ----------
// Interactive replies arrive as `id`, free text as `text`. Flows treat them uniformly.
export const inputOf = (inc: Incoming) => (inc.id || inc.text || '').trim();

export const validArete = (s: string) => /^[\w-]{1,15}$/.test(s);

// ---------- Session ----------
// Advances the machine to `step`, persisting the accumulated temp_data.
export function goToStep(session: Session, step: number, temp: Record<string, any>) {
  return saveSession({ ...session, current_step: step, temp_data: temp });
}

// ---------- Shared UI ----------
export const CONFIRM_BUTTONS: Button[] = [
  { id: 'conf:si', title: '✅ Confirmar' },
  { id: 'conf:no', title: '❌ Cancelar' },
];

export const sendConfirm = (to: string, body: string) => sendButtons(to, body, CONFIRM_BUTTONS);

// Wraps a summary block in the separator lines used across all confirmations.
export const SEP = '━━━━━━━━━━━━━━━';
export const confirmBody = (titulo: string, lineas: string) => `${titulo}\n${SEP}\n${lineas}\n${SEP}`;

// ---------- Shared messages ----------
export const MSG_INVALID_ARETE = '❓ Arete inválido. Escribe solo el número/código (ej. 045).';
export const MSG_DESYNC = '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.';
export const MSG_MENU_HINT = '\n\nEscribe *menú* para otro registro.';

// NOTE: two cancel wordings exist in production. Kept byte-identical to avoid
// changing user-facing text during a structural refactor — unify deliberately later.
export const MSG_CANCEL_LONG = '❌ Cancelado. No se guardó nada.\nEscribe *menú* para empezar de nuevo.';
export const MSG_CANCEL_SHORT = '❌ Cancelado. No se guardó nada.\nEscribe *menú*.';
