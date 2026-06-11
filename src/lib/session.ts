import { supabase } from './supabase';

// Per-user conversational state machine. Sessions expire after 30 min idle.
export type Session = {
  telefono: string;
  current_flow: string | null;
  current_step: number;
  temp_data: Record<string, any>;
};

const EXPIRE_MIN = 30;

function empty(telefono: string): Session {
  return { telefono, current_flow: null, current_step: 0, temp_data: {} };
}

export async function getSession(telefono: string): Promise<Session> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('telefono', telefono)
    .maybeSingle();

  if (!data) return empty(telefono);

  const ageMin = (Date.now() - new Date(data.updated_at).getTime()) / 60000;
  if (ageMin > EXPIRE_MIN) return empty(telefono);

  return {
    telefono,
    current_flow: data.current_flow,
    current_step: data.current_step ?? 0,
    temp_data: data.temp_data ?? {},
  };
}

export async function saveSession(s: Session): Promise<void> {
  await supabase.from('whatsapp_sessions').upsert({
    telefono: s.telefono,
    current_flow: s.current_flow,
    current_step: s.current_step,
    temp_data: s.temp_data,
    updated_at: new Date().toISOString(),
  });
}

export async function clearSession(telefono: string): Promise<void> {
  await saveSession(empty(telefono));
}
