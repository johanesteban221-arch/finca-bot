// Flow: Pesaje
// step 1: arete -> step 2: peso (text) -> step 3: tipo (buttons)
// -> step 4: condición corporal (list, opcional) -> step 5: confirm -> save

import { sendText, sendButtons, sendList } from '../whatsapp';
import { saveSession, clearSession } from '../session';
import { supabase } from '../supabase';
import { findOrCreateAnimal } from '../animals';
import { FINCA_ID } from '../tenant';
import {
  Flow, today, inputOf, validArete, goToStep, sendConfirm, confirmBody,
  MSG_INVALID_ARETE, MSG_DESYNC, MSG_MENU_HINT, MSG_CANCEL_LONG,
} from '../state-machine';

export const pesaje: Flow = {
  async start(to, session) {
    await saveSession({ ...session, current_flow: 'pesaje', current_step: 1, temp_data: {} });
    await sendText(to, '⚖️ *Pesaje*\nEscribe el número de arete: (ej. 045)');
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
      await goToStep(session, 2, t);
      return void sendText(to, `⚖️ Arete *${arete}* — ¿Cuántos kg pesó? (ej. 320)`);
    }

    // Step 2: peso
    if (session.current_step === 2 && inc.kind === 'text') {
      const peso = parseFloat((inc.text || '').replace(',', '.').trim());
      if (!isFinite(peso) || peso <= 0 || peso > 2000) {
        return void sendText(to, '❓ Peso inválido. Escribe solo el número en kg (ej. 320).');
      }
      t.peso = peso;
      await goToStep(session, 3, t);
      return void sendButtons(to, `⚖️ ${peso} kg — ¿Qué tipo de pesaje?`, [
        { id: 'ptipo:control', title: '📋 Control' },
        { id: 'ptipo:destete', title: '🐄 Destete' },
        { id: 'ptipo:venta', title: '💰 Venta' },
      ]);
    }

    // Step 3: tipo
    if (session.current_step === 3 && input.startsWith('ptipo:')) {
      t.tipo = input.slice(6);
      await goToStep(session, 4, t);
      return void sendList(to, '💪 ¿Condición corporal? (1 flaco – 5 gordo)', 'Elegir / Omitir', [
        {
          title: 'Condición corporal',
          rows: [
            { id: 'cc:1', title: '1 — Muy flaco' },
            { id: 'cc:2', title: '2 — Flaco' },
            { id: 'cc:3', title: '3 — Ideal' },
            { id: 'cc:4', title: '4 — Gordo' },
            { id: 'cc:5', title: '5 — Muy gordo' },
            { id: 'cc:skip', title: '➡️ Omitir' },
          ],
        },
      ]);
    }

    // Step 4: condición corporal (opcional)
    if (session.current_step === 4 && input.startsWith('cc:')) {
      const v = input.slice(3);
      t.cc = v === 'skip' ? null : parseInt(v, 10);
      await goToStep(session, 5, t);
      const ccTxt = t.cc ? `\n💪 Condición: ${t.cc}/5` : '';
      return void sendConfirm(to, confirmBody(
        '✅ *Confirmar pesaje*',
        `🐄 Arete: ${t.arete}\n⚖️ Peso: ${t.peso} kg\n📋 Tipo: ${t.tipo}${ccTxt}\n📅 Fecha: ${today()}`,
      ));
    }

    // Step 5: confirmación
    if (session.current_step === 5) {
      if (input === 'conf:si') {
        await savePesaje(t);
        await clearSession(to);
        const ccTxt = t.cc ? ` · CC ${t.cc}/5` : '';
        return void sendText(
          to,
          `✅ Pesaje guardado\n🐄 Arete ${t.arete} — ${t.peso} kg (${t.tipo})${ccTxt}\n📅 ${today()}${MSG_MENU_HINT}`,
        );
      }
      if (input === 'conf:no') {
        await clearSession(to);
        return void sendText(to, MSG_CANCEL_LONG);
      }
      return;
    }

    await clearSession(to);
    return void sendText(to, MSG_DESYNC);
  },
};

async function savePesaje(t: Record<string, any>): Promise<void> {
  const animalId = await findOrCreateAnimal(t.arete, 'un pesaje');
  await supabase.from('pesajes').insert({
    finca_id: FINCA_ID,
    animal_id: animalId,
    fecha: today(),
    peso_kg: t.peso,
    tipo: t.tipo,
    condicion_corporal: t.cc ?? null,
  });
}
