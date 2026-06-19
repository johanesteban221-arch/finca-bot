import { Incoming, sendText, sendButtons, sendList } from './whatsapp';
import { getSession, saveSession, clearSession, Session } from './session';
import { getCatalog } from './catalogs';
import { supabase } from './supabase';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// =====================================================================
// Entry point
// =====================================================================
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
  const input = (inc.id || inc.text || '').trim();

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

  // 4) Active flow -> dispatch to the right state machine.
  return dispatch(inc, session);
}

// =====================================================================
// Main menu
// =====================================================================
async function showMenu(to: string): Promise<void> {
  await sendList(
    to,
    '🐄 *FINCA* — ¿Qué vas a hacer?',
    'Abrir menú',
    [
      {
        title: '📋 Registros',
        rows: [
          { id: 'menu:animal', title: '🏷️ Registrar animal' },
          { id: 'menu:salud', title: '🩺 Salud / Tratam.' },
          { id: 'menu:reproduccion', title: '🍼 Reproducción' },
          { id: 'menu:pesaje', title: '⚖️ Pesaje' },
          { id: 'menu:mortalidad', title: '💀 Mortalidad' },
        ],
      },
      {
        title: '📊 Consultas',
        rows: [
          { id: 'menu:ver_animal', title: '🐄 Ver animal' },
          { id: 'menu:alertas', title: '⚠️ Alertas' },
          { id: 'menu:resumen', title: '📋 Resumen del día' },
        ],
      },
    ],
  );
}

async function startMenuItem(to: string, key: string, session: Session): Promise<void> {
  if (key === 'salud') {
    await saveSession({ ...session, current_flow: 'salud.pick', current_step: 0, temp_data: {} });
    await sendButtons(to, '🩺 *Salud Animal*\n¿Qué vas a registrar?', [
      { id: 'salud:vacunacion', title: '💉 Vacunación' },
      { id: 'salud:tratamiento', title: '🔴 Tratamiento' },
      { id: 'salud:desparasitacion', title: '🪱 Desparasitar' },
    ]);
    return;
  }
  if (key === 'animal') {
    await saveSession({ ...session, current_flow: 'animal', current_step: 1, temp_data: {} });
    await sendText(to, '🏷️ *Registrar / categorizar animal*\nEscribe el número de arete: (ej. 045)');
    return;
  }
  if (key === 'pesaje') {
    await saveSession({ ...session, current_flow: 'pesaje', current_step: 1, temp_data: {} });
    await sendText(to, '⚖️ *Pesaje*\nEscribe el número de arete: (ej. 045)');
    return;
  }
  if (key === 'reproduccion') {
    await saveSession({ ...session, current_flow: 'reproduccion.pick', current_step: 0, temp_data: {} });
    await sendButtons(to, '🍼 *Reproducción*\n¿Qué vas a registrar?', [
      { id: 'repro:servicio', title: '🐂 Servicio' },
      { id: 'repro:dxprenez', title: '🔍 Dx preñez' },
      { id: 'repro:parto', title: '🍼 Parto' },
    ]);
    return;
  }
  if (key === 'mortalidad') {
    await saveSession({ ...session, current_flow: 'mortalidad', current_step: 1, temp_data: {} });
    await sendText(to, '💀 *Mortalidad*\nEscribe el número de arete del animal: (ej. 045)');
    return;
  }
  if (key === 'ver_animal') {
    await saveSession({ ...session, current_flow: 'consulta.ver', current_step: 1, temp_data: {} });
    await sendText(to, '🐄 *Ver animal*\nEscribe el número de arete: (ej. 045)');
    return;
  }
  if (key === 'alertas') {
    await clearSession(to);
    return showAlertas(to);
  }
  if (key === 'resumen') {
    await clearSession(to);
    return showResumen(to);
  }
  await clearSession(to);
  await sendText(to, '❓ Opción no reconocida. Escribe *menú* para volver.');
}

