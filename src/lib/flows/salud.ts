// Health flows: vacunación, tratamiento, desparasitación.
// `pick` is the sub-menu that routes into the three.

import { Incoming, sendText, sendButtons, sendList } from '../whatsapp';
import { Session, saveSession, clearSession } from '../session';
import { getCatalog } from '../catalogs';
import { registrarVacunacion, registrarTratamiento, registrarDesparasitacion } from '../domain/sanidad';
import { showMenu } from '../menu';
import {
  Flow, today, inputOf, validArete, goToStep, sendConfirm, confirmBody,
  MSG_INVALID_ARETE, MSG_DESYNC, MSG_MENU_HINT, MSG_CANCEL_LONG,
} from '../state-machine';

// =====================================================================
// Sub-menu: which health record?
// =====================================================================
export const pick: Flow = {
  async start(to, session) {
    await saveSession({ ...session, current_flow: 'salud.pick', current_step: 0, temp_data: {} });
    await sendButtons(to, '🩺 *Salud Animal*\n¿Qué vas a registrar?', [
      { id: 'salud:vacunacion', title: '💉 Vacunación' },
      { id: 'salud:tratamiento', title: '🔴 Tratamiento' },
      { id: 'salud:desparasitacion', title: '🪱 Desparasitar' },
    ]);
  },

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);

    const routes: Record<string, { flow: string; prompt: string }> = {
      'salud:vacunacion': { flow: 'salud.vacunacion', prompt: '💉 *Vacunación*\nEscribe el número de arete: (ej. 045)' },
      'salud:tratamiento': { flow: 'salud.tratamiento', prompt: '🔴 *Tratamiento*\nEscribe el número de arete: (ej. 045)' },
      'salud:desparasitacion': { flow: 'salud.desparasitacion', prompt: '🪱 *Desparasitación*\nEscribe el número de arete: (ej. 045)' },
    };

    const route = routes[input];
    if (!route) return showMenu(to);

    await saveSession({ ...session, current_flow: route.flow, current_step: 1, temp_data: {} });
    return void sendText(to, route.prompt);
  },
};

// =====================================================================
// Flow: Vacunación
// step 1: arete (text) -> step 2: vacuna (list) -> step 3: dosis (buttons)
// -> step 4: confirm (buttons) -> save
// =====================================================================
export const vacunacion: Flow = {
  start: pick.start, // reached through the sub-menu, never started directly

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);
    const t = session.temp_data;

    // Step 1: arete
    if (session.current_step === 1 && inc.kind === 'text') {
      const arete = (inc.text || '').trim();
      if (!validArete(arete)) return void sendText(to, MSG_INVALID_ARETE);
      t.arete = arete;
      const vacunas = await getCatalog('cat_vacunas');
      await goToStep(session, 2, t);
      return void sendList(to, `💉 Arete *${arete}* — ¿Qué vacuna aplicaste?`, 'Elegir vacuna', [
        { title: 'Vacunas', rows: vacunas.map((v: any) => ({ id: `vac:${v.nombre}`, title: v.nombre })) },
      ]);
    }

    // Step 2: vacuna seleccionada
    if (session.current_step === 2 && input.startsWith('vac:')) {
      t.vacuna = input.slice(4);
      await goToStep(session, 3, t);
      return void sendButtons(to, `💉 ${t.vacuna} — ¿Cuántos ml aplicaste?`, [
        { id: 'dosis:2 ml', title: '2 ml' },
        { id: 'dosis:5 ml', title: '5 ml' },
        { id: 'dosis:otra', title: 'Otra dosis' },
      ]);
    }

    // Step 3: dosis (botones o texto si eligió "Otra")
    if (session.current_step === 3) {
      if (input === 'dosis:otra') {
        t.awaiting = 'dosis_text';
        await goToStep(session, 3, t);
        return void sendText(to, '✍️ Escribe la dosis (ej. 3 ml):');
      }
      let dosis = '';
      if (input.startsWith('dosis:')) dosis = input.slice(6);
      else if (t.awaiting === 'dosis_text' && inc.kind === 'text') dosis = (inc.text || '').trim();
      else return; // ignore unexpected input
      t.dosis = dosis;
      delete t.awaiting;
      await goToStep(session, 4, t);
      return void sendConfirm(to, confirmBody(
        '✅ *Confirmar registro*',
        `🐄 Arete: ${t.arete}\n💉 Vacuna: ${t.vacuna}\n💊 Dosis: ${t.dosis}\n📅 Fecha: ${today()}`,
      ));
    }

    // Step 4: confirmación
    if (session.current_step === 4) {
      if (input === 'conf:si') {
        const { proximaFecha } = await registrarVacunacion({
          arete: t.arete, vacuna: t.vacuna, dosis: t.dosis,
        });
        await clearSession(to);
        const extra = proximaFecha ? `\n⏭ Próxima: ${proximaFecha}` : '';
        return void sendText(
          to,
          `✅ Vacunación guardada\n🐄 Arete ${t.arete} — ${t.vacuna} ${t.dosis}\n📅 ${today()}${extra}${MSG_MENU_HINT}`,
        );
      }
      if (input === 'conf:no') {
        await clearSession(to);
        return void sendText(to, MSG_CANCEL_LONG);
      }
      return; // ignore
    }

    // Desync safety net
    await clearSession(to);
    return void sendText(to, MSG_DESYNC);
  },
};

