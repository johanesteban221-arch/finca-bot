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

### Milk production: every cow, both milkings, every day
> **Status:** the ESP32 endpoint is still 🎯 — it does not exist, and there is no
> `X-Device-Key` auth. Today the app exposes 3 API routes (whatsapp/webhook,
> cron/daily-alerts, cron/backup).
>
> ✅ `produccion_leche` **has a writer**: `domain/leche.registrarControlLeche()`, driven
> from `/dashboard/leche`. Its form is Bloque D.

**The real flow, confirmed by the founder on 2026-08-25: the operator measures every cow
with a meter, in BOTH milkings, EVERY day.** There is no separate bulk-total entry and no
periodic spot check. The total of a milking is the sum of its per-cow rows, and nothing
else is ever typed. A second "daily total" mode (a `tipo` discriminator on
`controles_leche`) was designed and **discarded before being written** — it modelled a
workflow this farm does not have. Do not reintroduce it unless the founder says the flow
changed.

`produccion_leche.fuente` (`manual` | `control` | `hardware`) stays: the ESP32 will write
the same rows through the same shape. `controles_leche` is the per-ordeño header — one row
per `(finca, fecha, ordeño)` with who recorded it and when.

⚠️ **The total is never stored.** AM → `ordeno='manana'`, PM → `ordeno='tarde'`, total is
derived by summing. `ordeno` still accepts a third value, `'total'`, which is also the
column DEFAULT in `schema.sql`: no write path produces it, but a loose INSERT that omits
`ordeno` lands there and `vw_leche_ordeno` would add it as a third milking of the day.
`db/diagnostics/leche_total_conviviendo.sql` finds those rows.

⚠️ **Herd volume is read from `vw_leche_ordeno` (`db/06`), never from `produccion_leche`
raw.** Two milkings a day is ~730 rows per cow per year; 30 days of a 20-cow herd is 1200
rows, past PostgREST's 1000-row cap. That is what closed task #7 — read it below before
adding any new query over this table.

### Key files
- `src/lib/handler.ts` (~115 lines) — orchestrator: auth, global shortcuts, routing tables. No step logic.
- `src/app/api/whatsapp/webhook/route.ts` — Meta webhook (GET verify + POST).
- `src/app/api/cron/daily-alerts/route.ts`, `.../cron/backup/route.ts` — guarded by `CRON_SECRET`.
- `src/app/api/version/route.ts` — public, four fields: which image is running. `construidoEn`
  is stamped by the Docker build itself (no Easypanel config needed); `sha` needs
  `--build-arg GIT_SHA` and reads `desconocido` without it. A stale `construidoEn` with a
  fresh `arrancadoEn` means the container restarted, not that a deploy landed.
- `src/middleware.ts` — guards `/dashboard`: Supabase session cookie → pass (the page
  verifies for real); else `AUTH_LEGACY_BASIC=1` → the old Basic Auth, still fail-closed
  (503 if the password is missing); else redirect to `/login`. Keep it that way.
- `src/lib/auth/` — `roles.ts` (permission matrix), `server.ts` (`getSesion` /
  `requerirPermiso`), `usuarios.ts` (user management). See the Fase 2 section below.
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
  hato.ts               ← listados de solo lectura para los formularios (Bloque D)
  forms.ts              ← lectura de FormData: vacío ≠ 0, coma decimal, zod → mensaje
  vocabulario.ts        ← etiquetas visibles de los códigos clínicos (P, VAS, CL2…)
  domain/               ← ⚠️ ALL writes live here — see the contract below
    schemas.ts          ← zod schemas mirroring the DB CHECK constraints
    animales · sanidad · reproduccion · pesajes · mortalidad
    chequeos · protocolos · leche      ← hoja de vida (sin canal de bot todavía)
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
- **Any product applied goes through `sanidad.aplicarProducto()`**, whatever event it
  belongs to — the intramammary of a dry-off, the hormone of a check-up, each step of a
  synchronization protocol. That is the single place `retiro_leche_hasta` is derived from
  `cat_medicamentos`. A product stored as loose columns on its own table is a withdrawal
  period the milk alerts cannot see.
