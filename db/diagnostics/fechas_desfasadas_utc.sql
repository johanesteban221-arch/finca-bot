-- ============================================================================
-- DIAGNÓSTICO (solo lectura) — filas fechadas un día adelante por el bug de UTC
-- ----------------------------------------------------------------------------
-- ⚠️ Este archivo NO forma parte de la cadena de migración de db/. Es de
--    diagnóstico: contiene únicamente SELECT. No modifica nada. No lo agregues
--    al orden de aplicación (schema → alerts_views → backup → 01 → 02).
--
-- CONTEXTO
-- Hasta el fix de src/lib/dates.ts, todas las fechas se construían con
-- `new Date().toISOString().slice(0, 10)`, que devuelve el día calendario en
-- UTC. La finca opera en America/Bogota (UTC-5, sin horario de verano), así que
-- todo lo registrado entre las 19:00 y las 23:59 hora local ya era el día
-- siguiente en UTC y quedó guardado con la fecha de mañana.
--
-- CÓMO SE IDENTIFICAN
-- Ningún flujo del bot permite retrofechar: `fecha` siempre era `today()` en el
-- momento del INSERT. Por lo tanto, para filas escritas por el bot,
-- `fecha` debería coincidir con la fecha local de `created_at`. Cuando no
-- coincide, la fila es candidata.
--
-- ⚠️ ESA PREMISA YA NO ES UNIVERSAL. Desde db/03_hoja_de_vida.sql, las funciones
--    de dominio aceptan una `fecha` explícita y los formularios del dashboard
--    (Bloque D) van a retrofechar de forma legítima: el veterinario captura el
--    lunes los chequeos del sábado. Para esas filas, `fecha <> fecha local de
--    created_at` es NORMAL, no un síntoma.
--
--    Este diagnóstico sigue siendo válido tal como está porque acota el barrido
--    a las cuatro tablas que ya existían cuando ocurrió el bug
--    (eventos_sanitarios, eventos_reproductivos, pesajes, movimientos) y exige
--    además la firma horaria (created_at entre 00:00 y 04:59 UTC). Las tablas
--    nuevas —chequeos_reproductivos, protocolo_aplicaciones, controles_leche—
--    NO se agregan aquí a propósito: nacieron después del fix de dates.ts, no
--    pueden tener filas afectadas, y sus fechas retrofechadas darían falsos
--    positivos.
--
--    Si alguna vez se retrofecha en las cuatro tablas de abajo, la consulta 7
--    (control) empezará a reportar filas legítimas. Revisar antes de corregir.
--
-- La FIRMA del bug es exacta y verificable:
--   desfase = +1 día  Y  created_at cae entre las 00:00 y 04:59 UTC
--                        (= 19:00 a 23:59 en la finca)
--
-- Cualquier desfase que NO cumpla esa firma se reporta aparte (consulta 7): no
-- viene de este bug, puede ser carga histórica, n8n WF-01 o edición manual.
-- Revísalo antes de corregir nada.
--
-- COLUMNAS DERIVADAS
-- En eventos_sanitarios, `proxima_fecha` y `retiro_leche_hasta` se calcularon
-- sumando días sobre ese mismo `today()` equivocado, así que en las filas
-- afectadas están corridas el mismo día. Ver consulta 6.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) RESUMEN — cuántas filas candidatas hay por tabla
--    Empieza por aquí: si todo da 0, no hay nada que corregir.
-- ----------------------------------------------------------------------------
with afectadas as (
  select 'eventos_sanitarios'   as tabla, fecha, created_at from eventos_sanitarios
  union all
  select 'eventos_reproductivos', fecha, created_at from eventos_reproductivos
  union all
  select 'pesajes',               fecha, created_at from pesajes
  union all
  select 'movimientos',           fecha, created_at from movimientos
  union all
  select 'animales (fecha_nacimiento, solo crías de parto)', fecha_nacimiento, created_at
    from animales
   where origen = 'nacido_en_finca'
     and fecha_nacimiento is not null
)
select
  tabla,
  count(*)                                                        as filas_desfasadas,
  min(fecha)                                                      as primera,
  max(fecha)                                                      as ultima
from afectadas
where fecha is not null
  and fecha - (created_at at time zone 'America/Bogota')::date = 1
  and extract(hour from (created_at at time zone 'UTC')) < 5
group by tabla
order by filas_desfasadas desc;


-- ----------------------------------------------------------------------------
-- 2) DETALLE — eventos_sanitarios (vacunación, tratamiento, desparasitación)
--    Es la tabla con más impacto: arrastra dos fechas derivadas.
-- ----------------------------------------------------------------------------
select
  e.id,
  a.arete,
  e.tipo,
  e.producto,
  e.fecha                                             as fecha_guardada,
  (e.created_at at time zone 'America/Bogota')::date  as fecha_correcta,
  (e.created_at at time zone 'America/Bogota')::time  as hora_finca,
  e.proxima_fecha,
  e.retiro_leche_hasta
from eventos_sanitarios e
left join animales a on a.id = e.animal_id
where e.fecha - (e.created_at at time zone 'America/Bogota')::date = 1
  and extract(hour from (e.created_at at time zone 'UTC')) < 5
order by e.created_at;


