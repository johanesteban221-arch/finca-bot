import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Tables included in the daily backup (domain data + catalogs).
// Transient tables (whatsapp_sessions, confirmaciones_pendientes) are intentionally skipped.
const TABLES = [
  'animales',
  'eventos_sanitarios',
  'eventos_reproductivos',
  'pesajes',
  'movimientos',
  'produccion_leche',
  'whatsapp_users',
  'cat_vacunas',
  'cat_medicamentos',
  'cat_diagnosticos',
  'cat_razas',
  'cat_tecnicos',
  'cat_causas_mortalidad',
];

// Daily backup. Triggered by n8n (Schedule -> HTTP) which then uploads the JSON to Drive.
// Protected by ?secret=CRON_SECRET. Returns a full dump of all domain tables.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const generated_at = new Date().toISOString();
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const table of TABLES) {
    const { data: rows, error } = await supabase.from(table).select('*').limit(50000);
    if (error) {
      data[table] = [];
      counts[table] = -1; // signal a read error for this table without failing the whole backup
      continue;
    }
    data[table] = rows || [];
    counts[table] = rows?.length || 0;
  }

  return NextResponse.json(
    { backup_version: 1, generated_at, counts, data },
    { headers: { 'Content-Disposition': `attachment; filename="finca-backup-${generated_at.slice(0, 10)}.json"` } },
  );
}