// =====================================================================
// Flow: Tratamiento
// step 1: arete -> step 2: diagnóstico (list) -> step 3: medicamento (list)
// -> step 4: dosis (buttons) -> step 5: vía (buttons) -> step 6: confirm -> save
// =====================================================================
export const tratamiento: Flow = {
  start: pick.start,

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);
    const t = session.temp_data;

    // Step 1: arete
    if (session.current_step === 1 && inc.kind === 'text') {
      const arete = (inc.text || '').trim();
      if (!validArete(arete)) return void sendText(to, MSG_INVALID_ARETE);
      t.arete = arete;
      const diag = await getCatalog('cat_diagnosticos');
      await goToStep(session, 2, t);
      return void sendList(to, `🔴 Arete *${arete}* — ¿Cuál es el diagnóstico?`, 'Elegir diagnóstico', [
        { title: 'Diagnósticos', rows: diag.map((d: any) => ({ id: `diag:${d.nombre}`, title: d.nombre })) },
      ]);
    }

    // Step 2: diagnóstico
    if (session.current_step === 2 && input.startsWith('diag:')) {
      t.diagnostico = input.slice(5);
      const meds = await getCatalog('cat_medicamentos');
      await goToStep(session, 3, t);
      return void sendList(to, `💊 ${t.diagnostico} — ¿Qué medicamento aplicaste?`, 'Elegir medicamento', [
        { title: 'Medicamentos', rows: meds.map((m: any) => ({ id: `med:${m.nombre}`, title: m.nombre })) },
      ]);
    }

    // Step 3: medicamento
    if (session.current_step === 3 && input.startsWith('med:')) {
      t.medicamento = input.slice(4);
      await goToStep(session, 4, t);
      return void sendButtons(to, `💊 ${t.medicamento} — ¿Cuántos ml aplicaste?`, [
        { id: 'tdosis:5 ml', title: '5 ml' },
        { id: 'tdosis:10 ml', title: '10 ml' },
        { id: 'tdosis:otra', title: 'Otra dosis' },
      ]);
    }

    // Step 4: dosis (botones o texto si eligió "Otra")
    if (session.current_step === 4) {
      if (input === 'tdosis:otra') {
        t.awaiting = 'dosis_text';
        await goToStep(session, 4, t);
        return void sendText(to, '✍️ Escribe la dosis (ej. 8 ml):');
      }
      let dosis = '';
      if (input.startsWith('tdosis:')) dosis = input.slice(7);
      else if (t.awaiting === 'dosis_text' && inc.kind === 'text') dosis = (inc.text || '').trim();
      else return;
      t.dosis = dosis;
      delete t.awaiting;
      await goToStep(session, 5, t);
      return void sendButtons(to, `💉 ${t.medicamento} ${t.dosis} — ¿Por qué vía?`, [
        { id: 'via:IM', title: '💪 Intramuscular' },
        { id: 'via:SC', title: 'Subcutánea' },
        { id: 'via:Oral', title: 'Oral' },
      ]);
    }

    // Step 5: vía
    if (session.current_step === 5 && input.startsWith('via:')) {
      t.via = input.slice(4);
      await goToStep(session, 6, t);
      return void sendConfirm(to, confirmBody(
        '✅ *Confirmar tratamiento*',
        `🐄 Arete: ${t.arete}\n🔴 Diagnóstico: ${t.diagnostico}\n💊 Medicamento: ${t.medicamento}\n💉 Dosis: ${t.dosis}\n🩹 Vía: ${t.via}\n📅 Fecha: ${today()}`,
      ));
    }

    // Step 6: confirmación
    if (session.current_step === 6) {
      if (input === 'conf:si') {
        const { retiroLecheHasta } = await registrarTratamiento({
          arete: t.arete, diagnostico: t.diagnostico, medicamento: t.medicamento,
          dosis: t.dosis, via: t.via,
        });
        await clearSession(to);
        const extra = retiroLecheHasta ? `\n🥛 Retiro de leche hasta: ${retiroLecheHasta}` : '';
        return void sendText(
          to,
          `✅ Tratamiento guardado\n🐄 Arete ${t.arete} — ${t.diagnostico}\n💊 ${t.medicamento} ${t.dosis} (${t.via})\n📅 ${today()}${extra}${MSG_MENU_HINT}`,
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

// =====================================================================
// Flow: Desparasitación
// step 1: arete -> step 2: producto (buttons + "Otro") -> step 3: dosis (buttons)
// -> step 4: confirm -> save (tipo desparasitacion, próxima en +90 días)
// =====================================================================
export const desparasitacion: Flow = {
  start: pick.start,

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
      return void sendButtons(to, `🪱 Arete *${arete}* — ¿Qué producto aplicaste?`, [
        { id: 'desp:Ivermectina', title: 'Ivermectina' },
        { id: 'desp:Doramec', title: 'Doramec' },
        { id: 'desp:otra', title: 'Otro producto' },
      ]);
    }

    // Step 2: producto (botón o texto si eligió "Otro")
    if (session.current_step === 2) {
      if (input === 'desp:otra') {
        t.awaiting = 'prod_text';
        await goToStep(session, 2, t);
        return void sendText(to, '✍️ Escribe el nombre del producto:');
      }
      let prod = '';
      if (input.startsWith('desp:')) prod = input.slice(5);
      else if (t.awaiting === 'prod_text' && inc.kind === 'text') prod = (inc.text || '').trim();
      else return;
      t.producto = prod;
      delete t.awaiting;
      await goToStep(session, 3, t);
      return void sendButtons(to, `🪱 ${t.producto} — ¿Cuántos ml aplicaste?`, [
        { id: 'dosis:5 ml', title: '5 ml' },
        { id: 'dosis:10 ml', title: '10 ml' },
        { id: 'dosis:otra', title: 'Otra dosis' },
      ]);
    }

    // Step 3: dosis
    if (session.current_step === 3) {
      if (input === 'dosis:otra') {
        t.awaiting = 'dosis_text';
        await goToStep(session, 3, t);
        return void sendText(to, '✍️ Escribe la dosis (ej. 8 ml):');
      }
      let dosis = '';
      if (input.startsWith('dosis:')) dosis = input.slice(6);
      else if (t.awaiting === 'dosis_text' && inc.kind === 'text') dosis = (inc.text || '').trim();
      else return;
      t.dosis = dosis;
      delete t.awaiting;
      await goToStep(session, 4, t);
      return void sendConfirm(to, confirmBody(
        '✅ *Confirmar desparasitación*',
        `🐄 Arete: ${t.arete}\n🪱 Producto: ${t.producto}\n💊 Dosis: ${t.dosis}\n📅 Fecha: ${today()}`,
      ));
    }

    // Step 4: confirmación
    if (session.current_step === 4) {
      if (input === 'conf:si') {
        const { proximaFecha } = await registrarDesparasitacion({
          arete: t.arete, producto: t.producto, dosis: t.dosis,
        });
        await clearSession(to);
        return void sendText(
          to,
          `✅ Desparasitación guardada\n🐄 Arete ${t.arete} — ${t.producto} ${t.dosis}\n📅 ${today()}\n⏭ Próxima sugerida: ${proximaFecha}${MSG_MENU_HINT}`,
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

