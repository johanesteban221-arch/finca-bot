-- ============================================================================
-- 06 - Control lechero por ordeño: quién, cuándo, y sin duplicados
-- ----------------------------------------------------------------------------
-- Aplicar DESPUÉS de:
--   schema.sql → alerts_views.sql → backup.sql → 01_bot_schema.sql
--   → 02_multitenant.sql → 03_hoja_de_vida.sql → 04_auth_roles.sql
--
-- Idempotente: se puede volver a correr.
--
-- Qué resuelve, en orden de gravedad:
--
--   1. produccion_leche NO tenía unicidad. Un doble toque en "Guardar" —con la
--      señal del corral, el escenario normal— escribía los litros dos veces, y
--      analytics.ts suma litros sin mirar nada: la producción del hato quedaba
--      inflada SIN NINGÚN SÍNTOMA. Hoy está tapado por accidente porque
--      uq_control_finca_fecha impide el segundo control del día; en cuanto se
--      permita volver el mismo día (punto 2) se destapa. Por eso va primero.
--
--   2. Un control por finca y día hacía IMPOSIBLE registrar la tarde después de
--      la mañana: el segundo guardado chocaba con la unicidad. La mañana es a
--      las 5 y la tarde a las 3, separadas por diez horas — no son una sentada.
--      Cada ordeño pasa a ser su propio control.
--
--   3. `medido_por` era texto libre y editable: el operario podía escribir
--      cualquier cosa o nada. Ahora la identidad la pone el servidor desde la
--      sesión, y `medido_por` queda como copia desnormalizada del nombre.
--
-- ⚠️ NO aplicar en el proyecto Supabase real sin aprobación explícita.
--    Aprobado por el fundador el 2026-08-24 con controles_leche vacía.
-- ============================================================================


-- ============================================================================
-- 1) produccion_leche — una lectura por vaca, fecha y ordeño
-- ----------------------------------------------------------------------------
-- Va PRIMERO, antes de tocar controles_leche: es el que protege el dato.
--
-- Si esta sentencia falla con "could not create unique index", ya hay duplicados
-- en la tabla y hay que verlos antes de seguir. Esta consulta los lista:
--
--   select animal_id, fecha, ordeno, count(*), sum(litros)
--     from produccion_leche
--    group by animal_id, fecha, ordeno
--   having count(*) > 1
--    order by fecha desc;
--
-- El índice cubre las tres fuentes (manual · control · hardware) a propósito: el
-- ESP32 del futuro tampoco debe poder escribir dos veces el mismo ordeño, y
-- ordeno='total' queda igual de protegido.
-- ============================================================================
create unique index if not exists uq_leche_animal_fecha_ordeno
  on produccion_leche(animal_id, fecha, ordeno);


-- ============================================================================
-- 2) controles_leche — un control POR ORDEÑO, no por día
-- ----------------------------------------------------------------------------
-- `ordeno` se llena y se marca NOT NULL en el mismo paso porque la tabla está
-- vacía (verificado antes de aprobar este archivo). Si algún día se corre sobre
-- datos, el `update` de abajo los deja todos como 'manana', que sería falso para
-- la mitad — revisar antes en ese caso.
-- ============================================================================
alter table controles_leche
  add column if not exists ordeno     text,
  -- La FK autoritativa: quién estaba autenticado. `on delete set null` porque
  -- borrar un usuario no puede borrar la producción de leche de la finca.
  add column if not exists created_by uuid references usuarios(id) on delete set null;

do $$
begin
  -- CHECK del vocabulario. Espejo de produccion_leche.ordeno menos 'total':
  -- un control es de un ordeño concreto, nunca del agregado.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'controles_leche'::regclass
       and conname  = 'ck_control_ordeno'
  ) then
    alter table controles_leche add constraint ck_control_ordeno
      check (ordeno in ('manana','tarde'));
  end if;

  -- NOT NULL solo si no quedan filas sin ordeño (tabla vacía = trivial).
  update controles_leche set ordeno = 'manana' where ordeno is null;

  if exists (
    select 1 from information_schema.columns
     where table_name = 'controles_leche'
       and column_name = 'ordeno'
       and is_nullable = 'YES'
  ) then
    alter table controles_leche alter column ordeno set not null;
  end if;
end $$;

-- La unicidad se mueve de (finca, fecha) a (finca, fecha, ordeño).
-- Sigue frenando el doble envío —que es para lo que estaba— pero ya no confunde
-- "la tarde del mismo día" con "un reenvío".
alter table controles_leche drop constraint if exists uq_control_finca_fecha;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'controles_leche'::regclass
       and conname  = 'uq_control_finca_fecha_ordeno'
  ) then
    alter table controles_leche add constraint uq_control_finca_fecha_ordeno
      unique (finca_id, fecha, ordeno);
  end if;
end $$;

create index if not exists idx_controles_leche_created_by on controles_leche(created_by);


-- ============================================================================
-- 3) Verificación (debe devolver la forma nueva)
-- ----------------------------------------------------------------------------
--   select column_name, is_nullable, data_type
--     from information_schema.columns
--    where table_name = 'controles_leche'
--    order by ordinal_position;
--
--   select conname from pg_constraint
--    where conrelid = 'controles_leche'::regclass;
--   -- espera: ck_control_ordeno, uq_control_finca_fecha_ordeno
--   --  y NO:  uq_control_finca_fecha
--
--   select indexname from pg_indexes where tablename = 'produccion_leche';
--   -- espera: uq_leche_animal_fecha_ordeno
-- ============================================================================
