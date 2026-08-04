// Bot orchestrator: authenticate, handle global shortcuts, route to a flow.
// All step logic lives in `flows/`; this file only wires menu keys and flow ids.

import { Incoming, sendText } from './whatsapp';
import { getSession, clearSession, Session } from './session';
import { supabase } from './supabase';
import { showMenu } from './menu';
import { Flow, inputOf } from './state-machine';

import * as salud from './flows/salud';
import * as reproduccion from './flows/reproduccion';
import { animal } from './flows/animal';
import { pesaje } from './flows/pesaje';
import { mortalidad } from './flows/mortalidad';
import { verAnimal, showAlertas, showResumen } from './flows/consultas';

// ---------------------------------------------------------------------
// Routing tables
// ---------------------------------------------------------------------

// Main-menu id (`menu:<key>`) -> flow to start.
const MENU_FLOWS: Record<string, Flow> = {
  animal,
  salud: salud.pick,
  reproduccion: reproduccion.pick,
  pesaje,
  mortalidad,
  ver_animal: verAnimal,
};

// Main-menu id -> immediate action (no session state).
const MENU_ACTIONS: Record<string, (to: string) => Promise<void>> = {
  alertas: showAlertas,
  resumen: showResumen,
};

// Persisted `current_flow` -> the flow that owns it.
const FLOWS: Record<string, Flow> = {
  'salud.pick': salud.pick,
  'salud.vacunacion': salud.vacunacion,
  'salud.tratamiento': salud.tratamiento,
  'salud.desparasitacion': salud.desparasitacion,
  'animal': animal,
  'pesaje': pesaje,
  'reproduccion.pick': reproduccion.pick,
  'reproduccion.servicio': reproduccion.servicio,
  'reproduccion.dxprenez': reproduccion.dxPrenez,
  'reproduccion.parto': reproduccion.parto,
  'mortalidad': mortalidad,
  'consulta.ver': verAnimal,
};

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------
export async function handleMessage(inc: Incoming): Promise<void> {
  // 1) Auth: only registered, active numbers may use the bot.
  const { data: user } = await supabase
    .from('whatsapp_users')
    .select('telefono, nombre, rol')
    .eq('telefono', inc.from)
    .eq('activo', true)
    .maybeSingle();

  if (!user) {
    await sendText(inc.from, '🔒 Tu número no está registrado en la finca. Pídele al administrador que te dé acceso.');
    return;
  }

  const session = await getSession(inc.from);
  const input = inputOf(inc);

  // 2) Global shortcuts: "menú" / greetings always reset to the main menu.
  if (inc.kind === 'text' && /^(menu|menú|hola|inicio|empezar|start)$/i.test(inc.text || '')) {
    await clearSession(inc.from);
    return showMenu(inc.from);
  }
  if (input === 'nav:menu') {
    await clearSession(inc.from);
    return showMenu(inc.from);
  }

  // 3) No active flow -> a menu selection starts a flow; anything else shows the menu.
  if (!session.current_flow) {
    if (input.startsWith('menu:')) return startMenuItem(inc.from, input.slice(5), session);
    return showMenu(inc.from);
  }

  // 4) Active flow -> hand the message to its state machine.
  const flow = FLOWS[session.current_flow];
  if (!flow) {
    await clearSession(inc.from); // unknown flow id (e.g. after a deploy) -> reset
    return showMenu(inc.from);
  }
  return flow.handle(inc, session);
}

async function startMenuItem(to: string, key: string, session: Session): Promise<void> {
  const flow = MENU_FLOWS[key];
  if (flow) return flow.start(to, session);

  const action = MENU_ACTIONS[key];
  if (action) {
    await clearSession(to);
    return action(to);
  }

  await clearSession(to);
  await sendText(to, '❓ Opción no reconocida. Escribe *menú* para volver.');
}
