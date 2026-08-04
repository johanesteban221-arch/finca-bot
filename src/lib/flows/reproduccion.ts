// Reproduction flows: servicio (IA / monta), diagnóstico de preñez, parto.
// `pick` is the sub-menu that routes into the three.

import { sendText, sendButtons, sendList } from '../whatsapp';
import { Session, saveSession, clearSession } from '../session';
import { getCatalog } from '../catalogs';
import { supabase } from '../supabase';
import { findAnimal, findOrCreateAnimal, sexoTitle } from '../animals';
import { showMenu } from '../menu';
import {
  Flow, today, inputOf, validArete, goToStep, sendConfirm, confirmBody,
  MSG_INVALID_ARETE, MSG_DESYNC, MSG_MENU_HINT, MSG_CANCEL_SHORT,
} from '../state-machine';

// =====================================================================
// Sub-menu: which reproduction record?
// =====================================================================
export const pick: Flow = {
  async start(to, session) {
    await saveSession({ ...session, current_flow: 'reproduccion.pick', current_step: 0, temp_data: {} });
    await sendButtons(to, '🍼 *Reproducción*\n¿Qué vas a registrar?', [
      { id: 'repro:servicio', title: '🐂 Servicio' },
      { id: 'repro:dxprenez', title: '🔍 Dx preñez' },
      { id: 'repro:parto', title: '🍼 Parto' },
    ]);
  },

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);

    const routes: Record<string, { flow: string; prompt: string }> = {
      'repro:servicio': { flow: 'reproduccion.servicio', prompt: '🐂 *Servicio*\nEscribe el número de arete de la vaca: (ej. 045)' },
      'repro:dxprenez': { flow: 'reproduccion.dxprenez', prompt: '🔍 *Diagnóstico de preñez*\nEscribe el número de arete de la vaca: (ej. 045)' },
      'repro:parto': { flow: 'reproduccion.parto', prompt: '🍼 *Parto*\nEscribe el número de arete de la madre: (ej. 045)' },
    };

    const route = routes[input];
    if (!route) return showMenu(to);

    await saveSession({ ...session, current_flow: route.flow, current_step: 1, temp_data: {} });
    return void sendText(to, route.prompt);
  },
};