- **`findAnimal` vs `findOrCreateAnimal` is a channel decision.** WhatsApp flows create on
  a miss (the vaquero is in the field and cannot fix a typo there); dashboard-only writes
  — chequeos, protocolos, control de leche — look up and **fail**, because a typo'd arete
  on a form would silently add a ghost animal to the inventory.
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
→ `db/02_multitenant.sql` → `db/03_hoja_de_vida.sql` → `db/04_auth_roles.sql`
→ `db/05_control_leche_ordeno.sql` → `db/06_leche_agregada.sql`

⚠️ **`03_hoja_de_vida.sql` is the final definition of `vw_historial_animal` and
`vw_respaldo_completo`.** The versions in `schema.sql` and `backup.sql` are base
definitions, valid at their point in the chain (the tables they gain later do not
exist yet). Re-running either file on its own without re-running `03` silently
drops the newest event types from the animal's history and from every backup.

**No versioned migrations** — SQL is idempotent (`CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE VIEW`). Preserve that idempotency in any new SQL.

### Subfolders — outside the migration chain
Neither is ever applied as a deployment step. Keep new scripts out of `db/`'s root so the
apply order above stays unambiguous.

| Folder | What goes in it | Rule |
|---|---|---|
| `db/diagnostics/` | Read-only `SELECT` scripts for investigating data | Must contain no write statement. `fechas_desfasadas_utc.sql` finds rows misdated by the pre-fix UTC bug; `leche_total_conviviendo.sql` finds the `ordeno='total'` rows that `vw_leche_ordeno` would double-count. |
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

-- Hoja de vida (db/03_hoja_de_vida.sql). FK compuesta (animal_id, finca_id) →
-- animales(id, finca_id): una FK simple dejaría cruzar fincas sin que RLS lo vea.
✅ chequeos_reproductivos · protocolos_sincronizacion · protocolo_aplicaciones
✅ controles_leche  (el detalle por vaca va en produccion_leche, no en tabla aparte)
--   Un control es de UN ORDEÑO, no de un día: unique (finca_id, fecha, ordeno).
--   `created_by` es la identidad autoritativa y `medido_por` la copia del nombre.
--   produccion_leche lleva unique (animal_id, fecha, ordeno) — db/05.

-- Tablero: usuarios y roles (db/04_auth_roles.sql). usuarios.id ES auth.users.id;
-- el rol vive en usuario_fincas, POR FINCA, no en el perfil. Sin columna de
-- contraseña: eso es de auth.users.
✅ usuarios · usuario_fincas

-- Bot
✅ whatsapp_users (flat shape today — N:M rework deferred) · whatsapp_sessions
🎯 whatsapp_user_fincas   (el equivalente del bot a usuario_fincas; sigue pendiente)
✅ cat_vacunas · cat_medicamentos · cat_diagnosticos   (nullable finca_id = global)
✅ cat_razas · cat_tecnicos · cat_causas_mortalidad    (nullable finca_id = global)

