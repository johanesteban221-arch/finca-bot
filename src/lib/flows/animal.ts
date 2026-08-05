// Flow: Registrar / categorizar animal.
// step 1: arete -> step 2: categoría (list)
//   - existing animal: -> confirm (only updates categoría)
//   - new animal:      -> step 3: sexo (buttons) -> step 4: raza (list) -> confirm
// step 5: confirm -> insert or update

import { sendText, sendButtons, sendList } from '../whatsapp';
import { Session, saveSession, clearSession } from '../session';
import { getCatalog } from '../catalogs';
import { registrarAnimal, categorizarAnimal } from '../domain/animales';
import { findAnimal, CATEGORIAS, catTitle, sexoTitle } from '../animals';
import {
  Flow, inputOf, validArete, goToStep, sendConfirm, confirmBody,
  MSG_INVALID_ARETE, MSG_DESYNC, MSG_MENU_HINT, MSG_CANCEL_SHORT,
} from '../state-machine';

export const animal: Flow = {
  async start(to, session) {
    await saveSession({ ...session, current_flow: 'animal', current_step: 1, temp_data: {} });
    await sendText(to, '🏷️ *Registrar / categorizar animal*\nEscribe el número de arete: (ej. 045)');
  },

  async handle(inc, session) {
    const to = inc.from;
    const input = inputOf(inc);
    const t = session.temp_data;

    // Step 1: arete — branches the rest of the flow on whether the animal exists.
    if (session.current_step === 1 && inc.kind === 'text') {
      const arete = (inc.text || '').trim();
      if (!validArete(arete)) return void sendText(to, MSG_INVALID_ARETE);
      const existente = await findAnimal(arete);
      t.arete = arete;
      t.nuevo = !existente;
      if (existente) t.animalId = existente.id;
      await goToStep(session, 2, t);
      const encabezado = existente
        ? `🏷️ Arete *${arete}* (existente) — ¿Nueva categoría?`
        : `🏷️ Arete *${arete}* (nuevo) — ¿Categoría?`;
      return void sendList(to, encabezado, 'Elegir categoría', [
        { title: 'Categoría', rows: CATEGORIAS.map((c) => ({ id: `cat:${c.id}`, title: c.title })) },
      ]);
    }

    // Step 2: categoría
    if (session.current_step === 2 && input.startsWith('cat:')) {
      t.categoria = input.slice(4);
      if (t.nuevo) {
        await goToStep(session, 3, t);
        return void sendButtons(to, `🆕 Arete ${t.arete} — ¿Sexo?`, [
          { id: 'sexo:H', title: '🐄 Hembra' },
          { id: 'sexo:M', title: '🐂 Macho' },
        ]);
      }
      return confirmar(to, session, t);
    }

    // Step 3: sexo (solo nuevos)
    if (session.current_step === 3 && input.startsWith('sexo:')) {
      t.sexo = input.slice(5);
      const razas = await getCatalog('cat_razas');
      await goToStep(session, 4, t);
      return void sendList(to, '🧬 ¿Raza? (o omitir)', 'Elegir / Omitir', [
        {
          title: 'Raza',
          rows: [
            ...razas.map((r: any) => ({ id: `raza:${r.nombre}`, title: r.nombre })),
            { id: 'raza:skip', title: '➡️ Omitir' },
          ],
        },
      ]);
    }

    // Step 4: raza (solo nuevos)
    if (session.current_step === 4 && input.startsWith('raza:')) {
      const v = input.slice(5);
      t.raza = v === 'skip' ? null : v;
      return confirmar(to, session, t);
    }

    // Step 5: confirmación
    if (session.current_step === 5) {
      if (input === 'conf:si') {
        if (t.nuevo) {
          await registrarAnimal({
            arete: t.arete, sexo: t.sexo, categoria: t.categoria, raza: t.raza,
          });
        } else {
          await categorizarAnimal({ animalId: t.animalId, categoria: t.categoria });
        }
        await clearSession(to);
        const accion = t.nuevo ? 'registrado' : 'actualizado';
        const detalle = t.nuevo
          ? `\nSexo: ${sexoTitle(t.sexo)}${t.raza ? ` · Raza: ${t.raza}` : ''}`
          : '';
        return void sendText(
          to,
          `✅ Animal ${accion}\n🐄 Arete ${t.arete} — ${catTitle(t.categoria)}${detalle}${MSG_MENU_HINT}`,
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

// Both branches (new / existing) converge here at step 5.
async function confirmar(to: string, session: Session, t: Record<string, any>): Promise<void> {
  await goToStep(session, 5, t);
  const extra = t.nuevo
    ? `\n🆕 Nuevo · Sexo: ${sexoTitle(t.sexo)}${t.raza ? ` · Raza: ${t.raza}` : ''}`
    : '\n♻️ Existente (solo cambia categoría)';
  return void sendConfirm(to, confirmBody(
    '✅ *Confirmar*',
    `🐄 Arete: ${t.arete}\n🏷️ Categoría: ${catTitle(t.categoria)}${extra}`,
  ));
}
