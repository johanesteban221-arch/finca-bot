-- ============================================================================
-- Gestion Ganadera Doble Proposito - Alert views (run AFTER schema.sql)
-- ----------------------------------------------------------------------------
-- vw_alertas unifies every proactive alert the WF-02 dashboard sends by
-- WhatsApp. Bovine reproductive constants used:
--   - Gestation: ~283 days
--   - Estrous cycle: ~21 days
--   - Dry-off: ~60 days before calving
--   - Pregnancy check: from ~40 days after service
-- All logic lives here so WF-02 is just: SELECT * FROM vw_alertas.
--
-- ⚠️ A dried-off cow is STILL PREGNANT, but `estado_reproductivo` is a single
--    column and the dry-off flow moves her from 'prenada' to 'seca'. Every
--    gestation-based alert below therefore has to accept both values — filtering
--    on 'prenada' alone silently drops each cow from the priority-1 calving
--    alert on the very day she is dried off, which is ~60 days before she calves.
--    src/lib/analytics.ts (proximosPartos) carries the same rule; keep them in step.
--
-- `security_invoker = true`: by default a view runs with its owner's privileges
-- and bypasses the caller's RLS. Harmless under service_role today, a cross-farm
-- leak in Phase 1.
-- ============================================================================

create or replace view vw_alertas
with (security_invoker = true) as

-- 1) Parto proximo (<= 10 days): pregnant cows, expected calving = last service + 283d
select a.arete, a.nombre, 'parto_proximo'::text as tipo_alerta,
       'Parto esperado el ' || to_char((s.fecha + 283), 'YYYY-MM-DD') as detalle,
       1 as prioridad,
       (s.fecha + 283) as fecha_relevante
  from animales a
  join lateral (
        select fecha from eventos_reproductivos e
         where e.animal_id = a.id and e.tipo = 'servicio'
         order by fecha desc limit 1
       ) s on true
 where a.estado = 'activo'
   and a.estado_reproductivo in ('prenada','seca')
   and (s.fecha + 283) between current_date and current_date + 10

union all

-- 2) Secado (calving in 45-65 days): time to dry the cow off.
--    Excludes cows already dried off for this gestation — a 'secado' event
--    recorded after the last service is what closes the alert.
select a.arete, a.nombre, 'secado'::text,
       'Secar: parto esperado el ' || to_char((s.fecha + 283), 'YYYY-MM-DD'),
       2,
       (s.fecha + 283 - 60)
  from animales a
  join lateral (
        select fecha from eventos_reproductivos e
         where e.animal_id = a.id and e.tipo = 'servicio'
         order by fecha desc limit 1
       ) s on true
 where a.estado = 'activo'
   and a.estado_reproductivo in ('prenada','seca')
   and (s.fecha + 283) between current_date + 45 and current_date + 65
   and not exists (
        select 1 from eventos_reproductivos sec
         where sec.animal_id = a.id and sec.tipo = 'secado' and sec.fecha >= s.fecha
       )

union all

-- 3) Celo esperado (~21d cycle): open/served cows not confirmed pregnant
select a.arete, a.nombre, 'celo_esperado'::text,
       'Celo esperado (ciclo de 21 dias) alrededor del ' || to_char((r.fecha + 21), 'YYYY-MM-DD'),
       3,
       (r.fecha + 21)
  from animales a
  join lateral (
        select fecha from eventos_reproductivos e
         where e.animal_id = a.id and e.tipo in ('celo','servicio')
         order by fecha desc limit 1
       ) r on true
 where a.estado = 'activo'
   and a.estado_reproductivo in ('vacia','servida')
   and (r.fecha + 21) between current_date - 1 and current_date + 2

union all

-- 4) Chequeo de prenez pendiente: served >= 40 days ago, no diagnosis since
select a.arete, a.nombre, 'chequear_prenez'::text,
       'Servida el ' || to_char(s.fecha, 'YYYY-MM-DD') || ' sin diagnostico de prenez',
       2,
       s.fecha
  from animales a
  join lateral (
        select fecha from eventos_reproductivos e
         where e.animal_id = a.id and e.tipo = 'servicio'
         order by fecha desc limit 1
       ) s on true
 where a.estado = 'activo'
   and a.estado_reproductivo = 'servida'
   and s.fecha <= current_date - 40
   and not exists (
        select 1 from eventos_reproductivos d
         where d.animal_id = a.id and d.tipo = 'diagnostico_prenez' and d.fecha >= s.fecha
       )

union all

-- NOTE — pending re-checks (chequeos_reproductivos.estado_codigo = 'RECHE') are
-- deliberately NOT a branch of this view. `chequeos_reproductivos` is created in
-- db/03_hoja_de_vida.sql, which applies after this file, so the reference would
-- not resolve on a fresh install. The alert lives in getRechequeosPendientes()
-- in src/lib/alerts.ts, which is the app path that actually runs — this view
-- serves n8n WF-02, superseded by /api/cron/daily-alerts. Do not add a second
-- copy of the "latest check-up per animal" rule here; two copies drift.

-- 5) Sanidad proxima (<= 7 days): vaccines / treatments coming due
select a.arete, a.nombre, 'sanidad'::text,
       coalesce(es.producto, es.tipo) || ' programado el ' || to_char(es.proxima_fecha, 'YYYY-MM-DD'),
       2,
       es.proxima_fecha
  from eventos_sanitarios es
  join animales a on a.id = es.animal_id
 where a.estado = 'activo'
   and es.proxima_fecha between current_date and current_date + 7;

-- Order by priority then date when querying:  ?order=prioridad.asc,fecha_relevante.asc