// =====================================================================
// Dispatcher
// =====================================================================
async function dispatch(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();

  // ---- Salud: pick sub-type ----
  if (session.current_flow === 'salud.pick') {
    if (input === 'salud:vacunacion') {
      await saveSession({ ...session, current_flow: 'salud.vacunacion', current_step: 1, temp_data: {} });
      return void sendText(to, '💉 *Vacunación*\nEscribe el número de arete: (ej. 045)');
    }
    if (input === 'salud:tratamiento') {
      await saveSession({ ...session, current_flow: 'salud.tratamiento', current_step: 1, temp_data: {} });
      return void sendText(to, '🔴 *Tratamiento*\nEscribe el número de arete: (ej. 045)');
    }
    if (input === 'salud:desparasitacion') {
      await saveSession({ ...session, current_flow: 'salud.desparasitacion', current_step: 1, temp_data: {} });
      return void sendText(to, '🪱 *Desparasitación*\nEscribe el número de arete: (ej. 045)');
    }
    return showMenu(to);
  }

  // ---- Salud: vacunación (4 pasos) ----
  if (session.current_flow === 'salud.vacunacion') {
    return vacunacion(inc, session);
  }

  // ---- Salud: tratamiento (6 pasos) ----
  if (session.current_flow === 'salud.tratamiento') {
    return tratamiento(inc, session);
  }

  // ---- Salud: desparasitación (4 pasos) ----
  if (session.current_flow === 'salud.desparasitacion') {
    return desparasitacion(inc, session);
  }

  // ---- Registrar / categorizar animal ----
  if (session.current_flow === 'animal') {
    return registrarAnimal(inc, session);
  }

  // ---- Pesaje (5 pasos) ----
  if (session.current_flow === 'pesaje') {
    return pesaje(inc, session);
  }

  // ---- Reproducción ----
  if (session.current_flow === 'reproduccion.pick') {
    if (input === 'repro:servicio') {
      await saveSession({ ...session, current_flow: 'reproduccion.servicio', current_step: 1, temp_data: {} });
      return void sendText(to, '🐂 *Servicio*\nEscribe el número de arete de la vaca: (ej. 045)');
    }
    if (input === 'repro:dxprenez') {
      await saveSession({ ...session, current_flow: 'reproduccion.dxprenez', current_step: 1, temp_data: {} });
      return void sendText(to, '🔍 *Diagnóstico de preñez*\nEscribe el número de arete de la vaca: (ej. 045)');
    }
    if (input === 'repro:parto') {
      await saveSession({ ...session, current_flow: 'reproduccion.parto', current_step: 1, temp_data: {} });
      return void sendText(to, '🍼 *Parto*\nEscribe el número de arete de la madre: (ej. 045)');
    }
    return showMenu(to);
  }
  if (session.current_flow === 'reproduccion.servicio') return reproServicio(inc, session);
  if (session.current_flow === 'reproduccion.dxprenez') return reproDxPrenez(inc, session);
  if (session.current_flow === 'reproduccion.parto') return reproParto(inc, session);

  // ---- Mortalidad ----
  if (session.current_flow === 'mortalidad') {
    return mortalidad(inc, session);
  }

  // ---- Consulta: ver animal ----
  if (session.current_flow === 'consulta.ver') {
    return consultaVerAnimal(inc, session);
  }

  // Unknown -> reset.
  await clearSession(to);
  return showMenu(to);
}

// =====================================================================
// Flow: Vacunación
// step 1: arete (text) -> step 2: vacuna (list) -> step 3: dosis (buttons)
// -> step 4: confirm (buttons) -> save
// =====================================================================
async function vacunacion(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!/^[\w-]{1,15}$/.test(arete)) {
      return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    }
    t.arete = arete;
    const vacunas = await getCatalog('cat_vacunas');
    await saveSession({ ...session, current_step: 2, temp_data: t });
    return void sendList(to, `💉 Arete *${arete}* — ¿Qué vacuna aplicaste?`, 'Elegir vacuna', [
      { title: 'Vacunas', rows: vacunas.map((v: any) => ({ id: `vac:${v.nombre}`, title: v.nombre })) },
    ]);
  }

  // Step 2: vacuna seleccionada
  if (session.current_step === 2 && input.startsWith('vac:')) {
    t.vacuna = input.slice(4);
    await saveSession({ ...session, current_step: 3, temp_data: t });
    return void sendButtons(to, `💉 ${t.vacuna} — ¿Cuántos ml aplicaste?`, [
      { id: 'dosis:2 ml', title: '2 ml' },
      { id: 'dosis:5 ml', title: '5 ml' },
      { id: 'dosis:otra', title: 'Otra dosis' },
    ]);
  }

  // Step 3: dosis (buttons o texto si eligió "Otra")
  if (session.current_step === 3) {
    if (input === 'dosis:otra') {
      t.awaiting = 'dosis_text';
      await saveSession({ ...session, current_step: 3, temp_data: t });
      return void sendText(to, '✍️ Escribe la dosis (ej. 3 ml):');
    }
    let dosis = '';
    if (input.startsWith('dosis:')) dosis = input.slice(6);
    else if (t.awaiting === 'dosis_text' && inc.kind === 'text') dosis = (inc.text || '').trim();
    else return; // ignore unexpected input
    t.dosis = dosis;
    delete t.awaiting;
    await saveSession({ ...session, current_step: 4, temp_data: t });
    return void sendButtons(
      to,
      `✅ *Confirmar registro*\n━━━━━━━━━━━━━━━\n🐄 Arete: ${t.arete}\n💉 Vacuna: ${t.vacuna}\n💊 Dosis: ${t.dosis}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
  }

  // Step 4: confirmación
  if (session.current_step === 4) {
    if (input === 'conf:si') {
      const proxima = await saveVacunacion(t);
      await clearSession(to);
      const extra = proxima ? `\n⏭ Próxima: ${proxima}` : '';
      return void sendText(
        to,
        `✅ Vacunación guardada\n🐄 Arete ${t.arete} — ${t.vacuna} ${t.dosis}\n📅 ${today()}${extra}\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú* para empezar de nuevo.');
    }
    return; // ignore
  }

  // Desync safety net
  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

