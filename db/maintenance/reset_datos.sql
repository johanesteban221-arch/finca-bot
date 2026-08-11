-- ============================================================================
-- ⚠️  DESTRUCTIVO E IRREVERSIBLE — vacía las tablas de datos del hato
-- ----------------------------------------------------------------------------
-- Este archivo NO forma parte de la cadena de migración de db/ (schema →
-- alerts_views → backup → 01 → 02). Nunca lo apliques como paso de despliegue.
--
-- BORRA (solo filas, la estructura queda intacta):
--   animales · eventos_sanitarios · eventos_reproductivos · pesajes
--   movimientos · produccion_leche · confirmaciones_pendientes
--   whatsapp_sessions
--   chequeos_reproductivos · protocolos_sincronizacion · protocolo_aplicaciones
--   controles_leche                                    (db/03_hoja_de_vida.sql)
--
-- NO TOCA:
--   fincas · whatsapp_users · whatsapp_user_fincas · cat_* (todos los catálogos)
--
-- ----------------------------------------------------------------------------
-- ANTES DE CORRER ESTO, LEE
-- ----------------------------------------------------------------------------
-- 1. La base de Fase 0 es la finca real del fundador, no un entorno de pruebas.
--    Si hay registros reales mezclados con los de prueba, se pierden. En
--    particular `eventos_sanitarios` guarda los retiros de leche vigentes y la
--    trazabilidad sanitaria (ICA / SINIGAN): es registro regulatorio, no un log.
--
-- 2. Saca un respaldo primero. El proyecto ya tiene dos caminos:
--      · GET /api/cron/backup?secret=CRON_SECRET  → volcado JSON completo
--      · select * from vw_respaldo_completo;      → misma data desde SQL
--    Guárdalo FUERA de la base antes de continuar.
--
-- 3. ⚠️ TRAMPA DE RLS: desde la tarea #2 estas tablas tienen RLS activo con
--    políticas fail-closed (`finca_id = current_setting('app.finca_id', true)`).
--    Un rol sujeto a RLS sin ese GUC configurado NO ve ninguna fila, así que el
--    DELETE borraría CERO filas y parecería que funcionó. El editor SQL de
--    Supabase corre como `postgres` (BYPASSRLS) y no tiene el problema, pero si
--    ejecutas esto desde otra conexión, verifica los conteos del paso 3.
--
-- 4. Corre las secciones EN ORDEN: 1 (conteos) → 2 (ensayo en seco) → 3 (real).
--    Están separadas a propósito para que no se ejecute todo de un tirón.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 — ANTES: dónde estás parado y cuánto hay. Solo lectura.
-- ============================================================================
select current_database() as base, current_user as usuario, now() as momento;

select 'animales'                as tabla, count(*) as filas from animales
union all select 'eventos_sanitarios',      count(*) from eventos_sanitarios
union all select 'eventos_reproductivos',   count(*) from eventos_reproductivos
union all select 'pesajes',                 count(*) from pesajes
union all select 'movimientos',             count(*) from movimientos
union all select 'produccion_leche',        count(*) from produccion_leche
union all select 'confirmaciones_pendientes', count(*) from confirmaciones_pendientes
union all select 'whatsapp_sessions',       count(*) from whatsapp_sessions
union all select 'chequeos_reproductivos',  count(*) from chequeos_reproductivos
union all select 'protocolos_sincronizacion', count(*) from protocolos_sincronizacion
union all select 'protocolo_aplicaciones',  count(*) from protocolo_aplicaciones
union all select 'controles_leche',         count(*) from controles_leche
order by tabla;

-- Lo que debe sobrevivir. Anota estos números: al final tienen que ser iguales.
select 'fincas'          as tabla, count(*) as filas from fincas
union all select 'whatsapp_users', count(*) from whatsapp_users
union all select 'cat_vacunas',    count(*) from cat_vacunas
union all select 'cat_medicamentos', count(*) from cat_medicamentos
union all select 'cat_diagnosticos', count(*) from cat_diagnosticos
union all select 'cat_razas',       count(*) from cat_razas
union all select 'cat_tecnicos',    count(*) from cat_tecnicos
union all select 'cat_causas_mortalidad', count(*) from cat_causas_mortalidad
order by tabla;


