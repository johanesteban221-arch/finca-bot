# CLAUDE.md — Ganadería Bovina Doble Propósito (GDP)

## Project purpose
WhatsApp bot + web dashboard for managing a **dual-purpose cattle herd** (milk + beef):
reproduction, milk production, health events, weigh-ins, genealogy, with per-animal
traceability. Includes daily alerts and automated backups.

**Product vision:** Built first as the founder's own farm management tool (cliente cero).
Target: SaaS for Colombian cattle farmers. ~460k registered farms, 85% without software.
**Key differentiator:** WhatsApp interactive templates as the primary data-entry channel —
no competitor has this.

This system is deliberately **isolated** from the "Granja El Redil" pig system: `GDP ·`
workflow prefix, its own database, dedicated WhatsApp number, and the `gdp-whatsapp`
webhook path. Never cross-wire the two.

## Communication
- Talk to the user in **Spanish**. Keep this file and code/config in English.

## Roadmap
| Phase | Status | What it includes |
|---|---|---|
| **Phase 0 — Cliente cero** | 🟡 Active | System running on founder's own farm. Single tenant. Real-world validation. |
| **Phase 1 — SaaS MVP** | ⬜ Pending | Multi-farm onboarding, super-admin panel, Stripe billing, shared WhatsApp number |
| **Phase 2 — SaaS scaled** | ⬜ Pending | Per-client WhatsApp number, custom catalogs, cross-farm benchmarks, mobile app |

The jump from Phase 0 to Phase 1 **requires no rewrite** if the multi-tenant architecture
decisions below are respected from day 1.

---

## Repository layout
The whole project is one git repo (remote: `github.com/johanesteban221-arch/finca-bot`,
auto-deploys from `main` to Easypanel). **This file lives at the repo root; all paths below
are relative to it.**

| Path | Contents |
|---|---|
| `src/` | Next.js 15 app — the active bot |
| `db/` | Plain SQL for the Supabase SQL Editor |
| `workflows/` | n8n workflow JSON (`GDP · WF-NN`) |
| `docs/` | `README-ganaderia.md` and guides |

✅ Everything is under version control and backed up on GitHub. (Historically `db/`,
`workflows/` and `docs/` were untracked and unbacked-up — that is resolved.)

---

## Architecture — read this before changing anything

### Source of truth: finca-bot
**`finca-bot/` (Next.js) is the source of truth.** The bifurcation between finca-bot and
n8n is resolved:
- `WF-00`, `WF-01` — **active**, maintained in n8n
- `WF-02`, `WF-03` — **superseded** by the app's cron endpoints. ⚠️ The JSON files still
  exist in `workflows/` and that folder has no version control — do not delete them without
  asking; deletion is irreversible. Deactivate in n8n instead.
- `docs/README-ganaderia.md` — still describes the n8n path as primary and never mentions
  `finca-bot`. Needs a rewrite (pending).

Do not add new business logic to n8n. All new features go in `finca-bot/`.

### WhatsApp bot: interactive templates only
The bot runs on **100% interactive templates** (buttons + selection lists). Zero free-text
input except animal tag numbers (aretes) and numeric quantities. All flows are deterministic
state machines — no LLM is used to parse incoming messages. ✅ This is how `finca-bot` works today.

**Claude API for owner queries + anomaly detection — 🎯 TARGET, NOT BUILT.**
> **Status:** no Anthropic SDK in `package.json`, no Claude call anywhere in `finca-bot/`.
> The only LLM in the system today is OpenAI (intent parsing + Whisper) inside n8n `WF-01`.

### Milk production: hardware only — 🎯 TARGET, NOT BUILT
> **Status:** the endpoint does not exist yet. Today the app exposes only 3 API routes
> (whatsapp/webhook, cron/daily-alerts, cron/backup). There is no `X-Device-Key` auth
> and no manual milk-entry path either — `produccion_leche` has no writer at all.

Intended design: no WhatsApp flow or web form for manual milk entry. Only the ESP32 device
via `/api/hardware/milk-record` with `X-Device-Key` header auth.

### Key files
- `src/lib/handler.ts` (~115 lines) — orchestrator: auth, global shortcuts, routing tables. No step logic.
- `src/app/api/whatsapp/webhook/route.ts` — Meta webhook (GET verify + POST).
- `src/app/api/cron/daily-alerts/route.ts`, `.../cron/backup/route.ts` — guarded by `CRON_SECRET`.
- `src/middleware.ts` — Basic Auth on `/dashboard`; fail-closed (503 if password missing). Keep it that way.

