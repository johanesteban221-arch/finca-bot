// Flow: Mortalidad (registra la baja y marca el animal como muerto)
// step 1: arete -> step 2: causa (list) -> step 3: confirm -> save

import { sendText, sendList } from '../whatsapp';
import { saveSession, clearSession } from '../session';
import { getCatalog } from '../catalogs';
import { registrarBaja } from '../domain/mortalidad';
import {
  Flow, today, inputOf, validArete, goToStep, sendConfirm, confirmBody,
  MSG_INVALID_ARETE, MSG_DESYNC, MSG_MENU_HINT, MSG_CANCEL_SHORT,
} from '../state-machine';

export const mortalidad: Flow = {
  async start(to, session) {
    await saveSession({ ...session, current_flow: 'mortalidad', current_step: 1, temp_data: {} });
    await sendText(to, '💀 *Mortalidad*\nEscribe el número de arete del animal: (ej. 045)');
  },

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);
    const t = session.temp_data;

    // Step 1: arete
    if (session.current_step === 1 && inc.kind === 'text') {
      const arete = (inc.text || '').trim();
      if (!validArete(arete)) return void sendText(to, MSG_INVALID_ARETE);
      t.arete = arete;
      const causas = await getCatalog('cat_causas_mortalidad');
      await goToStep(session, 2, t);
      return void sendList(to, `💀 Arete *${arete}* — ¿Cuál fue la causa?`, 'Elegir causa', [
        { title: 'Causas', rows: causas.map((c: any) => ({ id: `causa:${c.nombre}`, title: c.nombre })) },
      ]);
    }

    // Step 2: causa
    if (session.current_step === 2 && input.startsWith('causa:')) {
      t.causa = input.slice(6);
      await goToStep(session, 3, t);
      return void sendConfirm(
        to,
        confirmBody(
          '⚠️ *Confirmar baja*',
          `🐄 Arete: ${t.arete}\n💀 Causa: ${t.causa}\n📅 Fecha: ${today()}`,
        ) + '\n⚠️ El animal quedará marcado como *muerto*.',
      );
    }

    // Step 3: confirmación
    if (session.current_step === 3) {
      if (input === 'conf:si') {
        await registrarBaja({ arete: t.arete, causa: t.causa });
        await clearSession(to);
        return void sendText(
          to,
          `✅ Baja registrada\n🐄 Arete ${t.arete} — ${t.causa}\n📅 ${today()}\n🔖 Estado: muerto${MSG_MENU_HINT}`,
        );
      }
      if (input === 'conf:no') {
        await clearSession(to);
        return void sendText(to, MSG_CANCEL_SHORT);
      }
      return;
    }

    await clearSession(to);
    return void sendText(to, MSG_DESYNC);
  },
};