-- ============================================================================
-- SECCIÓN 2 — ENSAYO EN SECO. Borra, te muestra el resultado y REVIERTE.
--             No deja nada borrado. Córrela completa, de `begin` a `rollback`.
-- ============================================================================
begin;

  -- Orden de borrado: primero todo lo que apunta a `animales`, después
  -- `animales`. Las FKs a animales son ON DELETE CASCADE (animal_id) y
  -- ON DELETE SET NULL (toro_id, cria_id, madre_id, padre_id), pero el borrado
  -- se hace explícito y en orden para no depender de ese comportamiento.

  -- 2.1 Nietas primero: cuelgan de otra hija, no solo de `animales`.
  --     protocolo_aplicaciones → protocolos_sincronizacion
  --     chequeos_reproductivos y protocolos apuntan además a eventos_sanitarios /
  --     eventos_reproductivos (ON DELETE SET NULL), así que van antes que ellos
  --     para que el borrado sea determinista y no dispare updates de RI.
  delete from protocolo_aplicaciones;
  delete from protocolos_sincronizacion;
  delete from chequeos_reproductivos;

  -- 2.2 Hijas de `animales`
  delete from eventos_sanitarios;
  delete from pesajes;
  delete from movimientos;
  delete from produccion_leche;        -- también hija de controles_leche (control_id)
  delete from controles_leche;
  delete from eventos_reproductivos;   -- apunta a animales por animal_id, toro_id y cria_id

  -- 2.3 Tablas sin FK hacia animales
  delete from confirmaciones_pendientes;
  delete from whatsapp_sessions;

  -- 2.4 Genealogía: animales se referencia a sí misma (madre_id / padre_id).
  --     Con ON DELETE SET NULL el borrado masivo funciona igual, pero limpiar
  --     los enlaces primero lo vuelve determinista y evita que el trigger de RI
  --     actualice filas que están a punto de desaparecer.
  update animales set madre_id = null, padre_id = null;
  delete from animales;

  -- Verificación: todo esto debe dar 0.
  select 'animales'                as tabla, count(*) as filas from animales
  union all select 'eventos_sanitarios',      count(*) from eventos_sanitarios
  union all select 'eventos_reproductivos',   count(*) from eventos_reproductivos
  union all select 'pesajes',                 count(*) from pesajes
  union all select 'movimientos',             count(*) from movimientos
  union all select 'produccion_leche',        count(*) from produccion_leche
  union all select 'confirmaciones_pendientes', count(*) from confirmaciones_pendientes
  union all select 'whatsapp_sessions',       count(*) from whatsapp_sessions
  union all select 'chequeos_reproductivos',  count(*) from chequeos_reproductivos
  union all select 'protocolos_sincronizacion', count(*) from protocolos_sincronizacion
  union all select 'protocolo_aplicaciones',  count(*) from protocolo_aplicaciones
  union all select 'controles_leche',         count(*) from controles_leche
  order by tabla;

  -- Y esto NO debe haber cambiado.
  select 'fincas'          as tabla, count(*) as filas from fincas
  union all select 'whatsapp_users', count(*) from whatsapp_users
  union all select 'cat_vacunas',    count(*) from cat_vacunas
  union all select 'cat_medicamentos', count(*) from cat_medicamentos
  union all select 'cat_diagnosticos', count(*) from cat_diagnosticos
  union all select 'cat_razas',       count(*) from cat_razas
  union all select 'cat_tecnicos',    count(*) from cat_tecnicos
  union all select 'cat_causas_mortalidad', count(*) from cat_causas_mortalidad
  order by tabla;

rollback;   -- <<< nada de lo anterior queda aplicado


-- ============================================================================
-- SECCIÓN 3 — EL BORRADO REAL.
--
--   ⚠️ Solo llega aquí si (a) tienes el respaldo guardado fuera de la base y
--      (b) los conteos del ensayo en seco fueron los que esperabas.
--
--   Está comentada a propósito. Para ejecutarla, quita el /* y el */ que la
--   encierran y córrela completa. Es la última oportunidad de arrepentirse.
-- ============================================================================
/*
begin;

  delete from protocolo_aplicaciones;
  delete from protocolos_sincronizacion;
  delete from chequeos_reproductivos;

  delete from eventos_sanitarios;
  delete from pesajes;
  delete from movimientos;
  delete from produccion_leche;
  delete from controles_leche;
  delete from eventos_reproductivos;

  delete from confirmaciones_pendientes;
  delete from whatsapp_sessions;

  update animales set madre_id = null, padre_id = null;
  delete from animales;

commit;
*/


-- ============================================================================
-- SECCIÓN 4 — DESPUÉS: confirma el estado final. Solo lectura.
-- ============================================================================
select 'animales'                as tabla, count(*) as filas from animales
union all select 'eventos_sanitarios',      count(*) from eventos_sanitarios
union all select 'eventos_reproductivos',   count(*) from eventos_reproductivos
union all select 'pesajes',                 count(*) from pesajes
union all select 'movimientos',             count(*) from movimientos
union all select 'produccion_leche',        count(*) from produccion_leche
union all select 'confirmaciones_pendientes', count(*) from confirmaciones_pendientes
union all select 'whatsapp_sessions',       count(*) from whatsapp_sessions
union all select 'chequeos_reproductivos',  count(*) from chequeos_reproductivos
union all select 'protocolos_sincronizacion', count(*) from protocolos_sincronizacion
union all select 'protocolo_aplicaciones',  count(*) from protocolo_aplicaciones
union all select 'controles_leche',         count(*) from controles_leche
order by tabla;


-- ============================================================================
-- ALTERNATIVA — borrado selectivo por finca (multi-tenant, Fase 1)
-- ----------------------------------------------------------------------------
-- Cuando haya más de una finca, vaciar la base entera deja de ser aceptable.
-- Mismo orden, acotado a un tenant. Reemplaza el UUID antes de usar.
-- ----------------------------------------------------------------------------
-- El UUID va literal en cada línea: el editor SQL de Supabase no es psql, así
-- que \set y :variables no funcionan ahí. Reemplázalo con buscar/reemplazar.
/*
begin;

  delete from protocolo_aplicaciones    where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from protocolos_sincronizacion where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from chequeos_reproductivos    where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from eventos_sanitarios        where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from pesajes                   where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from movimientos               where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from produccion_leche          where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from controles_leche           where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from eventos_reproductivos     where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from confirmaciones_pendientes where finca_id = '00000000-0000-0000-0000-000000000001';

  -- whatsapp_sessions no tiene finca_id todavía (diferido en 02_multitenant.sql),
  -- así que aquí hay que acotar por teléfono, no por finca.

  update animales set madre_id = null, padre_id = null
    where finca_id = '00000000-0000-0000-0000-000000000001';
  delete from animales where finca_id = '00000000-0000-0000-0000-000000000001';

commit;
*/