// =====================================================================
// Flow: Servicio (IA o monta)
// step 1: arete -> step 2: método -> step 3: (IA: inseminador | monta: toro)
// -> step 4 (IA: pajilla) -> step 5: confirm -> save
// =====================================================================
export const servicio: Flow = {
  start: pick.start, // reached through the sub-menu, never started directly

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);
    const t = session.temp_data;

    // IA and monta converge here; the summary differs by método.
    const confirmar = async () => {
      await goToStep(session, 5, t);
      const det = t.metodo === 'IA'
        ? `🧪 Método: IA\n👨‍🔬 Inseminador: ${t.inseminador}\n🧬 Pajilla: ${t.pajilla || '—'}`
        : `🐂 Método: Monta\n🐂 Toro: ${t.toro || '—'}`;
      return void sendConfirm(to, confirmBody(
        '✅ *Confirmar servicio*',
        `🐄 Vaca: ${t.arete}\n${det}\n📅 Fecha: ${today()}`,
      ));
    };

    // Step 1: arete
    if (session.current_step === 1 && inc.kind === 'text') {
      const arete = (inc.text || '').trim();
      if (!validArete(arete)) return void sendText(to, MSG_INVALID_ARETE);
      t.arete = arete;
      await goToStep(session, 2, t);
      return void sendButtons(to, `🐂 Vaca *${arete}* — ¿Qué método de servicio?`, [
        { id: 'servmet:IA', title: '🧪 Inseminación' },
        { id: 'servmet:monta', title: '🐂 Monta natural' },
      ]);
    }

    // Step 2: método
    if (session.current_step === 2 && input.startsWith('servmet:')) {
      t.metodo = input.slice(8); // 'IA' | 'monta'
      if (t.metodo === 'IA') {
        const tecnicos = await getCatalog('cat_tecnicos');
        await goToStep(session, 3, t);
        return void sendList(to, '👨‍🔬 ¿Quién inseminó?', 'Elegir', [
          { title: 'Inseminador', rows: tecnicos.map((x: any) => ({ id: `insem:${x.nombre}`, title: x.nombre })) },
        ]);
      }
      t.awaiting = 'toro';
      await goToStep(session, 3, t);
      return void sendText(to, '🐂 Escribe el arete del toro (o escribe *NINGUNO*):');
    }

    // Step 3: IA -> inseminador ; monta -> toro (texto)
    if (session.current_step === 3) {
      if (t.metodo === 'IA' && input.startsWith('insem:')) {
        t.inseminador = input.slice(6);
        await goToStep(session, 4, t);
        return void sendText(to, '🧬 Escribe el código de la pajilla/semen (o escribe *NINGUNO*):');
      }
      if (t.metodo === 'monta' && inc.kind === 'text') {
        t.toro = ningunoOr((inc.text || '').trim());
        return confirmar();
      }
      return;
    }

    // Step 4: IA -> pajilla
    if (session.current_step === 4 && t.metodo === 'IA' && inc.kind === 'text') {
      t.pajilla = ningunoOr((inc.text || '').trim());
      return confirmar();
    }

    // Step 5: confirmación
    if (session.current_step === 5) {
      if (input === 'conf:si') {
        await saveServicio(t);
        await clearSession(to);
        return void sendText(
          to,
          `✅ Servicio guardado\n🐄 Vaca ${t.arete} — ${t.metodo === 'IA' ? 'IA' : 'Monta'}\n📅 ${today()}\n🔖 Estado: servida${MSG_MENU_HINT}`,
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

// Free-text optional fields accept the literal NINGUNO to mean "not recorded".
const ningunoOr = (v: string) => (/^ninguno$/i.test(v) ? null : v);

async function saveServicio(t: Record<string, any>): Promise<void> {
  const animalId = await findOrCreateAnimal(t.arete, 'un servicio');
  await supabase.from('eventos_reproductivos').insert({
    animal_id: animalId,
    tipo: 'servicio',
    fecha: today(),
    metodo: t.metodo,
    inseminador: t.metodo === 'IA' ? t.inseminador : null,
    pajilla: t.metodo === 'IA' ? t.pajilla : null,
    notas: t.metodo === 'monta' && t.toro ? `Toro: ${t.toro}` : null,
  });
  await supabase.from('animales').update({ estado_reproductivo: 'servida' }).eq('id', animalId);
}

// =====================================================================
// Flow: Diagnóstico de preñez
// step 1: arete -> step 2: resultado -> step 3: confirm -> save
// =====================================================================
export const dxPrenez: Flow = {
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
      return void sendButtons(to, `🔍 Vaca *${arete}* — ¿Resultado del diagnóstico?`, [
        { id: 'dx:prenada', title: '🤰 Preñada' },
        { id: 'dx:vacia', title: '⭕ Vacía' },
      ]);
    }

    // Step 2: resultado
    if (session.current_step === 2 && input.startsWith('dx:')) {
      t.resultado = input.slice(3); // 'prenada' | 'vacia'
      await goToStep(session, 3, t);
      return void sendConfirm(to, confirmBody(
        '✅ *Confirmar diagnóstico*',
        `🐄 Vaca: ${t.arete}\n🔍 Resultado: ${dxLabel(t.resultado)}\n📅 Fecha: ${today()}`,
      ));
    }

    // Step 3: confirmación
    if (session.current_step === 3) {
      if (input === 'conf:si') {
        const animalId = await findOrCreateAnimal(t.arete, 'un diagnóstico');
        await supabase.from('eventos_reproductivos').insert({
          animal_id: animalId,
          tipo: 'diagnostico_prenez',
          fecha: today(),
          resultado: t.resultado,
        });
        await supabase.from('animales')
          .update({ estado_reproductivo: t.resultado === 'prenada' ? 'prenada' : 'vacia' })
          .eq('id', animalId);
        await clearSession(to);
        return void sendText(
          to,
          `✅ Diagnóstico guardado\n🐄 Vaca ${t.arete} — ${dxLabel(t.resultado)}\n📅 ${today()}${MSG_MENU_HINT}`,
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

const dxLabel = (r: string) => (r === 'prenada' ? 'PREÑADA 🤰' : 'VACÍA ⭕');

// =====================================================================
// Flow: Parto (crea la cría y la enlaza a la madre)
// step 1: arete madre -> step 2: sexo cría -> step 3: arete cría
// -> step 4: peso cría (texto o NINGUNO) -> step 5: confirm -> save
// =====================================================================
export const parto: Flow = {
  start: pick.start,

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);
    const t = session.temp_data;

    // Step 1: arete madre
    if (session.current_step === 1 && inc.kind === 'text') {
      const arete = (inc.text || '').trim();
      if (!validArete(arete)) return void sendText(to, MSG_INVALID_ARETE);
      t.madre = arete;
      await goToStep(session, 2, t);
      return void sendButtons(to, `🍼 Madre *${arete}* — ¿Sexo de la cría?`, [
        { id: 'sexo:H', title: '🐄 Hembra' },
        { id: 'sexo:M', title: '🐂 Macho' },
      ]);
    }

    // Step 2: sexo cría
    if (session.current_step === 2 && input.startsWith('sexo:')) {
      t.sexo = input.slice(5); // 'H' | 'M'
      await goToStep(session, 3, t);
      return void sendText(to, '🏷️ Escribe el arete de la cría: (ej. 201)');
    }

    // Step 3: arete cría
    if (session.current_step === 3 && inc.kind === 'text') {
      const arete = (inc.text || '').trim();
      if (!validArete(arete)) {
        return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 201).');
      }
      t.cria = arete;
      await goToStep(session, 4, t);
      return void sendText(to, '⚖️ Peso de la cría al nacer en kg (o escribe *NINGUNO*):');
    }

    // Step 4: peso cría
    if (session.current_step === 4 && inc.kind === 'text') {
      const v = (inc.text || '').trim();
      if (/^ninguno$/i.test(v)) {
        t.peso = null;
      } else {
        const p = parseFloat(v.replace(',', '.'));
        if (!isFinite(p) || p <= 0 || p > 100) {
          return void sendText(to, '❓ Peso inválido. Escribe el número en kg (ej. 32) o *NINGUNO*.');
        }
        t.peso = p;
      }
      await goToStep(session, 5, t);
      return void sendConfirm(to, confirmBody(
        '✅ *Confirmar parto*',
        `🐄 Madre: ${t.madre}\n🍼 Cría: ${t.cria} (${sexoTitle(t.sexo)})\n⚖️ Peso: ${t.peso ? t.peso + ' kg' : '—'}\n📅 Fecha: ${today()}`,
      ));
    }

    // Step 5: confirmación
    if (session.current_step === 5) {
      if (input === 'conf:si') {
        await saveParto(t);
        await clearSession(to);
        return void sendText(
          to,
          `✅ Parto guardado\n🐄 Madre ${t.madre} — parida\n🍼 Cría ${t.cria} (${sexoTitle(t.sexo)}) registrada\n📅 ${today()}${MSG_MENU_HINT}`,
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

async function saveParto(t: Record<string, any>): Promise<void> {
  const madreId = await findOrCreateAnimal(t.madre, 'un parto');

  // Create (or reuse) the calf, linking genealogy to the dam.
  let cria = await findAnimal(t.cria);
  if (!cria) {
    const { data: nueva } = await supabase
      .from('animales')
      .insert({
        arete: t.cria,
        sexo: t.sexo,
        madre_id: madreId,
        fecha_nacimiento: today(),
        peso_nacimiento: t.peso ?? null,
        origen: 'nacido_en_finca',
        categoria: 'ternero',
        notas: 'Registrada desde un parto por WhatsApp',
      })
      .select('id')
      .single();
    cria = nueva;
  }

  // Birth weight also recorded as a weighing for the calf's weight history.
  if (t.peso && cria?.id) {
    await supabase.from('pesajes').insert({
      animal_id: cria.id, fecha: today(), peso_kg: t.peso, tipo: 'nacimiento',
    });
  }

  await supabase.from('eventos_reproductivos').insert({
    animal_id: madreId,
    tipo: 'parto',
    fecha: today(),
    cria_id: cria?.id ?? null,
  });
  await supabase.from('animales').update({ estado_reproductivo: 'parida' }).eq('id', madreId);
}
