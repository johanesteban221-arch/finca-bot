// Health flows: vacunación, tratamiento, desparasitación.
// `pick` is the sub-menu that routes into the three.

import { Incoming, sendText, sendButtons, sendList } from '../whatsapp';
import { Session, saveSession, clearSession } from '../session';
import { getCatalog } from '../catalogs';
import { supabase } from '../supabase';
import { findOrCreateAnimal } from '../animals';
import { FINCA_ID } from '../tenant';
import { showMenu } from '../menu';
import {
  Flow, today, addDays, inputOf, validArete, goToStep, sendConfirm, confirmBody,
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
        const proxima = await saveVacunacion(t);
        await clearSession(to);
        const extra = proxima ? `\n⏭ Próxima: ${proxima}` : '';
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

// Persists the vaccination, creating a minimal animal if the arete is new.
// Returns the next-dose date when the vaccine catalog defines a default interval.
async function saveVacunacion(t: Record<string, any>): Promise<string | null> {
  const animalId = await findOrCreateAnimal(t.arete, 'una vacunación');

  const { data: vac } = await supabase
    .from('cat_vacunas')
    .select('retiro_default_dias')
    .eq('nombre', t.vacuna)
    .maybeSingle();

  const proxima = vac?.retiro_default_dias ? addDays(vac.retiro_default_dias) : null;

  await supabase.from('eventos_sanitarios').insert({
    finca_id: FINCA_ID,
    animal_id: animalId,
    tipo: 'vacuna',
    fecha: today(),
    producto: t.vacuna,
    dosis: t.dosis,
    proxima_fecha: proxima,
  });

  return proxima;
}

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
        const retiro = await saveTratamiento(t);
        await clearSession(to);
        const extra = retiro ? `\n🥛 Retiro de leche hasta: ${retiro}` : '';
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

// Persists the treatment; computes the milk-withdrawal date from the medicine catalog.
async function saveTratamiento(t: Record<string, any>): Promise<string | null> {
  const animalId = await findOrCreateAnimal(t.arete, 'un tratamiento');
  const retiro = await retiroLecheHasta(t.medicamento);

  await supabase.from('eventos_sanitarios').insert({
    finca_id: FINCA_ID,
    animal_id: animalId,
    tipo: 'tratamiento',
    fecha: today(),
    producto: t.medicamento,
    dosis: t.dosis,
    via: t.via,
    diagnostico: t.diagnostico,
    retiro_leche_hasta: retiro,
  });

  return retiro;
}

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
        const proxima = await saveDesparasitacion(t);
        await clearSession(to);
        return void sendText(
          to,
          `✅ Desparasitación guardada\n🐄 Arete ${t.arete} — ${t.producto} ${t.dosis}\n📅 ${today()}\n⏭ Próxima sugerida: ${proxima}${MSG_MENU_HINT}`,
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

async function saveDesparasitacion(t: Record<string, any>): Promise<string> {
  const animalId = await findOrCreateAnimal(t.arete, 'una desparasitación');
  const retiro = await retiroLecheHasta(t.producto);
  const proxima = addDays(90); // dewormings are typically every ~3 months

  await supabase.from('eventos_sanitarios').insert({
    finca_id: FINCA_ID,
    animal_id: animalId,
    tipo: 'desparasitacion',
    fecha: today(),
    producto: t.producto,
    dosis: t.dosis,
    proxima_fecha: proxima,
    retiro_leche_hasta: retiro,
  });
  return proxima;
}

// Milk-withdrawal date for a product, from the medicine catalog. Null when the
// product has no withdrawal period (or isn't in the catalog at all).
async function retiroLecheHasta(producto: string): Promise<string | null> {
  const { data: med } = await supabase
    .from('cat_medicamentos')
    .select('retiro_horas_default')
    .eq('nombre', producto)
    .maybeSingle();
  const horas = med?.retiro_horas_default || 0;
  return horas > 0 ? addDays(Math.ceil(horas / 24)) : null;
}