-- Views  (las de 03 y 06 llevan security_invoker = true; sin él una vista corre
--         con los permisos de su dueño y evade el RLS de quien consulta — inocuo
--         bajo service_role, fuga entre fincas en Fase 1)
✅ vw_historial_animal · vw_alertas · vw_respaldo_completo · vw_genealogia
✅ vw_leche_ordeno (db/06)
--   Una fila por finca, fecha y ordeño. Es la ÚNICA fuente del volumen del hato:
--   leer produccion_leche cruda vuelve a poner la agregación del mes por encima
--   del tope de filas de PostgREST.
```

### Vocabulario clínico del chequeo reproductivo
Confirmado con el fundador. Los CHECK de `chequeos_reproductivos` y los enums de
`domain/schemas.ts` son espejo de esto — cambiar uno sin el otro produce un error
de Postgres que el veterinario no puede accionar.

| Estado | Significado | → `estado_reproductivo` |
|---|---|---|
| `P` | preñada | `prenada` |
| `V` | vacía | `vacia` |
| `SE` | servida | `servida` |
| `VAS` | vacía en anestro **superficial** | `vacia` |
| `VAP` | vacía en anestro **profundo** | `vacia` |
| `PP` | post-parto | `parida` |
| `RECHE` | **rechequeo** — volver a ecografiar | *(ninguno)* |

**`RECHE` no es descarte.** Es "el vet no pudo definir, hay que volver a mirarla".
El animal **conserva** su estado; ponerle uno sería inventar un hallazgo que el
veterinario no hizo. Lo que sí genera es una alerta: `getRechequeosPendientes()`
en `src/lib/alerts.ts` busca los animales cuyo chequeo **más reciente** quedó en
`RECHE`, y por eso el rechequeo **se cierra solo** al registrar el chequeo
siguiente — no hay bandera que mantener, que es justo lo que se olvidaría.

Estructuras ováricas: `CL1/CL2/CL3` = cuerpo lúteo grado 1/2/3 · `MF` =
multifolicular · `QF` = quiste folicular · `QL` = quiste luteínico ·
`F8mm/F10mm/F12mm` = folículo por tamaño · `FPre` = folículo preovulatorio.

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
✅ reproduccion.parto · reproduccion.secado
✅ reproduccion.pick — sub-menu. Sent as a LIST, not buttons: Meta caps interactive
   buttons at 3 and there are four options. A fifth flow just adds a row (cap is 10).
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
- **Auth (dashboard):** Supabase Auth, email + password, via `@supabase/ssr` (cookies).
  The anon key is used **only** to validate the session; every read/write of farm data
  still goes through the `service_role` client. Two clients, two jobs — see
  `src/lib/auth/server.ts`.
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

### Dashboard rework — Fases 0, 1 y 2 ✅, Fase 3 pendiente
Agreed plan: **0** extract domain → **1** visual redesign → **2** auth by role → **3** forms.
The order is deliberate: forms built before the domain extraction would duplicate the
business rules, forms built before the redesign would need restyling nine times over, and
forms built before auth would need authorization retrofitted into nine write paths.

- [x] ~~**Fase 0 — domain layer**~~ — `src/lib/domain/`, zod schemas, flows refactored to
      call it. 99 existing tests passed with no expect touched; 29 domain tests added.
- [x] ~~**Fase 1 — visual redesign**~~ — Tailwind v4, agro palette (`campo`/`tierra`),
      sidebar shell, `src/components/ui/`.
- [x] ~~**Fase 2 — auth by role**~~ — `db/04_auth_roles.sql` **applied in Supabase**
      (2026-08-15) + `src/lib/auth/` + `/login` + `/dashboard/usuarios`. Login is **email +
      password** (Supabase Auth, `@supabase/ssr`); the `usuarios` profile hangs off
      `auth.users` by id and the role lives in `usuario_fincas`, per farm.

      Three decisions to respect before changing anything here:
      - **The data connection stays on `service_role`.** Moving it to the user's JWT was
        deliberately NOT done: RLS is fail-closed, and a wrong `finca_id` claim shows an
        empty farm instead of an error. Isolation today = the role matrix + the explicit
        `finca_id` filter (item #6, closed in the same batch). RLS stays dormant.
      - **The bot was not touched.** `whatsapp_users` still authorises by phone, so
        `whatsapp_user_fincas` is STILL deferred — the two authentications must not move in
        the same deploy.
      - **The guard goes in every page and every server action, never only in the layout.**
        In the App Router the layout and the page render in parallel, so a layout-only guard
        does not stop the page from querying. Hiding the Usuarios link is courtesy, not
        authorization.

      Bootstrap door: `AUTH_LEGACY_BASIC=1` keeps the old Basic Auth alive acting as
      `dueno`, which is what lets the owner create the first real user without being locked
      out. Turn it off only after the new login works — `DEPLOY.md §8`.
- [ ] **Fase 3 — dashboard forms** — the nine flows as web forms via Server Actions. Notes:
      every action starts with `await requerirPermiso(...)` — it throws, so a forgotten
      check cannot read as success; `findOrCreateAnimal` must **confirm before creating**
      from a form (a typo'd arete would silently create a ghost animal); backdating
      invalidates the assumption behind `db/diagnostics/fechas_desfasadas_utc.sql`, which
      must be updated in the same phase; and there is still no `created_by` column to record
      who wrote what — now that there is a real session, that column is worth adding here.

### Hoja de vida del animal — Bloques A ✅ B ✅ C ✅, D pendiente
Expansion agreed 2026-08-11: full animal record, veterinary reproductive check-ups,
synchronization protocols, dry-off, manual milk control, unified timeline, family tree.

- [x] ~~**Bloque A — schema + domain + tests**~~ — `db/03_hoja_de_vida.sql`, `domain/`
      (chequeos · protocolos · leche · `registrarSecado` · `aplicarProducto`), rechequeo
      alert, 184 tests. ✅ **The SQL is applied in Supabase** (2026-08-15), so the new
      tables and the final `vw_historial_animal` / `vw_genealogia` / `vw_respaldo_completo`
      are live.
- [x] ~~**Bloque B — animal record, read-only**~~ — `/dashboard/animales/[arete]`, 200 tests.
      `src/lib/ficha.ts` reads `vw_historial_animal` (200 events max, newest first) and
      `vw_genealogia`, plus the offspring — one query keyed on the animal's sex, `madre_id`
      for a cow and `padre_id` for a bull. The page degrades per section with
      `allSettled`, and **a failed query never renders as "animal no encontrado"**: that
      message sends someone to re-register an animal that is already in the database.
      Every arete in the dashboard links to the ficha, so the sidebar anchors became
      absolute (`/dashboard#…`) — the layout wraps the ficha too. `totalLitros30d` is now
      labelled "Litros medidos" with the hint that it sums the control days, not the month;
      the field name stayed, only the label changed.