-- ----------------------------------------------------------------------------
-- 3) DETALLE — eventos_reproductivos (servicio, dx preñez, parto)
--    Ojo: un servicio mal fechado corre también el estimado de parto (+283 d)
--    que calcula analytics.ts, y la ventana de alerta de dx preñez (+40 d).
-- ----------------------------------------------------------------------------
select
  e.id,
  a.arete,
  e.tipo,
  e.fecha                                             as fecha_guardada,
  (e.created_at at time zone 'America/Bogota')::date  as fecha_correcta,
  (e.created_at at time zone 'America/Bogota')::time  as hora_finca
from eventos_reproductivos e
left join animales a on a.id = e.animal_id
where e.fecha - (e.created_at at time zone 'America/Bogota')::date = 1
  and extract(hour from (e.created_at at time zone 'UTC')) < 5
order by e.created_at;


-- ----------------------------------------------------------------------------
-- 4) DETALLE — pesajes (incluye los pesos de nacimiento creados desde un parto)
--    Un pesaje mal fechado distorsiona la GDP (ganancia diaria de peso).
-- ----------------------------------------------------------------------------
select
  p.id,
  a.arete,
  p.tipo,
  p.peso_kg,
  p.fecha                                             as fecha_guardada,
  (p.created_at at time zone 'America/Bogota')::date  as fecha_correcta,
  (p.created_at at time zone 'America/Bogota')::time  as hora_finca
from pesajes p
left join animales a on a.id = p.animal_id
where p.fecha - (p.created_at at time zone 'America/Bogota')::date = 1
  and extract(hour from (p.created_at at time zone 'UTC')) < 5
order by p.created_at;


-- ----------------------------------------------------------------------------
-- 5) DETALLE — movimientos (bajas por mortalidad) y animales (crías de parto)
-- ----------------------------------------------------------------------------
select
  'movimientos' as tabla,
  m.id::text,
  a.arete,
  m.fecha                                             as fecha_guardada,
  (m.created_at at time zone 'America/Bogota')::date  as fecha_correcta,
  (m.created_at at time zone 'America/Bogota')::time  as hora_finca
from movimientos m
left join animales a on a.id = m.animal_id
where m.fecha - (m.created_at at time zone 'America/Bogota')::date = 1
  and extract(hour from (m.created_at at time zone 'UTC')) < 5

union all

select
  'animales.fecha_nacimiento',
  an.id::text,
  an.arete,
  an.fecha_nacimiento,
  (an.created_at at time zone 'America/Bogota')::date,
  (an.created_at at time zone 'America/Bogota')::time
from animales an
where an.origen = 'nacido_en_finca'
  and an.fecha_nacimiento is not null
  and an.fecha_nacimiento - (an.created_at at time zone 'America/Bogota')::date = 1
  and extract(hour from (an.created_at at time zone 'UTC')) < 5
order by 5;


-- ----------------------------------------------------------------------------
-- 6) IMPACTO OPERATIVO VIGENTE — filas afectadas cuyas fechas derivadas siguen
--    en el futuro. Estas son las que todavía pueden hacer daño hoy: un retiro
--    de leche que vence un día tarde, o una próxima dosis que se agenda tarde.
--    Prioriza estas si vas a corregir algo.
-- ----------------------------------------------------------------------------
select
  a.arete,
  e.tipo,
  e.producto,
  e.fecha                                             as fecha_guardada,
  (e.created_at at time zone 'America/Bogota')::date  as fecha_correcta,
  e.proxima_fecha,
  e.retiro_leche_hasta,
  case
    when e.retiro_leche_hasta >= (now() at time zone 'America/Bogota')::date
      then 'retiro de leche vigente — vence 1 día tarde'
    else 'próxima dosis agendada 1 día tarde'
  end                                                 as impacto
from eventos_sanitarios e
left join animales a on a.id = e.animal_id
where e.fecha - (e.created_at at time zone 'America/Bogota')::date = 1
  and extract(hour from (e.created_at at time zone 'UTC')) < 5
  and (
    e.retiro_leche_hasta >= (now() at time zone 'America/Bogota')::date
    or e.proxima_fecha    >= (now() at time zone 'America/Bogota')::date
  )
order by e.retiro_leche_hasta nulls last, e.proxima_fecha;


-- ----------------------------------------------------------------------------
-- 7) CONTROL — desfases que NO corresponden a este bug
--    Deberían ser 0 filas. Si aparece algo, NO lo corrijas junto con lo
--    anterior: es carga histórica, n8n WF-01 o edición manual, y merece
--    revisión aparte. Sirve además para confirmar que la firma del bug es la
--    explicación completa del desfase.
-- ----------------------------------------------------------------------------
with todas as (
  select 'eventos_sanitarios'    as tabla, id::text, fecha, created_at from eventos_sanitarios
  union all
  select 'eventos_reproductivos', id::text, fecha, created_at from eventos_reproductivos
  union all
  select 'pesajes',               id::text, fecha, created_at from pesajes
  union all
  select 'movimientos',           id::text, fecha, created_at from movimientos
)
select
  tabla,
  id,
  fecha                                             as fecha_guardada,
  (created_at at time zone 'America/Bogota')::date  as fecha_local_creacion,
  fecha - (created_at at time zone 'America/Bogota')::date as dias_desfase,
  (created_at at time zone 'UTC')::time             as hora_utc
from todas
where fecha is not null
  and fecha <> (created_at at time zone 'America/Bogota')::date
  and not (
    fecha - (created_at at time zone 'America/Bogota')::date = 1
    and extract(hour from (created_at at time zone 'UTC')) < 5
  )
order by abs(fecha - (created_at at time zone 'America/Bogota')::date) desc, created_at;
