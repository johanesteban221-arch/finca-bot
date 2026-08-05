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
| `src/` | Next.js 15 app — bot, dashboard, domain layer |
| `src/components/ui/` | Design-system primitives (Card, Kpi, Table, Badge, Bars, Banner) |
| `tests/` | Vitest suite — `npm test` |
| `db/` | Plain SQL for the Supabase SQL Editor (`diagnostics/` and `maintenance/` sit outside the apply chain) |
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
- `WF-02`, `WF-03` — **superseded** by the app's cron endpoints. The JSON files still exist
  in `workflows/` (now version-controlled) — do not delete them without asking. Deactivate
  in n8n instead.
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
- `src/lib/tenant.ts` — `FINCA_ID` constant (Phase 0 single tenant). Every INSERT must pass it.
- `src/lib/dates.ts` — farm-timezone calendar dates. **Every** stored `fecha` goes through it.

### Bot file structure — ✅ done (handler.ts refactor + domain extraction)
```
src/lib/
  handler.ts            ← orchestrator: auth, shortcuts, MENU_FLOWS/MENU_ACTIONS/FLOWS tables
  state-machine.ts      ← Flow type, step helpers, shared UI + message constants
  menu.ts               ← main menu (separate so flows can fall back without an import cycle)
  animals.ts            ← findAnimal / findOrCreateAnimal / CATEGORIAS
  dates.ts              ← farm-timezone calendar dates
  domain/               ← ⚠️ ALL writes live here — see the contract below
    schemas.ts          ← zod schemas mirroring the DB CHECK constraints
    animales · sanidad · reproduccion · pesajes · mortalidad
  flows/                ← conversation only: prompts, steps, message wording
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

### Domain contract — ⚠️ read before adding any write
**Every write to a data table goes through `src/lib/domain/`.** Flows and (from Fase 3)
dashboard forms are entry channels; neither may talk to `supabase.from(...).insert()`
directly. The rule exists because of the derived values: a tratamiento sets
`retiro_leche_hasta`, the date until which that cow's milk cannot be shipped. Computed in
two places, the two eventually drift, and the failure mode is contaminated milk in the tank.

- Domain functions validate with zod (`schemas.ts`), write, and **return what the caller
  needs to render** — derived dates, created ids, and whether the animal had to be created.
- Flows keep their per-step validation: that is what produces the friendly WhatsApp
  messages. The schemas are the backstop underneath, not a replacement.
- Every write takes an optional `fecha`, defaulting to the farm's today and rejecting the
  future. Derived dates shift from the **event date**, not from today, so a backdated entry
  schedules correctly.
- There are no multi-statement transactions (supabase-js has no API for them). `registrarParto`
  writes to four tables in sequence; a mid-way failure leaves partial data. Move it to a
  Postgres RPC if that ever bites.

---

## Multi-tenant architecture — ✅ MOSTLY BUILT (CRITICAL, do not skip)

> **Status: applied via `db/02_multitenant.sql` (task #2, done).** The `fincas` table
> exists with one row (the founder's farm, fixed id
> `00000000-0000-0000-0000-000000000001`), every data table and catalog has `finca_id`,
> and RLS is enabled on all of them.
>
> ⚠️ **RLS is enabled but DORMANT.** The app connects with the Supabase `service_role`
> key, which bypasses RLS entirely. The `tenant_isolation` policies neither protect nor
> break anything today. Phase 0 isolation comes from the app being single-tenant, not
> from RLS. Do not read "RLS enabled" as "tenant isolation enforced" — that only becomes
> true in Phase 1, via a JWT-scoped connection or a per-request
> `set_config('app.finca_id', …)`.
>
> **Still 🎯 (deliberately deferred, see the bottom of `db/02_multitenant.sql`):** the
> `whatsapp_users` N:M rework (§4 below) and `whatsapp_sessions.finca_id`. Real
> `whatsapp_users` today is still `(telefono PK, nombre, rol, activo)`.

These decisions are made now even though there is only one tenant (Phase 0). Changing them
later means rewriting schema + all queries + all RLS policies.

### 1. `fincas` table as system root — ✅ built
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

### 2. `finca_id` on every data table — ✅ built
All 7 data tables — `animales`, `eventos_sanitarios`, `pesajes`, `eventos_reproductivos`,
`produccion_leche`, `movimientos`, `confirmaciones_pendientes` — have:
```sql
finca_id UUID NOT NULL REFERENCES fincas(id) DEFAULT '00000000-…-0001'
```
The column DEFAULT is a Phase 0 safety net only. **The app does not rely on it:** every
INSERT names `finca_id` explicitly via `FINCA_ID` from `src/lib/tenant.ts`. Keep it that
way — Phase 1 drops the default and the explicit writes are what will survive.

### 3. Supabase RLS by `finca_id` from day 1 — ✅ enabled, ⚠️ dormant
```sql
ALTER TABLE animales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON animales
  USING      (finca_id = current_setting('app.finca_id', true)::uuid)
  WITH CHECK (finca_id = current_setting('app.finca_id', true)::uuid);