- [x] ~~**Bloque C — dry-off flow in the bot**~~ — `reproduccion.secado` in
      `flows/reproduccion.ts` + `handler.ts`; `menu.ts` untouched, it hangs off the
      reproduction sub-menu. One cow at a time **by the founder's decision**: product and
      dose change per cow, and a batch flow would flatten them. The intramammary is
      optional (secado seco is a real case) and, when there is one, the domain routes it
      through `aplicarProducto()` → `eventos_sanitarios`. The success message shows the
      withdrawal date **and the expected calving date**, so `seca` is not read as `vacia`.
- [x] ~~**Bloque D — dashboard forms**~~ — the three screens are live, 270 tests:
      `/dashboard/leche` (`leche.registrar`), `/dashboard/chequeos` (`chequeo.registrar`)
      and `/dashboard/protocolos` (`protocolo.registrar`). Every action opens with
      `requerirPermiso(...)`, which is exactly how `auth/roles.ts` splits them — the vaquero
      gets the milk control and not the check-ups, the vet the reverse.

      Decisions worth keeping:
      - **Zero client JS, with one measured exception.** All three are plain
        `<form action={serverAction}>`: a React-controlled form needs the bundle to have
        loaded, and these screens are filled in the corral on a bad signal. The exception is
        the **live total** on `/dashboard/leche` — a plain inline `<script>` that sums the
        filled boxes into the sticky bar. It is not React, it adds no chunk (the route is
        still 162 B) and the form saves fine without it; the number just stays at «—».
        Forty boxes with no running total is how an 85 typed for 8,5 goes unnoticed until
        the month looks wrong. The only two `'use client'` files are still the ones that
        show a password, and for a different reason.
      - **A blank box is not 0 litres.** They look the same on screen and mean the opposite
        ("I did not milk her" vs "she gave nothing"). A cow with nothing typed is not
        recorded; a `0` is. `lib/forms.ts` is where that distinction is enforced, and it is
        the reason FormData parsing is not improvised per action.
      - **One control per ORDEÑO, not per day** (`db/05`). The first cut had AM and PM
        columns on one submit, which made the real workflow impossible: the morning is
        weighed at 5 and the afternoon at 3, and the second save collided with
        `unique (finca_id, fecha)`. The screen now records one milking at a time, with the
        selector pre-picked from the farm clock — and the operator can still override it.
      - **Who recorded it comes from the session, never from the form.** `created_by` is the
        FK; `medido_por` is a name snapshot that survives the account being deleted. The old
        editable "medido por" text box was a signature the signer could rewrite.
      - **The mobile inputs are 16px**, gated on `@media(pointer:fine)` rather than a width
        breakpoint. Safari on iOS zooms into any field under 16px, and an iPhone in landscape
        is 844px wide — a `sm:` breakpoint would drop back to 14px exactly where the zoom
        still happens. Forty cows meant forty zooms.
      - **The results travel in the URL** (`?ok=` / `?error=`), which is what keeps these
        pages server components. Safe here because nothing sensitive goes through them.
      - Reads for the forms live in `lib/hato.ts` (not `domain/`, which is the write
        contract); the clinical labels live in `lib/vocabulario.ts` (not `domain/schemas.ts`,
        which must not know how a label is spelled).

      Still pending here: photo upload (Supabase Storage bucket + signed URLs) for the
      `foto_url` column, which exists but has no writer.

