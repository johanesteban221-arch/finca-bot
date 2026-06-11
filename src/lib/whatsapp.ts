// WhatsApp Cloud API client + incoming-message parser.
// Respects Meta limits: button title <=20, list row title <=24, section title <=24,
// list button <=20, max 10 rows total across sections.

const GRAPH = 'https://graph.facebook.com/v21.0';

function cfg() {
  return {
    pnid: process.env.WHATSAPP_PHONE_NUMBER_ID!,
    token: process.env.WHATSAPP_TOKEN!,
  };
}

async function send(payload: Record<string, unknown>): Promise<boolean> {
  const { pnid, token } = cfg();
  const res = await fetch(`${GRAPH}/${pnid}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
  });
  if (!res.ok) {
    console.error('[whatsapp] send error', res.status, await res.text());
    return false;
  }
  return true;
}

export function sendText(to: string, body: string) {
  return send({ to, type: 'text', text: { body, preview_url: false } });
}

// Sends an approved template message — the only way to reach a user OUTSIDE the
// 24h customer-service window (used by the daily alerts cron at 6 AM).
export function sendTemplate(to: string, name: string, lang: string, bodyParams: string[]) {
  return send({
    to,
    type: 'template',
    template: {
      name,
      language: { code: lang },
      components: bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
        : [],
    },
  });
}

export type Button = { id: string; title: string };

export function sendButtons(to: string, body: string, buttons: Button[]) {
  return send({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

export type Row = { id: string; title: string; description?: string };
export type Section = { title?: string; rows: Row[] };

export function sendList(to: string, body: string, buttonText: string, sections: Section[]) {
  // Cap total rows at 10 (Meta limit), preserving section grouping.
  let remaining = 10;
  const trimmed = sections
    .map((s) => {
      const rows = s.rows.slice(0, Math.max(0, remaining));
      remaining -= rows.length;
      return { title: s.title?.slice(0, 24), rows: rows.map((r) => ({
        id: r.id,
        title: r.title.slice(0, 24),
        ...(r.description ? { description: r.description.slice(0, 72) } : {}),
      })) };
    })
    .filter((s) => s.rows.length > 0);

  return send({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: { button: buttonText.slice(0, 20), sections: trimmed },
    },
  });
}

// ---------- Incoming parsing ----------
export type Incoming = {
  from: string;
  kind: 'text' | 'button' | 'list' | 'other';
  text?: string;
  id?: string;
  title?: string;
};

export function parseIncoming(body: any): Incoming | null {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg || !msg.from) return null; // ignore status callbacks
  const from = msg.from as string;

  if (msg.type === 'text') return { from, kind: 'text', text: msg.text?.body || '' };

  if (msg.type === 'interactive') {
    const it = msg.interactive;
    if (it?.type === 'button_reply') {
      return { from, kind: 'button', id: it.button_reply.id, title: it.button_reply.title };
    }
    if (it?.type === 'list_reply') {
      return { from, kind: 'list', id: it.list_reply.id, title: it.list_reply.title };
    }
  }
  return { from, kind: 'other' };
}