-- `, true` → returns NULL instead of erroring when the GUC is unset, so an
-- unconfigured non-service_role session sees zero rows (fail-closed).
-- Phase 0: bypassed by service_role. Phase 1: finca_id comes from the user's JWT.
```

### 4. `whatsapp_users` is N:M with `fincas` — 🎯 NOT BUILT (deferred on purpose)
Deferred out of task #2: it changes the PK from `telefono` to a uuid and touches
`session.ts` + `handler.ts` auth. Do it as its own task, not bundled into a schema
migration. A phone number can belong to multiple farms (external vet, owner with
multiple farms).
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
  -- Unaccented, matching the live whatsapp_users.rol CHECK in db/01_bot_schema.sql.
  -- The cron filters on rol = 'dueno'; an accented value here would match nothing.
  rol       TEXT CHECK (rol IN ('dueno','admin','veterinario','vaquero')),
  PRIMARY KEY (user_id, finca_id)
);
```

### 5. Catalogs: global + per-farm — ✅ built
`cat_vacunas`, `cat_medicamentos`, `cat_diagnosticos`, etc. have nullable `finca_id`
(existing rows stayed NULL = global, which matches today's behavior):
- `finca_id IS NULL` → global (available to all farms)
- `finca_id = X` → only for that farm

---

## Database

Apply SQL in this order in the Supabase SQL Editor (all files now live in `db/`):
`db/schema.sql` → `db/alerts_views.sql` → `db/backup.sql` → `db/01_bot_schema.sql`
→ `db/02_multitenant.sql`

**No versioned migrations** — SQL is idempotent (`CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE VIEW`). Preserve that idempotency in any new SQL.

### Subfolders — outside the migration chain
Neither is ever applied as a deployment step. Keep new scripts out of `db/`'s root so the
apply order above stays unambiguous.

| Folder | What goes in it | Rule |
|---|---|---|
| `db/diagnostics/` | Read-only `SELECT` scripts for investigating data | Must contain no write statement. `fechas_desfasadas_utc.sql` finds rows misdated by the pre-fix UTC bug. |
| `db/maintenance/` | ⚠️ Destructive operational scripts | Ship them **disabled**: the real block stays commented out, preceded by a dry run wrapped in `begin … rollback`. `reset_datos.sql` empties the herd tables (keeps `fincas`, `whatsapp_users`, `whatsapp_user_fincas` and every `cat_*`). |

Two things any script touching data must account for:
- **Delete order.** `animales` is the FK root — six tables reference it, including itself
  via `madre_id`/`padre_id`. Delete its children first, clear the self-references, then
  `animales`. Do not lean on `ON DELETE CASCADE` to get the order right for you.
- **RLS is fail-closed.** Under a role subject to RLS with `app.finca_id` unset, a `DELETE`
  matches zero rows and looks like it succeeded. The Supabase SQL Editor runs as `postgres`
  (BYPASSRLS) so it is unaffected — any other connection is not. Always verify with counts.

Take a backup before running anything destructive: `GET /api/cron/backup?secret=CRON_SECRET`
or `select * from vw_respaldo_completo;`, stored outside the database.

### Tables
`✅` = exists today · `🎯` = target, not built

```
-- Multi-tenant root
✅ fincas (1 row: the founder's farm)

-- Cattle data (all have finca_id NOT NULL + idx_<table>_finca + RLS enabled/dormant)
✅ animales · eventos_reproductivos · produccion_leche
✅ eventos_sanitarios · pesajes · movimientos · confirmaciones_pendientes

-- Bot
✅ whatsapp_users (flat shape today — N:M rework deferred) · whatsapp_sessions
🎯 whatsapp_user_fincas
✅ cat_vacunas · cat_medicamentos · cat_diagnosticos   (nullable finca_id = global)
✅ cat_razas · cat_tecnicos · cat_causas_mortalidad    (nullable finca_id = global)

-- Views
✅ vw_historial_animal · vw_alertas · vw_respaldo_completo
```

### WhatsApp session state machine
```typescript
// whatsapp_sessions — one row per active user
{
  telefono:     string    // ✅ user's phone number (column is `telefono`, not `phone`)
  finca_id:     uuid      // 🎯 active tenant — deferred; not needed while a phone
                          //    belongs to exactly one finca (see 02_multitenant.sql)
  current_flow: string    // ✅
  current_step: number    // ✅ 1, 2, 3...
  temp_data:    jsonb     // ✅ accumulated flow data
  updated_at:   timestamp // ✅ UTC instant, rewritten on every saveSession
}
```
**Session TTL: ✅ implemented in the app, not in the schema.** There is no `expires_at`
column and no DB-side cleanup. `getSession` compares `updated_at` against `EXPIRE_MIN`
(30 min) in `src/lib/session.ts` and returns a fresh empty session once that elapses —
so sessions do expire, but stale rows stay in the table forever. A DB-side TTL or a
periodic purge is still 🎯, and would only matter for table growth, not for correctness.

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
- **UI:** Tailwind **v4** (CSS-first config in `src/app/globals.css`, no `tailwind.config.js`)
  + `clsx`/`tailwind-merge` via `src/lib/cn.ts` + `lucide-react`. Verified against Next 15.1.6.
  Fonts are the **system stack on purpose** — `next/font/google` would make the Docker build
  depend on a network call.
- **Validation:** `zod` — schemas in `src/lib/domain/schemas.ts`
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
- [x] ~~**2. Add `finca_id` to schema**~~ — done: `db/02_multitenant.sql` applied in Supabase.
      `fincas` + `finca_id` on 7 data tables & 6 catalogs + RLS (dormant under `service_role`).
      Deferred by design: `whatsapp_users` N:M, `whatsapp_sessions.finca_id`.
- [x] ~~**3. Version `db/` and `workflows/`**~~ — done: moved into the repo, backed up on GitHub
- [x] ~~**4. Tests on critical flows**~~ — done: Vitest + 66 tests (`npm test`). Integration
      tests for salud & reproducción driven through `handleMessage`, plus farm-timezone
      regression tests. Only Supabase and `fetch` are faked — see `tests/helpers/`.
- [ ] **5. Meta template approval** — start Meta approval process for proactive alert templates

### Dashboard rework — Fase 0 y 1 ✅, Fase 2 y 3 pendientes
Agreed plan: **0** extract domain → **1** visual redesign → **2** auth by role → **3** forms.
The order is deliberate: forms built before the domain extraction would duplicate the
business rules, forms built before the redesign would need restyling nine times over, and
forms built before auth would need authorization retrofitted into nine write paths.

- [x] ~~**Fase 0 — domain layer**~~ — `src/lib/domain/`, zod schemas, flows refactored to
      call it. 99 existing tests passed with no expect touched; 29 domain tests added.
- [x] ~~**Fase 1 — visual redesign**~~ — Tailwind v4, agro palette (`campo`/`tierra`),
      sidebar shell, `src/components/ui/`.
- [ ] **Fase 2 — auth by role** — Supabase Auth + `usuarios`/`usuario_fincas`, replacing
      Basic Auth. Roles: dueño · admin · veterinario · vaquero, enforced **server-side** in
      every write, not by hiding buttons. Two hazards: locking the owner out of production
      (keep Basic Auth behind an env flag during migration), and moving the dashboard off
      `service_role`, which activates the fail-closed RLS — a bad `finca_id` claim shows an
      empty farm rather than an error. Closes items #6 and the deferred `whatsapp_user_fincas`.
- [ ] **Fase 3 — dashboard forms** — the nine flows as web forms via Server Actions. Notes:
      `findOrCreateAnimal` must **confirm before creating** from a form (a typo'd arete would
      silently create a ghost animal); backdating invalidates the assumption behind
      `db/diagnostics/fechas_desfasadas_utc.sql`, which must be updated in the same phase;
      and there is still no `created_by` column to record who wrote what.

Deferred from the earlier dashboard review:

- [ ] **6. Filter dashboard queries by `finca_id`** — ⚠️ Phase 1 blocker. `analytics.ts` and
      `alerts.ts` read every row of every table with no tenant filter, and RLS is dormant
      under `service_role`, so there is no backstop. Harmless with one farm; breaks the day
      a second one is onboarded.
- [ ] **7. Bound the unpaginated queries** — `animales`, `pesajes` and `eventos_reproductivos`
      are fetched whole and aggregated in JS. PostgREST caps rows per response (Supabase
      commonly defaults to 1000); past that, GDP and IEP are silently computed on truncated
      data. Verify the project's `max-rows` and paginate or push the aggregation into SQL.
- [ ] **8. `produccion_leche` has no writer** — the milk section can never populate. Note the
      contradiction to resolve: the dashboard placeholder promises a WhatsApp entry flow,
      while the architecture decision above is hardware-only via the ESP32 endpoint. Fix one.
- [ ] **9. "Sin 2º pesaje" undercounts** — `analytics.ts` only walks animals that already have
      at least one weighing, so animals never weighed are invisible in the peso section.
- [ ] **10. Promote the mortality cause to a column** — `flows/mortalidad.ts` writes it into
      `movimientos.notas` as `"Causa: X"` and `analytics.ts` parses it back out with a regex.
      A real `causa` column (FK to `cat_causas_mortalidad`) would remove the round trip.

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
- **Dates:** the server runs in UTC, the farm in `America/Bogota` (UTC-5). Any calendar day
  stored in a `fecha` column comes from `src/lib/dates.ts` — never `new Date().toISOString()`,
  which rolls over at 7 PM local and dates the afternoon ordeño to tomorrow. Instants
  (`updated_at`, `generated_at`) stay UTC ISO and must not go through `dates.ts`.
- SQL lowercase and idempotent; indexes named `idx_<table>_<column>`.
- Commits: **Conventional Commits** with scope — `feat(bot):`, `feat(cron):`, `fix(docker):`.
- n8n workflows: `GDP ·` prefix, `WF-NN` numbering, node names in Spanish.
- Bot responses: no markdown. Use `━━━━━━━━━━━━━━━` as separators. Descriptive emojis. Plain-text tables.
- Bot commands namespaced: `menu:`, `nav:menu`.
- Uppercase placeholders for values to replace: `CHANGE_ME_GDP_VERIFY_TOKEN`.

---

## Tests
`npm test` (Vitest, run mode) · `npm run test:watch`. 128 tests. Test-only dependency — the
Docker production build is untouched.

- `tests/helpers/fake-supabase.ts` — in-memory Supabase covering the query surface the app
  uses: `eq/gte/lte/gt/lt/not(is,null)`, `order`, `limit`, dotted paths for embedded
  resources (`animales.estado_reproductivo`), and `failOn(table)` to exercise error paths.
  Extend it when a query starts using a new shape.
- `tests/helpers/harness.ts` — stubs global `fetch` to capture outgoing Meta payloads,
  freezes the clock, seeds catalogs.
- Flow tests run through `handleMessage`, the same entry point as the webhook, so routing
  and session persistence are covered too. Add new flows here as they land.
- `tests/lib/dashboard.test.ts` renders the server component to static HTML — that is what
  verifies the dashboard actually degrades instead of showing zeros.
- Both flow suites assert `finca_id` on every written row — keep that guard.

### Read-path error contract
Supabase reports failures in `error` rather than throwing, so `data || []` turns a broken
query into a convincing empty result. Every read goes through `unwrapList()` in
`src/lib/supabase.ts`, which throws. Callers decide how to degrade:
- **Dashboard** — `Promise.allSettled`, a warning banner, and «—» instead of 0.
- **`cron/daily-alerts`** — aborts with a 500 before sending anything. An alert claiming
  "nada pendiente" because the DB was unreachable would send milk from a cow still in its
  withdrawal period.

---

## Quality standards
- **Error handling:** error paths and sensible retries on all external calls.
- **Descriptive names:** rename every n8n node clearly — never leave defaults.
- **Internal documentation:** sticky notes and node notes for non-obvious logic.
- **Pre-deploy validation:** always validate nodes, connections and expressions via MCP.

---

*Last updated: dashboard rework Fase 0 (domain layer) and Fase 1 (Tailwind v4 redesign)
done. Fase 2 (auth by role) and Fase 3 (forms) pending.*
*Sections marked 🎯 are decided design, not implemented — verify against code before relying on them.*
*Full project brief: `docs/README-ganaderia.md` (⚠️ outdated — describes n8n as primary).*
