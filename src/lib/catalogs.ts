import { supabase } from './supabase';

// Selectable options the admin maintains from the dashboard. The bot serves them
// dynamically so adding a vaccine/medicine never requires a code change.
export async function getCatalog(table: string): Promise<any[]> {
  const { data } = await supabase
    .from(table)
    .select('*')
    .eq('activo', true)
    .order('orden', { ascending: true });
  return data ?? [];
}
