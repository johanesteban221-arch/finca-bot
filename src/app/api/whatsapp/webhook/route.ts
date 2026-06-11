import { NextRequest, NextResponse } from 'next/server';
import { parseIncoming } from '@/lib/whatsapp';
import { handleMessage } from '@/lib/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Meta webhook verification (GET).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get('hub.mode');
  const token = p.get('hub.verify_token');
  const challenge = p.get('hub.challenge') ?? '';
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

// Incoming messages (POST). Ack fast, then run the state machine.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const inc = parseIncoming(body);
  if (inc?.from) {
    try {
      await handleMessage(inc);
    } catch (e) {
      console.error('[webhook] handler error', e);
    }
  }
  return NextResponse.json({ ok: true });
}