// Persists the vaccination, creating a minimal animal if the arete is new.
async function saveVacunacion(t: Record<string, any>): Promise<string | null> {
  let { data: animal } = await supabase
    .from('animales')
    .select('id')
    .eq('arete', t.arete)
    .maybeSingle();

  if (!animal) {
    const { data: nuevo } = await supabase
      .from('animales')
      .insert({ arete: t.arete, sexo: 'H', notas: 'Creado automáticamente desde una vacunación por WhatsApp' })
      .select('id')
      .single();
    animal = nuevo;
  }

  const { data: vac } = await supabase
    .from('cat_vacunas')
    .select('retiro_default_dias')
    .eq('nombre', t.vacuna)
    .maybeSingle();

  const proxima = vac?.retiro_default_dias ? addDays(vac.retiro_default_dias) : null;

  await supabase.from('eventos_sanitarios').insert({
    animal_id: animal?.id,
    tipo: 'vacuna',
    fecha: today(),
    producto: t.vacuna,
    dosis: t.dosis,
    proxima_fecha: proxima,
  });

  return proxima;
}

// Finds the animal by arete; creates a minimal record if it doesn't exist yet.
async function findOrCreateAnimal(arete: string, origen: string): Promise<string | undefined> {
  const { data: animal } = await supabase
    .from('animales')
    .select('id')
    .eq('arete', arete)
    .maybeSingle();
  if (animal) return animal.id;

  const { data: nuevo } = await supabase
    .from('animales')
    .insert({ arete, sexo: 'H', notas: `Creado automáticamente desde ${origen} por WhatsApp` })
    .select('id')
    .single();
  return nuevo?.id;
}

// Animal categories (dual-purpose cattle lifecycle stages).
const CATEGORIAS: { id: string; title: string }[] = [
  { id: 'ternero', title: '🐄 Ternero(a)' },
  { id: 'levante', title: '🐂 Levante' },
  { id: 'ceba', title: '🥩 Ceba' },
  { id: 'novilla', title: '🐄 Novilla' },
  { id: 'vaca', title: '🐄 Vaca' },
  { id: 'vaca_seca', title: '🌵 Vaca seca' },
  { id: 'toro', title: '🐂 Toro' },
];
const catTitle = (id: string) => CATEGORIAS.find((c) => c.id === id)?.title || id;

