-- ============================================================================
-- Gestion Ganadera Doble Proposito - Backup objects (run AFTER schema.sql)
-- ----------------------------------------------------------------------------
-- Daily snapshot strategy: WF-03 reads vw_respaldo_completo (the whole herd as
-- one JSON document) and stores it in the respaldos table with a timestamp.
-- This is an in-database point-in-time history. For true off-site backups,
-- WF-03 can additionally push the JSON to Google Drive / S3 (one extra node).
-- ============================================================================

create table if not exists respaldos (
  id         uuid primary key default gen_random_uuid(),
  data       jsonb not null,          -- full snapshot of every table
  n_animales integer,                 -- quick summary counter
  created_at timestamptz not null default now()
);
create index if not exists idx_respaldos_created on respaldos(created_at desc);

create or replace view vw_respaldo_completo as
select jsonb_build_object(
  'animales',              (select coalesce(jsonb_agg(t), '[]'::jsonb) from animales t),
  'eventos_reproductivos', (select coalesce(jsonb_agg(t), '[]'::jsonb) from eventos_reproductivos t),
  'produccion_leche',      (select coalesce(jsonb_agg(t), '[]'::jsonb) from produccion_leche t),
  'eventos_sanitarios',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from eventos_sanitarios t),
  'pesajes',               (select coalesce(jsonb_agg(t), '[]'::jsonb) from pesajes t),
  'movimientos',           (select coalesce(jsonb_agg(t), '[]'::jsonb) from movimientos t)
) as data,
(select count(*) from animales) as n_animales;
