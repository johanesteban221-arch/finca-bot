-- ============================================================================
-- 06 - Producción de leche agregada por ordeño
-- ----------------------------------------------------------------------------
-- Aplicar DESPUÉS de:
--   schema.sql → alerts_views.sql → backup.sql → 01_bot_schema.sql
--   → 02_multitenant.sql → 03_hoja_de_vida.sql → 04_auth_roles.sql
--   → 05_control_leche_ordeno.sql
--
-- Idempotente: se puede volver a correr.
--
-- Qué resuelve:
--
--   El hato se mide vaca por vaca, con medidor, en los DOS ordeños, TODOS los
--   días. El tablero traía esas filas crudas y las sumaba en JavaScript:
--
--       select animal_id, fecha, litros from produccion_leche
--        where finca_id = … and fecha >= hoy - 30
--
--   PostgREST corta la respuesta en `max-rows` (1000 por defecto en Supabase).
--   Con 20 vacas son 20 × 2 × 30 = 1200 filas, y pasado el tope el tablero
--   sumaba datos TRUNCADOS: ningún error, ninguna fila vacía, solo una
--   producción más baja que la real. Es la misma familia de fallo silencioso
--   que destapó el índice único de db/05 — el dato equivocado se ve idéntico al
--   correcto.
--
--   La vista mueve la suma a Postgres: 30 días son ~60 filas (dos por día) en
--   vez de 1200+, así que el tope queda a dos órdenes de magnitud. El día que
--   entre el ESP32 escribiendo en produccion_leche, esto no cambia.
--
-- ⚠️ NO aplicar en el proyecto Supabase real sin aprobación explícita.
-- ============================================================================


-- ============================================================================
-- 1) Índice compuesto para el filtro real de la vista
-- ----------------------------------------------------------------------------
-- La consulta filtra por finca_id Y por fecha. Los índices que ya existen son
-- de una sola columna (idx_leche_fecha, y el idx_produccion_leche_finca de
-- 02_multitenant.sql), así que Postgres tenía que elegir uno y filtrar el resto
-- a mano. Con dos ordeños diarios la tabla crece ~730 filas por vaca al año.
-- ============================================================================
create index if not exists idx_leche_finca_fecha
  on produccion_leche(finca_id, fecha);


-- ============================================================================
-- 2) vw_leche_ordeno — una fila por finca, día y ordeño
-- ----------------------------------------------------------------------------
-- `security_invoker = true` como todas las vistas de 03: sin él, una vista corre
-- con los permisos de su DUEÑO y evade el RLS de quien consulta. Inocuo hoy bajo
-- service_role; en Fase 1 sería una fuga entre fincas.
--
-- No agrupa por `fuente` a propósito: control, manual y hardware son leche del
-- MISMO ordeño y suman juntas. Y no pueden duplicarse, porque
-- uq_leche_animal_fecha_ordeno (db/05) admite una sola fila por vaca, día y
-- ordeño sea cual sea la fuente.
--
-- ⚠️ `ordeno` admite un tercer valor, 'total', que es además el DEFAULT de la
-- columna en schema.sql. Ninguna ruta de escritura lo produce hoy —la regla del
-- proyecto es que el total NO se guarda, se deriva sumando— pero un INSERT
-- suelto que omita `ordeno` caería ahí y esta vista lo sumaría como un tercer
-- ordeño del día, inflando la producción. Se detecta con:
--     db/diagnostics/leche_total_conviviendo.sql
-- ============================================================================
create or replace view vw_leche_ordeno
with (security_invoker = true) as
select
  finca_id,
  fecha,
  ordeno,
  sum(litros)::numeric(10,2)     as litros,
  count(distinct animal_id)::int as vacas
from produccion_leche
group by finca_id, fecha, ordeno;


-- ============================================================================
-- 3) Verificación
-- ----------------------------------------------------------------------------
--   select * from vw_leche_ordeno order by fecha desc, ordeno limit 10;
--
--   -- Debe cuadrar con la suma cruda del mismo período:
--   select (select coalesce(sum(litros), 0) from vw_leche_ordeno
--            where fecha >= current_date - 30)
--        = (select coalesce(sum(litros), 0) from produccion_leche
--            where fecha >= current_date - 30) as cuadra;
--
--   select indexname from pg_indexes where tablename = 'produccion_leche';
--   -- espera, entre otros: idx_leche_finca_fecha
-- ============================================================================