// =====================================================================
// Flow: Registrar / categorizar animal
// step 1: arete -> step 2: categoría (list)
//   - existing animal: -> confirm (only updates categoría)
//   - new animal:      -> step 3: sexo (buttons) -> step 4: raza (list) -> confirm
// step 5: confirm -> upsert
// =====================================================================
async function registrarAnimal(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    const animal = await findAnimal(arete);
    t.arete = arete;
    t.nuevo = !animal;
    if (animal) t.animalId = animal.id;
    await saveSession({ ...session, current_step: 2, temp_data: t });
    const encabezado = animal
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
      await saveSession({ ...session, current_step: 3, temp_data: t });
      return void sendButtons(to, `🆕 Arete ${t.arete} — ¿Sexo?`, [
        { id: 'sexo:H', title: '🐄 Hembra' },
        { id: 'sexo:M', title: '🐂 Macho' },
      ]);
    }
    return confirmarAnimal(to, session, t);
  }

  // Step 3: sexo (solo nuevos)
  if (session.current_step === 3 && input.startsWith('sexo:')) {
    t.sexo = input.slice(5);
    const razas = await getCatalog('cat_razas');
    await saveSession({ ...session, current_step: 4, temp_data: t });
    return void sendList(to, '🧬 ¿Raza? (o omitir)', 'Elegir / Omitir', [
      {
        title: 'Raza',
        rows: [...razas.map((r: any) => ({ id: `raza:${r.nombre}`, title: r.nombre })), { id: 'raza:skip', title: '➡️ Omitir' }],
      },
    ]);
  }

  // Step 4: raza (solo nuevos)
  if (session.current_step === 4 && input.startsWith('raza:')) {
    const v = input.slice(5);
    t.raza = v === 'skip' ? null : v;
    return confirmarAnimal(to, session, t);
  }

  // Step 5: confirmación
  if (session.current_step === 5) {
    if (input === 'conf:si') {
      if (t.nuevo) {
        await supabase.from('animales').insert({
          arete: t.arete, sexo: t.sexo, raza: t.raza ?? null, categoria: t.categoria,
          notas: 'Registrado por WhatsApp',
        });
      } else {
        await supabase.from('animales').update({ categoria: t.categoria }).eq('id', t.animalId);
      }
      await clearSession(to);
      const accion = t.nuevo ? 'registrado' : 'actualizado';
      return void sendText(
        to,
        `✅ Animal ${accion}\n🐄 Arete ${t.arete} — ${catTitle(t.categoria)}${t.nuevo ? `\nSexo: ${t.sexo === 'H' ? 'Hembra' : 'Macho'}${t.raza ? ` · Raza: ${t.raza}` : ''}` : ''}\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú*.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

async function confirmarAnimal(to: string, session: Session, t: Record<string, any>): Promise<void> {
  await saveSession({ ...session, current_step: 5, temp_data: t });
  const extra = t.nuevo
    ? `\n🆕 Nuevo · Sexo: ${t.sexo === 'H' ? 'Hembra' : 'Macho'}${t.raza ? ` · Raza: ${t.raza}` : ''}`
    : '\n♻️ Existente (solo cambia categoría)';
  return void sendButtons(
    to,
    `✅ *Confirmar*\n━━━━━━━━━━━━━━━\n🐄 Arete: ${t.arete}\n🏷️ Categoría: ${catTitle(t.categoria)}${extra}\n━━━━━━━━━━━━━━━`,
    [
      { id: 'conf:si', title: '✅ Confirmar' },
      { id: 'conf:no', title: '❌ Cancelar' },
    ],
  );
}

// =====================================================================
// Flow: Tratamiento
// step 1: arete -> step 2: diagnóstico (list) -> step 3: medicamento (list)
// -> step 4: dosis (buttons) -> step 5: vía (buttons) -> step 6: confirm -> save
// =====================================================================
async function tratamiento(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!/^[\w-]{1,15}$/.test(arete)) {
      return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    }
    t.arete = arete;
    const diag = await getCatalog('cat_diagnosticos');
    await saveSession({ ...session, current_step: 2, temp_data: t });
    return void sendList(to, `🔴 Arete *${arete}* — ¿Cuál es el diagnóstico?`, 'Elegir diagnóstico', [
      { title: 'Diagnósticos', rows: diag.map((d: any) => ({ id: `diag:${d.nombre}`, title: d.nombre })) },
    ]);
  }

  // Step 2: diagnóstico
  if (session.current_step === 2 && input.startsWith('diag:')) {
    t.diagnostico = input.slice(5);
    const meds = await getCatalog('cat_medicamentos');
    await saveSession({ ...session, current_step: 3, temp_data: t });
    return void sendList(to, `💊 ${t.diagnostico} — ¿Qué medicamento aplicaste?`, 'Elegir medicamento', [
      { title: 'Medicamentos', rows: meds.map((m: any) => ({ id: `med:${m.nombre}`, title: m.nombre })) },
    ]);
  }

  // Step 3: medicamento
  if (session.current_step === 3 && input.startsWith('med:')) {
    t.medicamento = input.slice(4);
    await saveSession({ ...session, current_step: 4, temp_data: t });
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
      await saveSession({ ...session, current_step: 4, temp_data: t });
      return void sendText(to, '✍️ Escribe la dosis (ej. 8 ml):');
    }
    let dosis = '';
    if (input.startsWith('tdosis:')) dosis = input.slice(7);
    else if (t.awaiting === 'dosis_text' && inc.kind === 'text') dosis = (inc.text || '').trim();
    else return;
    t.dosis = dosis;
    delete t.awaiting;
    await saveSession({ ...session, current_step: 5, temp_data: t });
    return void sendButtons(to, `💉 ${t.medicamento} ${t.dosis} — ¿Por qué vía?`, [
      { id: 'via:IM', title: '💪 Intramuscular' },
      { id: 'via:SC', title: 'Subcutánea' },
      { id: 'via:Oral', title: 'Oral' },
    ]);
  }

  // Step 5: vía
  if (session.current_step === 5 && input.startsWith('via:')) {
    t.via = input.slice(4);
    await saveSession({ ...session, current_step: 6, temp_data: t });
    return void sendButtons(
      to,
      `✅ *Confirmar tratamiento*\n━━━━━━━━━━━━━━━\n🐄 Arete: ${t.arete}\n🔴 Diagnóstico: ${t.diagnostico}\n💊 Medicamento: ${t.medicamento}\n💉 Dosis: ${t.dosis}\n🩹 Vía: ${t.via}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
  }

  // Step 6: confirmación
  if (session.current_step === 6) {
    if (input === 'conf:si') {
      const retiro = await saveTratamiento(t);
      await clearSession(to);
      const extra = retiro ? `\n🥛 Retiro de leche hasta: ${retiro}` : '';
      return void sendText(
        to,
        `✅ Tratamiento guardado\n🐄 Arete ${t.arete} — ${t.diagnostico}\n💊 ${t.medicamento} ${t.dosis} (${t.via})\n📅 ${today()}${extra}\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú* para empezar de nuevo.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

// Persists the treatment; computes the milk-withdrawal date from the medicine catalog.
async function saveTratamiento(t: Record<string, any>): Promise<string | null> {
  const animalId = await findOrCreateAnimal(t.arete, 'un tratamiento');

  const { data: med } = await supabase
    .from('cat_medicamentos')
    .select('retiro_horas_default')
    .eq('nombre', t.medicamento)
    .maybeSingle();

  const horas = med?.retiro_horas_default || 0;
  const retiro = horas > 0 ? addDays(Math.ceil(horas / 24)) : null;

  await supabase.from('eventos_sanitarios').insert({
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
// Flow: Pesaje
// step 1: arete -> step 2: peso (text) -> step 3: tipo (buttons)
// -> step 4: condición corporal (list, opcional) -> step 5: confirm -> save
// =====================================================================
async function pesaje(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!/^[\w-]{1,15}$/.test(arete)) {
      return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    }
    t.arete = arete;
    await saveSession({ ...session, current_step: 2, temp_data: t });
    return void sendText(to, `⚖️ Arete *${arete}* — ¿Cuántos kg pesó? (ej. 320)`);
  }

  // Step 2: peso
  if (session.current_step === 2 && inc.kind === 'text') {
    const peso = parseFloat((inc.text || '').replace(',', '.').trim());
    if (!isFinite(peso) || peso <= 0 || peso > 2000) {
      return void sendText(to, '❓ Peso inválido. Escribe solo el número en kg (ej. 320).');
    }
    t.peso = peso;
    await saveSession({ ...session, current_step: 3, temp_data: t });
    return void sendButtons(to, `⚖️ ${peso} kg — ¿Qué tipo de pesaje?`, [
      { id: 'ptipo:control', title: '📋 Control' },
      { id: 'ptipo:destete', title: '🐄 Destete' },
      { id: 'ptipo:venta', title: '💰 Venta' },
    ]);
  }

  // Step 3: tipo
  if (session.current_step === 3 && input.startsWith('ptipo:')) {
    t.tipo = input.slice(6);
    await saveSession({ ...session, current_step: 4, temp_data: t });
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
    await saveSession({ ...session, current_step: 5, temp_data: t });
    const ccTxt = t.cc ? `\n💪 Condición: ${t.cc}/5` : '';
    return void sendButtons(
      to,
      `✅ *Confirmar pesaje*\n━━━━━━━━━━━━━━━\n🐄 Arete: ${t.arete}\n⚖️ Peso: ${t.peso} kg\n📋 Tipo: ${t.tipo}${ccTxt}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
  }

  // Step 5: confirmación
  if (session.current_step === 5) {
    if (input === 'conf:si') {
      await savePesaje(t);
      await clearSession(to);
      const ccTxt = t.cc ? ` · CC ${t.cc}/5` : '';
      return void sendText(
        to,
        `✅ Pesaje guardado\n🐄 Arete ${t.arete} — ${t.peso} kg (${t.tipo})${ccTxt}\n📅 ${today()}\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú* para empezar de nuevo.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

// Persists the weighing record.
async function savePesaje(t: Record<string, any>): Promise<void> {
  const animalId = await findOrCreateAnimal(t.arete, 'un pesaje');
  await supabase.from('pesajes').insert({
    animal_id: animalId,
    fecha: today(),
    peso_kg: t.peso,
    tipo: t.tipo,
    condicion_corporal: t.cc ?? null,
  });
}

// Finds an animal by arete (read-only). Returns null when it doesn't exist.
async function findAnimal(arete: string): Promise<any | null> {
  const { data } = await supabase
    .from('animales')
    .select('id, arete, nombre, sexo, raza, categoria, estado, estado_reproductivo')
    .eq('arete', arete)
    .maybeSingle();
  return data;
}

const validArete = (s: string) => /^[\w-]{1,15}$/.test(s);

// =====================================================================
// Flow: Desparasitación
// step 1: arete -> step 2: producto (buttons + "Otra") -> step 3: dosis (buttons)
// -> step 4: confirm -> save (tipo desparasitacion, próxima en +90 días)
// =====================================================================
async function desparasitacion(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    t.arete = arete;
    await saveSession({ ...session, current_step: 2, temp_data: t });
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
      await saveSession({ ...session, current_step: 2, temp_data: t });
      return void sendText(to, '✍️ Escribe el nombre del producto:');
    }
    let prod = '';
    if (input.startsWith('desp:')) prod = input.slice(5);
    else if (t.awaiting === 'prod_text' && inc.kind === 'text') prod = (inc.text || '').trim();
    else return;
    t.producto = prod;
    delete t.awaiting;
    await saveSession({ ...session, current_step: 3, temp_data: t });
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
      await saveSession({ ...session, current_step: 3, temp_data: t });
      return void sendText(to, '✍️ Escribe la dosis (ej. 8 ml):');
    }
    let dosis = '';
    if (input.startsWith('dosis:')) dosis = input.slice(6);
    else if (t.awaiting === 'dosis_text' && inc.kind === 'text') dosis = (inc.text || '').trim();
    else return;
    t.dosis = dosis;
    delete t.awaiting;
    await saveSession({ ...session, current_step: 4, temp_data: t });
    return void sendButtons(
      to,
      `✅ *Confirmar desparasitación*\n━━━━━━━━━━━━━━━\n🐄 Arete: ${t.arete}\n🪱 Producto: ${t.producto}\n💊 Dosis: ${t.dosis}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
  }

  // Step 4: confirmación
  if (session.current_step === 4) {
    if (input === 'conf:si') {
      const proxima = await saveDesparasitacion(t);
      await clearSession(to);
      return void sendText(
        to,
        `✅ Desparasitación guardada\n🐄 Arete ${t.arete} — ${t.producto} ${t.dosis}\n📅 ${today()}\n⏭ Próxima sugerida: ${proxima}\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú* para empezar de nuevo.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

async function saveDesparasitacion(t: Record<string, any>): Promise<string> {
  const animalId = await findOrCreateAnimal(t.arete, 'una desparasitación');
  const { data: med } = await supabase
    .from('cat_medicamentos')
    .select('retiro_horas_default')
    .eq('nombre', t.producto)
    .maybeSingle();
  const horas = med?.retiro_horas_default || 0;
  const retiro = horas > 0 ? addDays(Math.ceil(horas / 24)) : null;
  const proxima = addDays(90); // dewormings are typically every ~3 months
  await supabase.from('eventos_sanitarios').insert({
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

// =====================================================================
// Flow: Reproducción — Servicio (IA o monta)
// step 1: arete -> step 2: método -> step 3: (IA: inseminador | monta: toro)
// -> step 4 (IA: pajilla) -> confirm -> save
// =====================================================================
async function reproServicio(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  const confirmar = async () => {
    await saveSession({ ...session, current_step: 5, temp_data: t });
    const det = t.metodo === 'IA'
      ? `🧪 Método: IA\n👨‍🔬 Inseminador: ${t.inseminador}\n🧬 Pajilla: ${t.pajilla || '—'}`
      : `🐂 Método: Monta\n🐂 Toro: ${t.toro || '—'}`;
    return void sendButtons(
      to,
      `✅ *Confirmar servicio*\n━━━━━━━━━━━━━━━\n🐄 Vaca: ${t.arete}\n${det}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
  };

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    t.arete = arete;
    await saveSession({ ...session, current_step: 2, temp_data: t });
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
      await saveSession({ ...session, current_step: 3, temp_data: t });
      return void sendList(to, '👨‍🔬 ¿Quién inseminó?', 'Elegir', [
        { title: 'Inseminador', rows: tecnicos.map((x: any) => ({ id: `insem:${x.nombre}`, title: x.nombre })) },
      ]);
    }
    t.awaiting = 'toro';
    await saveSession({ ...session, current_step: 3, temp_data: t });
    return void sendText(to, '🐂 Escribe el arete del toro (o escribe *NINGUNO*):');
  }

  // Step 3: IA -> inseminador ; monta -> toro (texto)
  if (session.current_step === 3) {
    if (t.metodo === 'IA' && input.startsWith('insem:')) {
      t.inseminador = input.slice(6);
      await saveSession({ ...session, current_step: 4, temp_data: t });
      return void sendText(to, '🧬 Escribe el código de la pajilla/semen (o escribe *NINGUNO*):');
    }
    if (t.metodo === 'monta' && inc.kind === 'text') {
      const v = (inc.text || '').trim();
      t.toro = /^ninguno$/i.test(v) ? null : v;
      return confirmar();
    }
    return;
  }

  // Step 4: IA -> pajilla
  if (session.current_step === 4 && t.metodo === 'IA' && inc.kind === 'text') {
    const v = (inc.text || '').trim();
    t.pajilla = /^ninguno$/i.test(v) ? null : v;
    return confirmar();
  }

  // Step 5: confirmación
  if (session.current_step === 5) {
    if (input === 'conf:si') {
      await saveServicio(t);
      await clearSession(to);
      return void sendText(
        to,
        `✅ Servicio guardado\n🐄 Vaca ${t.arete} — ${t.metodo === 'IA' ? 'IA' : 'Monta'}\n📅 ${today()}\n🔖 Estado: servida\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú*.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

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
// Flow: Reproducción — Diagnóstico de preñez
// step 1: arete -> step 2: resultado -> confirm -> save
// =====================================================================
async function reproDxPrenez(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    t.arete = arete;
    await saveSession({ ...session, current_step: 2, temp_data: t });
    return void sendButtons(to, `🔍 Vaca *${arete}* — ¿Resultado del diagnóstico?`, [
      { id: 'dx:prenada', title: '🤰 Preñada' },
      { id: 'dx:vacia', title: '⭕ Vacía' },
    ]);
  }

  // Step 2: resultado
  if (session.current_step === 2 && input.startsWith('dx:')) {
    t.resultado = input.slice(3); // 'prenada' | 'vacia'
    await saveSession({ ...session, current_step: 3, temp_data: t });
    return void sendButtons(
      to,
      `✅ *Confirmar diagnóstico*\n━━━━━━━━━━━━━━━\n🐄 Vaca: ${t.arete}\n🔍 Resultado: ${t.resultado === 'prenada' ? 'PREÑADA 🤰' : 'VACÍA ⭕'}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
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
        `✅ Diagnóstico guardado\n🐄 Vaca ${t.arete} — ${t.resultado === 'prenada' ? 'PREÑADA 🤰' : 'VACÍA ⭕'}\n📅 ${today()}\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú*.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

// =====================================================================
// Flow: Reproducción — Parto (crea la cría y la enlaza a la madre)
// step 1: arete madre -> step 2: sexo cría -> step 3: arete cría
// -> step 4: peso cría (texto o NINGUNO) -> confirm -> save
// =====================================================================
async function reproParto(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete madre
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    t.madre = arete;
    await saveSession({ ...session, current_step: 2, temp_data: t });
    return void sendButtons(to, `🍼 Madre *${arete}* — ¿Sexo de la cría?`, [
      { id: 'sexo:H', title: '🐄 Hembra' },
      { id: 'sexo:M', title: '🐂 Macho' },
    ]);
  }

  // Step 2: sexo cría
  if (session.current_step === 2 && input.startsWith('sexo:')) {
    t.sexo = input.slice(5); // 'H' | 'M'
    await saveSession({ ...session, current_step: 3, temp_data: t });
    return void sendText(to, '🏷️ Escribe el arete de la cría: (ej. 201)');
  }

  // Step 3: arete cría
  if (session.current_step === 3 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 201).');
    t.cria = arete;
    await saveSession({ ...session, current_step: 4, temp_data: t });
    return void sendText(to, '⚖️ Peso de la cría al nacer en kg (o escribe *NINGUNO*):');
  }

  // Step 4: peso cría
  if (session.current_step === 4 && inc.kind === 'text') {
    const v = (inc.text || '').trim();
    if (/^ninguno$/i.test(v)) {
      t.peso = null;
    } else {
      const p = parseFloat(v.replace(',', '.'));
      if (!isFinite(p) || p <= 0 || p > 100) return void sendText(to, '❓ Peso inválido. Escribe el número en kg (ej. 32) o *NINGUNO*.');
      t.peso = p;
    }
    await saveSession({ ...session, current_step: 5, temp_data: t });
    return void sendButtons(
      to,
      `✅ *Confirmar parto*\n━━━━━━━━━━━━━━━\n🐄 Madre: ${t.madre}\n🍼 Cría: ${t.cria} (${t.sexo === 'H' ? 'Hembra' : 'Macho'})\n⚖️ Peso: ${t.peso ? t.peso + ' kg' : '—'}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
  }

  // Step 5: confirmación
  if (session.current_step === 5) {
    if (input === 'conf:si') {
      await saveParto(t);
      await clearSession(to);
      return void sendText(
        to,
        `✅ Parto guardado\n🐄 Madre ${t.madre} — parida\n🍼 Cría ${t.cria} (${t.sexo === 'H' ? 'Hembra' : 'Macho'}) registrada\n📅 ${today()}\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú*.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

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

// =====================================================================
// Flow: Mortalidad (registra la baja y marca el animal como muerto)
// step 1: arete -> step 2: causa (list) -> confirm -> save
// =====================================================================
async function mortalidad(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  const input = (inc.id || inc.text || '').trim();
  const t = session.temp_data;

  // Step 1: arete
  if (session.current_step === 1 && inc.kind === 'text') {
    const arete = (inc.text || '').trim();
    if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');
    t.arete = arete;
    const causas = await getCatalog('cat_causas_mortalidad');
    await saveSession({ ...session, current_step: 2, temp_data: t });
    return void sendList(to, `💀 Arete *${arete}* — ¿Cuál fue la causa?`, 'Elegir causa', [
      { title: 'Causas', rows: causas.map((c: any) => ({ id: `causa:${c.nombre}`, title: c.nombre })) },
    ]);
  }

  // Step 2: causa
  if (session.current_step === 2 && input.startsWith('causa:')) {
    t.causa = input.slice(6);
    await saveSession({ ...session, current_step: 3, temp_data: t });
    return void sendButtons(
      to,
      `⚠️ *Confirmar baja*\n━━━━━━━━━━━━━━━\n🐄 Arete: ${t.arete}\n💀 Causa: ${t.causa}\n📅 Fecha: ${today()}\n━━━━━━━━━━━━━━━\n⚠️ El animal quedará marcado como *muerto*.`,
      [
        { id: 'conf:si', title: '✅ Confirmar' },
        { id: 'conf:no', title: '❌ Cancelar' },
      ],
    );
  }

  // Step 3: confirmación
  if (session.current_step === 3) {
    if (input === 'conf:si') {
      const animalId = await findOrCreateAnimal(t.arete, 'una baja');
      await supabase.from('movimientos').insert({
        animal_id: animalId,
        tipo: 'muerte',
        fecha: today(),
        notas: `Causa: ${t.causa}`,
      });
      await supabase.from('animales').update({ estado: 'muerto' }).eq('id', animalId);
      await clearSession(to);
      return void sendText(
        to,
        `✅ Baja registrada\n🐄 Arete ${t.arete} — ${t.causa}\n📅 ${today()}\n🔖 Estado: muerto\n\nEscribe *menú* para otro registro.`,
      );
    }
    if (input === 'conf:no') {
      await clearSession(to);
      return void sendText(to, '❌ Cancelado. No se guardó nada.\nEscribe *menú*.');
    }
    return;
  }

  await clearSession(to);
  return void sendText(to, '⚠️ Se perdió el hilo. Escribe *menú* para reiniciar.');
}

// =====================================================================
// Consulta: Ver animal — ficha + últimos eventos
// =====================================================================
async function consultaVerAnimal(inc: Incoming, session: Session): Promise<void> {
  const to = inc.from;
  if (session.current_step !== 1 || inc.kind !== 'text') {
    await clearSession(to);
    return void sendText(to, '⚠️ Escribe *menú* para reiniciar.');
  }
  const arete = (inc.text || '').trim();
  if (!validArete(arete)) return void sendText(to, '❓ Arete inválido. Escribe solo el número/código (ej. 045).');

  const animal = await findAnimal(arete);
  await clearSession(to);
  if (!animal) {
    return void sendText(to, `🐄 No encontré ningún animal con arete *${arete}*.\n\nEscribe *menú* para volver.`);
  }

  const { data: hist } = await supabase
    .from('vw_historial_animal')
    .select('fecha, categoria, evento, descripcion')
    .eq('animal_id', animal.id)
    .order('fecha', { ascending: false })
    .limit(8);

  const iconos: Record<string, string> = {
    sanitario: '🩺', pesaje: '⚖️', reproductivo: '🍼', produccion_leche: '🥛', movimiento: '📦',
  };
  const lineas = (hist || []).length
    ? (hist || []).map((h: any) => `${iconos[h.categoria] || '•'} ${h.fecha} — ${h.evento}: ${h.descripcion || ''}`.trim()).join('\n')
    : '_Sin eventos registrados aún._';

  const ficha =
    `🐄 *Animal ${animal.arete}*${animal.nombre ? ` — ${animal.nombre}` : ''}\n` +
    `Sexo: ${animal.sexo === 'H' ? 'Hembra' : 'Macho'}${animal.raza ? ` · Raza: ${animal.raza}` : ''}\n` +
    `Estado: ${animal.estado}${animal.estado_reproductivo ? ` · Repro: ${animal.estado_reproductivo}` : ''}\n` +
    `━━━━━━━━━━━━━━━\n📜 *Últimos eventos:*\n${lineas}\n\nEscribe *menú* para volver.`;

  return void sendText(to, ficha);
}

// =====================================================================
// Consulta: Alertas activas (próximas/vencidas + retiros de leche)
// =====================================================================
async function showAlertas(to: string): Promise<void> {
  const limite = addDays(7);
  const { data: prox } = await supabase
    .from('eventos_sanitarios')
    .select('tipo, producto, proxima_fecha, animales(arete)')
    .lte('proxima_fecha', limite)
    .order('proxima_fecha', { ascending: true })
    .limit(15);

  const { data: retiros } = await supabase
    .from('eventos_sanitarios')
    .select('producto, retiro_leche_hasta, animales(arete)')
    .gte('retiro_leche_hasta', today())
    .order('retiro_leche_hasta', { ascending: true })
    .limit(15);

  const proxLineas = (prox || []).length
    ? (prox || []).map((p: any) => {
        const vencida = p.proxima_fecha < today();
        return `${vencida ? '🔴' : '🟡'} Arete ${p.animales?.arete || '?'} — ${p.tipo} (${p.producto || ''}) → ${p.proxima_fecha}`;
      }).join('\n')
    : '_Nada próximo en 7 días._';

  const retLineas = (retiros || []).length
    ? (retiros || []).map((r: any) => `🥛 Arete ${r.animales?.arete || '?'} — ${r.producto || ''} hasta ${r.retiro_leche_hasta}`).join('\n')
    : '_Sin retiros de leche activos._';

  await sendText(
    to,
    `⚠️ *Alertas activas*\n━━━━━━━━━━━━━━━\n📅 *Próximas / vencidas (7 días):*\n${proxLineas}\n\n🥛 *Retiro de leche vigente:*\n${retLineas}\n\nEscribe *menú* para volver.`,
  );
}

// =====================================================================
// Consulta: Resumen del día (lo registrado hoy)
// =====================================================================
async function showResumen(to: string): Promise<void> {
  const hoy = today();
  const countWhere = async (table: string, extra: Record<string, string> = {}) => {
    let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('fecha', hoy);
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
    const { count } = await q;
    return count || 0;
  };

  const [vac, trat, desp, pes, serv, dx, parto, muertes] = await Promise.all([
    countWhere('eventos_sanitarios', { tipo: 'vacuna' }),
    countWhere('eventos_sanitarios', { tipo: 'tratamiento' }),
    countWhere('eventos_sanitarios', { tipo: 'desparasitacion' }),
    countWhere('pesajes'),
    countWhere('eventos_reproductivos', { tipo: 'servicio' }),
    countWhere('eventos_reproductivos', { tipo: 'diagnostico_prenez' }),
    countWhere('eventos_reproductivos', { tipo: 'parto' }),
    countWhere('movimientos', { tipo: 'muerte' }),
  ]);

  await sendText(
    to,
    `📋 *Resumen del día* (${hoy})\n━━━━━━━━━━━━━━━\n💉 Vacunaciones: ${vac}\n🔴 Tratamientos: ${trat}\n🪱 Desparasitaciones: ${desp}\n⚖️ Pesajes: ${pes}\n🐂 Servicios: ${serv}\n🔍 Dx preñez: ${dx}\n🍼 Partos: ${parto}\n💀 Bajas: ${muertes}\n━━━━━━━━━━━━━━━\nEscribe *menú* para volver.`,
  );
}
