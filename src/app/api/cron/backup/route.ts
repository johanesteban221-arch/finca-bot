import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUCKET = 'backups';

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

// Daily backup. Triggered by n8n (Schedule -> HTTP) at 01:00 America/Bogota.
// Protected by ?secret=CRON_SECRET. Dumps all domain tables to JSON and stores the
// file in a private Supabase Storage bucket ("backups/finca-backup-YYYY-MM-DD.json").
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

  const payload = { backup_version: 1, generated_at, counts, data };
  const fileName = `finca-backup-${generated_at.slice(0, 10)}.json`;
  const body = JSON.stringify(payload, null, 2);

  // Ensure the private bucket exists (ignore "already exists"), then upload (overwrite same day).
  await supabase.storage.createBucket(BUCKET, { public: false });
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, body, { contentType: 'application/json', upsert: true });

  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message, counts }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    stored: `${BUCKET}/${fileName}`,
    size_bytes: body.length,
    counts,
  });
}
