-- ============================================================================
-- 02 - Multi-tenant foundation: fincas + finca_id + RLS  (task #2)
-- ----------------------------------------------------------------------------
-- Apply AFTER schema.sql / alerts_views.sql / backup.sql / 01_bot_schema.sql.
-- Idempotent: safe to re-run. Additive only — does not drop or rewrite data.
--
-- ⚠️ db/ has NO version control and NO backup. Review before running in the
--    Supabase SQL Editor. Do not apply to the live project without approval.
--
-- IMPORTANT — service_role bypasses RLS. The app (supabase.ts) uses the
-- service_role key, so the policies below are DORMANT today: they neither
-- protect nor break anything under the current connection. They activate only
-- for a non-service_role path (Phase 1 JWT, or a request-scoped connection
-- that runs `set_config('app.finca_id', '<uuid>', false)` first).
--
-- Phase 0 isolation is provided instead by:
--   1) every data row defaulting to the single founder's farm (below), and
--   2) the app being single-tenant (all rows belong to that one finca).
-- No app-code change is required now: the column DEFAULT fills finca_id on
-- every existing INSERT automatically. Phase 1 drops the default and sets
-- finca_id explicitly from the authenticated user's tenant.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) fincas — system root. Phase 0 has exactly one row.
-- ----------------------------------------------------------------------------
create table if not exists fincas (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  nit           text,
  municipio     text,
  departamento  text,
  created_at    timestamptz not null default now()
);

-- Fixed sentinel id for the founder's farm so the app can hardcode it and the
-- migration stays idempotent (a random uuid would differ on every re-run).
insert into fincas (id, nombre, municipio, departamento)
values ('00000000-0000-0000-0000-000000000001', 'Finca del fundador (cliente cero)', null, null)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2) finca_id on every data table (NOT NULL, defaulted to the Phase 0 farm)
--    + per-tenant index + RLS with a fail-closed isolation policy.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  farm constant uuid := '00000000-0000-0000-0000-000000000001';
  data_tables constant text[] := array[
    'animales', 'eventos_reproductivos', 'produccion_leche',
    'eventos_sanitarios', 'pesajes', 'movimientos', 'confirmaciones_pendientes'
  ];
begin
  foreach t in array data_tables loop
    -- add nullable first so it works on tables that already hold rows
    execute format('alter table %I add column if not exists finca_id uuid references fincas(id)', t);
    -- backfill existing rows to the single Phase 0 farm
    execute format('update %I set finca_id = %L where finca_id is null', t, farm);
    -- new inserts (app does not pass finca_id yet) auto-get the Phase 0 farm
    execute format('alter table %I alter column finca_id set default %L', t, farm);
    -- now that no NULLs remain, enforce the invariant
    execute format('alter table %I alter column finca_id set not null', t);
    execute format('create index if not exists idx_%s_finca on %I(finca_id)', t, t);

    -- RLS: dormant under service_role; fail-closed for any other connection.
    -- current_setting(..., true) returns NULL (not an error) when the GUC is
    -- unset, so an unconfigured session sees zero rows rather than crashing.
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$
      create policy tenant_isolation on %I
        using      (finca_id = current_setting('app.finca_id', true)::uuid)
        with check (finca_id = current_setting('app.finca_id', true)::uuid)
    $p$, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3) Catalogs — nullable finca_id: NULL = global, else farm-specific.
--    No backfill / no default: existing rows stay NULL (global), which is
--    exactly today's behavior (every farm sees them).
-- ----------------------------------------------------------------------------
do $$
declare
  c text;
  cat_tables constant text[] := array[
    'cat_vacunas', 'cat_medicamentos', 'cat_diagnosticos',
    'cat_razas', 'cat_tecnicos', 'cat_causas_mortalidad'
  ];
begin
  foreach c in array cat_tables loop
    execute format('alter table %I add column if not exists finca_id uuid references fincas(id)', c);
    execute format('create index if not exists idx_%s_finca on %I(finca_id)', c, c);
    execute format('alter table %I enable row level security', c);
    execute format('drop policy if exists tenant_read on %I', c);
    execute format($p$
      create policy tenant_read on %I
        using (finca_id is null or finca_id = current_setting('app.finca_id', true)::uuid)
    $p$, c);
  end loop;
end $$;

-- ============================================================================
-- Deferred (NOT in this migration — each is a separate, riskier change):
--   * whatsapp_users -> N:M with fincas (whatsapp_user_fincas). Changes the PK
--     from `telefono` to a uuid and touches session.ts / handler.ts auth. Do
--     it as its own task, not bundled here.
--   * whatsapp_sessions.finca_id (active tenant) — only needed once a phone can
--     belong to more than one finca.
--   * App reads/writes: no change needed in Phase 0 (single farm, defaulted
--     column). Phase 1 must filter by finca_id and set app.finca_id per request,
--     OR move policies to auth.jwt()->>'finca_id'.
-- ============================================================================