Deferred from the earlier dashboard review:

- [x] ~~**6. Filter dashboard queries by `finca_id`**~~ — done with Fase 2. Every read in
      `analytics.ts`, `alerts.ts`, `ficha.ts` and `hato.ts` carries `.eq('finca_id', FINCA_ID)`
      (`domain/leche.ts`'s arete lookup was missing it and was fixed with Bloque D). RLS is
      still dormant under `service_role`, so that `.eq()` **is** the tenant isolation, not a
      second belt — any new read must carry it. The test seeds get the column stamped by
      `tests/helpers/db.ts`, mirroring the DB DEFAULT; seed a different `finca_id` on
      purpose to test the isolation.
- [x] ~~**7. Bound the unpaginated queries**~~ — done 2026-08-25, forced by the daily
      measurement above (20 cows × 2 milkings × 30 days = 1200 rows). Two halves:
      **`vw_leche_ordeno`** (`db/06`) pushes the milk aggregation into Postgres — ~60 rows a
      month instead of 1200+ — and **`paginar()`** in `src/lib/supabase.ts` walks `.range()`
      pages until one comes back short, for `animales`, `pesajes`, `eventos_reproductivos`,
      `eventos_sanitarios` and `movimientos`.
      Two rules to keep: every paginated query must end its ordering on a **unique** column
      (`id`) — without a total order, rows swap between pages and one repeats while another
      is lost; and past the page ceiling `paginar` **throws** instead of truncating, because
      cutting silently is the exact failure it exists to prevent.
- [x] ~~**8. `produccion_leche` has no writer**~~ — resolved by the manual milk control
      (`domain/leche.ts`), which writes into `produccion_leche` with `fuente='control'`.
      The hardware-only contradiction is settled: control lechero and ESP32 coexist via
      `fuente`. Its dashboard form is Bloque D.
- [ ] **9. "Sin 2º pesaje" undercounts** — `analytics.ts` only walks animals that already have
      at least one weighing, so animals never weighed are invisible in the peso section.
- [ ] **11. The animal record drowns in milk rows** — `vw_historial_animal` includes
      `produccion_leche` and `ficha.ts` reads the newest 200 events. At two milkings a day
      that is ~730 milk events per cow per year, so within ~3 months a cow's hoja de vida
      shows nothing but ordeños and the vaccination or the service is buried. Filter milk
      out of the timeline or give it its own section. Direct consequence of the daily
      cadence, and it lands quietly: nothing errors, the history just stops being useful.
- [ ] **10. Promote the mortality cause to a column** — `flows/mortalidad.ts` writes it into
      `movimientos.notas` as `"Causa: X"` and `analytics.ts` parses it back out with a regex.
      A real `causa` column (FK to `cat_causas_mortalidad`) would remove the round trip.

---

## Secrets — hard rules
- **`.env.local` holds live production credentials** (Supabase `service_role` JWT,
  `SUPABASE_ANON_KEY`, Meta token, `CRON_SECRET`, `DASHBOARD_PASSWORD`). It is gitignored.
  **Never read it into context, never print its values, never paste them into a workflow
  or commit.**
- Temporary passwords generated for a new user are shown once in the browser and are
  **never stored** — not in `usuarios`, not in a log, not in a URL. That is why the two
  screens that show one are the only `'use client'` components in the project.
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
  (`updated_at`, `generated_at`, `created_at`) are **stored** as UTC ISO and must never go
  through `today()`/`addDays()`. Rendering one is the other half: `horaEnFinca()` and
  `selloEnFinca()` in `dates.ts` translate an instant to the farm clock, because the server
  runs in UTC and would show a 6:42 AM milking as 11:42.
- SQL lowercase and idempotent; indexes named `idx_<table>_<column>`.
- Commits: **Conventional Commits** with scope — `feat(bot):`, `feat(cron):`, `fix(docker):`.
- n8n workflows: `GDP ·` prefix, `WF-NN` numbering, node names in Spanish.
- Bot responses: no markdown. Use `━━━━━━━━━━━━━━━` as separators. Descriptive emojis. Plain-text tables.
- Bot commands namespaced: `menu:`, `nav:menu`.
- Uppercase placeholders for values to replace: `CHANGE_ME_GDP_VERIFY_TOKEN`.

---

## Tests
`npm test` (Vitest, run mode) · `npm run test:watch`. 287 tests. Test-only dependency — the
Docker production build is untouched.

- `tests/helpers/fake-supabase.ts` — in-memory Supabase covering the query surface the app
  uses: `eq/gte/lte/gt/lt/not(is,null)`, `order`, `limit`, `range` (PostgREST pagination),
  dotted paths for embedded resources (`animales.estado_reproductivo`), and `failOn(table)`
  to exercise error paths. Extend it when a query starts using a new shape.
  ⚠️ It also enforces the **unique indexes** listed in its `UNIQUE` map, aborting the whole
  insert like Postgres does. That was added because its absence hid two real milk-control
  bugs: without uniqueness a double submit duplicated the litres and the test called it
  green. A fake that accepts what Postgres rejects is not an optimistic fake, it is a test
  that lies — so when a table gains a unique in `db/`, add it there too.
  ⚠️ For the same reason it **truncates every response at 1000 rows**, the way PostgREST's
  `max-rows` does: silently, with `error: null`. Without it, a read that forgets `paginar()`
  passes the suite and undercounts in production. The 2500-animal test in
  `analytics.test.ts` is the one that would fail.
- `tests/helpers/harness.ts` — stubs global `fetch` to capture outgoing Meta payloads,
  freezes the clock, seeds catalogs.
- Flow tests run through `handleMessage`, the same entry point as the webhook, so routing
  and session persistence are covered too. Add new flows here as they land.
- `tests/lib/dashboard.test.ts` renders the server component to static HTML — that is what
  verifies the dashboard actually degrades instead of showing zeros.
- `tests/lib/ficha.test.ts` does the same for `/dashboard/animales/[arete]`, seeding
  `vw_historial_animal` and `vw_genealogia` as plain tables in the fake. Its load-bearing
  case is the one separating "animal no encontrado" from "no se pudo consultar".
- `tests/helpers/auth.ts` fakes the session (`getSesion`) the way `db.ts` fakes the
  database, so a page test can run as any role or with no session at all. Both page suites
  assert that WITHOUT a session nothing of the herd is rendered — the guard is per page,
  not in the layout.
- `tests/lib/auth.test.ts` pins Fase 2: the whole permission matrix, the compensations of
  creating a user (there are no transactions — a failed profile must delete the Auth
  account), and the rule that the farm can never be left without an active `dueno`.
- `tests/lib/formularios-{leche,chequeos,protocolos}.test.ts` pin Bloque D. They drive the
  real server actions with a real `requerirPermiso` over a faked session, so the role matrix
  is what is under test, not a double that says yes. `tests/helpers/formularios.ts` carries
  the shared `redirect()` marker: the actions return nothing and report through the URL, so
  catching that throw is the only way to read what came back.
- Both flow suites assert `finca_id` on every written row — keep that guard.
  `tests/lib/hoja-de-vida.test.ts` carries the same guard for the newer domain modules.
- `tests/lib/hoja-de-vida.test.ts` also pins the two cross-cutting rules that are easy to
  "simplify" away: a product applied during a chequeo/protocolo/secado must land in
  `eventos_sanitarios` with its withdrawal date, and a protocol's IA must create a real
  `servicio` event. There is a regression test that dries off a pregnant cow and checks she
  is still listed under próximos partos.

### Read-path error contract
Supabase reports failures in `error` rather than throwing, so `data || []` turns a broken
query into a convincing empty result. Every read goes through `unwrapList()` in
`src/lib/supabase.ts`, which throws. Callers decide how to degrade:
- **Dashboard** — `Promise.allSettled`, a warning banner, and «—» instead of 0.
- **`cron/daily-alerts`** — aborts with a 500 before sending anything. An alert claiming
  "nada pendiente" because the DB was unreachable would send milk from a cow still in its
  withdrawal period.

Truncation is the other half of the same problem: PostgREST caps every response at
`max-rows` and reports success, so an unpaginated read is a quiet undercount rather than an
error. Any read that gets aggregated goes through `paginar()` in `src/lib/supabase.ts`, or
moves the aggregation into SQL the way `vw_leche_ordeno` does.

---

## Quality standards
- **Error handling:** error paths and sensible retries on all external calls.
- **Descriptive names:** rename every n8n node clearly — never leave defaults.
- **Internal documentation:** sticky notes and node notes for non-obvious logic.
- **Pre-deploy validation:** always validate nodes, connections and expressions via MCP.

---

*Last updated 2026-08-25: the milk premise was corrected by the founder — the herd is
measured cow by cow, in both milkings, EVERY day. There is no bulk-total mode, and the
`db/06` that had been designed around a `tipo` diario/individual was discarded before being
written. What shipped instead: a **live total** on the control lechero (an inline
`<script>`, not `'use client'` — the route is still 162 B), and the fix for **task #7**,
which the daily cadence had just turned from theory into a live undercount:
`vw_leche_ordeno` (`db/06_leche_agregada.sql`, **APPLY BEFORE DEPLOYING** — it sits inside
`getAnalytics`'s `Promise.all`, so a missing view degrades the WHOLE dashboard, not just
the milk section) plus `paginar()` for the five remaining whole-table reads. The fake
Supabase now truncates at 1000 rows like PostgREST; without that, the unpaginated queries
tested green. `AUTH_LEGACY_BASIC` is OFF. `GET /api/version` reports the running image.
287 tests. Next: the animal record drowning in milk rows (#11) → the `foto_url` upload that
Bloque D left open → Fase 3 (the nine flows as forms) → `whatsapp_user_fincas`.*
*Sections marked 🎯 are decided design, not implemented — verify against code before relying on them.*
*Full project brief: `docs/README-ganaderia.md` (⚠️ outdated — describes n8n as primary).*