### Bot file structure — ✅ done (handler.ts refactor)
```
src/lib/
  handler.ts            ← orchestrator: auth, shortcuts, MENU_FLOWS/MENU_ACTIONS/FLOWS tables
  state-machine.ts      ← Flow type, step helpers, shared UI + message constants
  menu.ts               ← main menu (separate so flows can fall back without an import cycle)
  animals.ts            ← findAnimal / findOrCreateAnimal / CATEGORIAS
  flows/
    animal.ts           ← registrar / categorizar animal
    salud.ts            ← pick + vacunación, tratamiento, desparasitación
    reproduccion.ts     ← pick + servicio, dx preñez, parto
    pesaje.ts
    mortalidad.ts
    consultas.ts        ← verAnimal (flow) + showAlertas / showResumen (actions)
```

**Flow contract:** every flow exports a `Flow` = `{ start, handle }`. `start` is called when
the user picks it from the menu (sets `current_flow` and sends the first prompt); `handle`
receives every subsequent message and branches on `session.current_step`. To add a flow:
write the module, then register it in `handler.ts`'s `MENU_FLOWS` + `FLOWS`.

---

## Multi-tenant architecture — 🎯 TARGET, NOT BUILT (CRITICAL, do not skip)

> **Status: none of this exists in the live schema yet.** No `fincas` table, no `finca_id`
> column on any table, no RLS enabled anywhere, no `whatsapp_user_fincas`. The real
> `whatsapp_users` today is `(telefono PK, nombre, rol, activo)` — a flat single-tenant
> shape, not the N:M below. The SQL in this section is the **decided design to implement**
> (pending task #2), not a description of the database.

These decisions are made now even though there is only one tenant (Phase 0). Changing them
later means rewriting schema + all queries + all RLS policies.

### 1. `fincas` table as system root
```sql
CREATE TABLE IF NOT EXISTS fincas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  nit           TEXT,
  municipio     TEXT,
  departamento  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
-- Phase 0: one row only (the founder's farm)
```

### 2. `finca_id` on every data table
All tables — `animales`, `eventos_sanitarios`, `pesajes`, `eventos_reproductivos`,
`produccion_leche`, `movimientos`, `confirmaciones_pendientes` — must have:
```sql
finca_id UUID NOT NULL REFERENCES fincas(id)
```

### 3. Supabase RLS by `finca_id` from day 1
```sql
ALTER TABLE animales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON animales
  USING (finca_id = current_setting('app.finca_id')::uuid);
-- Phase 0: set hardcoded. Phase 1: comes from the user's JWT.
```

### 4. `whatsapp_users` is N:M with `fincas`
A phone number can belong to multiple farms (external vet, owner with multiple farms).
```sql
CREATE TABLE whatsapp_users (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone   TEXT NOT NULL UNIQUE,
  nombre  TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE whatsapp_user_fincas (
  user_id   UUID REFERENCES whatsapp_users(id),
  finca_id  UUID REFERENCES fincas(id),
  rol       TEXT CHECK (rol IN ('dueño','admin','veterinario','vaquero')),
  PRIMARY KEY (user_id, finca_id)
);
```

### 5. Catalogs: global + per-farm
`cat_vacunas`, `cat_medicamentos`, `cat_diagnosticos`, etc. have nullable `finca_id`:
- `finca_id IS NULL` → global (available to all farms)
- `finca_id = X` → only for that farm

---

## Database

Apply SQL in this order in the Supabase SQL Editor (all files now live in `db/`):
`db/schema.sql` → `db/alerts_views.sql` → `db/backup.sql` → `db/01_bot_schema.sql`
→ `db/02_multitenant.sql`

**No versioned migrations** — SQL is idempotent (`CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE VIEW`). Preserve that idempotency in any new SQL.

### Tables
`✅` = exists today · `🎯` = target, not built

```
-- Multi-tenant root
🎯 fincas

-- Cattle data (finca_id column is 🎯 on all of them)
✅ animales · eventos_reproductivos · produccion_leche
✅ eventos_sanitarios · pesajes · movimientos · confirmaciones_pendientes

-- Bot
✅ whatsapp_users (flat shape today) · whatsapp_sessions
🎯 whatsapp_user_fincas
✅ cat_vacunas · cat_medicamentos · cat_diagnosticos
✅ cat_razas · cat_tecnicos · cat_causas_mortalidad

-- Views
✅ vw_historial_animal · vw_alertas · vw_respaldo_completo
```

### WhatsApp session state machine
```typescript
// whatsapp_sessions — one row per active user
{
  telefono:     string    // ✅ user's phone number (column is `telefono`, not `phone`)
  finca_id:     uuid      // 🎯 active tenant — column does not exist yet
  current_flow: string    // ✅
  current_step: number    // ✅ 1, 2, 3...
  temp_data:    jsonb     // ✅ accumulated flow data
  expires_at:   timestamp // 🎯 no TTL implemented yet — sessions never auto-expire
}
```
### Available flows
`✅` = implemented today · `🎯` = target, not built. Real flow id in parens when it differs
from the naming scheme above.

```
✅ salud.vacunacion · salud.tratamiento · salud.desparasitacion
✅ salud.pick — sub-menu that routes into the three above
✅ reproduccion.servicio (covers both IA and monta) · reproduccion.dxprenez
✅ reproduccion.parto · reproduccion.pick — sub-menu
🎯 reproduccion.celo — not implemented
✅ pesaje (individual)          🎯 pesaje.lote
✅ mortalidad
✅ animal — registrar + categorizar in one flow (branches on whether the arete exists)
✅ consulta.ver — animal record + last 8 events
✅ alertas + resumen — immediate actions, not flows (no session state)
🎯 consulta.produccion — not implemented
```

---

## Stack
- **App:** Next.js 15.1.6 (App Router) + React 19 + TypeScript 5.7, `output: 'standalone'`
- **DB:** Supabase (Postgres) via `@supabase/supabase-js`, `service_role` key
- **Messaging:** Meta WhatsApp Cloud API — interactive templates only
- **AI:** 🎯 Claude API (Anthropic) — owner open queries + anomaly detection only (not integrated yet; OpenAI inside n8n WF-01 is what runs today)
- **Orchestration:** self-hosted n8n — WF-00 and WF-01 only
- **Hardware:** 🎯 ESP32 + HX711 + RFID FDX-B — automatic milk measurement (no endpoint yet)
- **Deploy:** Docker multi-stage (node:22-alpine, non-root, port 3000) on **Easypanel**,
  auto-deploy from GitHub `main`. See `DEPLOY.md`.

---

## Pending tasks — attack in this order
- [x] ~~**1. Refactor `handler.ts`**~~ — done: 1290 lines → orchestrator + 6 flow modules
- [ ] **2. Add `finca_id` to schema** — modify `db/schema.sql`, activate RLS on all tables
- [x] ~~**3. Version `db/` and `workflows/`**~~ — done: moved into the repo, backed up on GitHub
- [ ] **4. Tests on critical flows** — minimum integration tests for health and reproduction flows
- [ ] **5. Meta template approval** — start Meta approval process for proactive alert templates

---

## Secrets — hard rules
- **`.env.local` holds live production credentials** (Supabase `service_role` JWT,
  Meta token, `CRON_SECRET`, `DASHBOARD_PASSWORD`). It is gitignored. **Never read it into
  context, never print its values, never paste them into a workflow or commit.**
- Only `.env.example` is tracked. Keep it that way.
- Secrets belong in Easypanel env vars and n8n credentials — never hardcoded.

---

## n8n workflow process (always follow for WF-00 and WF-01)
1. **Clarify** the goal: trigger, inputs, transformations, integrations, outputs, schedule.
2. **Discover nodes** with n8n-mcp doc/search tools instead of guessing node names/params.
3. **Design** using the relevant n8n skill's guidance.
4. **Validate** with n8n-mcp validation tools (nodes, connections, expressions) — fix all errors.
5. **Show the user** a summary + the validated workflow JSON, in Spanish.
6. **Deploy only after explicit approval.** Create it **deactivated**; activate only on confirmation.

---

## Autonomy policy
- Mode: **validate and show first**. Never create, overwrite, or activate a workflow in the
  live n8n instance without explicit user approval.
- Never apply SQL to the live Supabase project without approval.
- Never modify `CLAUDE.md` without the user asking for it explicitly.

---

## Conventions
- **Bilingual by design:** domain identifiers, tables, columns and user-facing text in
  **Spanish** (`animales`, `eventos_reproductivos`, `arete`, `madre_id`); code comments,
  technical docs and function names in **English** (`handleMessage`, `getSession`).
- **Colombian terminology:** potrero (not paddock), arete (not tag), ordeño (not milking session)
- **Currency:** COP. **Regulation:** ICA Colombia, SINIGAN.
- SQL lowercase and idempotent; indexes named `idx_<table>_<column>`.
- Commits: **Conventional Commits** with scope — `feat(bot):`, `feat(cron):`, `fix(docker):`.
- n8n workflows: `GDP ·` prefix, `WF-NN` numbering, node names in Spanish.
- Bot responses: no markdown. Use `━━━━━━━━━━━━━━━` as separators. Descriptive emojis. Plain-text tables.
- Bot commands namespaced: `menu:`, `nav:menu`.
- Uppercase placeholders for values to replace: `CHANGE_ME_GDP_VERIFY_TOKEN`.

---

## Quality standards
- **Error handling:** error paths and sensible retries on all external calls.
- **Descriptive names:** rename every n8n node clearly — never leave defaults.
- **Internal documentation:** sticky notes and node notes for non-obvious logic.
- **Pre-deploy validation:** always validate nodes, connections and expressions via MCP.

---

*Last updated: multi-tenant architecture + SaaS roadmap + source of truth resolved.*
*Sections marked 🎯 are decided design, not implemented — verify against code before relying on them.*
*Full project brief: `docs/README-ganaderia.md` (⚠️ outdated — describes n8n as primary).*
