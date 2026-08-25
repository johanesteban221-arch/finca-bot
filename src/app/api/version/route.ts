// GET /api/version — qué imagen está corriendo ahora mismo.
//
// Existe porque «¿ya se desplegó mi commit?» no se podía responder desde afuera:
// `/` devuelve un HTML fijo y la imagen no marcaba su versión por ningún lado, así
// que un contenedor viejo y uno nuevo se veían idénticos.
//
// Público a propósito, y por eso devuelve lo MÍNIMO: el commit, cuándo se
// construyó y cuándo arrancó. Nada de variables de entorno, nada de configuración.
// Si algún día el SHA molesta, se protege igual que los crons — `?secret=CRON_SECRET`.
//
// `arrancadoEn` no es lo mismo que `construidoEn` y esa diferencia es el
// diagnóstico: misma imagen con arranque reciente = se reinició el contenedor,
// no se desplegó nada nuevo.

import { NextResponse } from 'next/server';
import { BUILD_INFO } from '@/lib/build-info';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Instante en que se cargó el módulo, es decir, el arranque del proceso. Es UTC
// puro y NO pasa por dates.ts: no es una fecha de calendario de la finca.
const ARRANCADO_EN = new Date().toISOString();

export async function GET() {
  return NextResponse.json(
    {
      sha: BUILD_INFO.sha,
      construidoEn: BUILD_INFO.construidoEn,
      arrancadoEn: ARRANCADO_EN,
      ahora: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
