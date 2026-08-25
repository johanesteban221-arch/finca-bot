-- ============================================================================
-- 07 - Total de cantina diario, junto al control individual
-- ----------------------------------------------------------------------------
-- Aplicar DESPUÉS de:
--   schema.sql → alerts_views.sql → backup.sql → 01_bot_schema.sql
--   → 02_multitenant.sql → 03_hoja_de_vida.sql → 04_auth_roles.sql
--   → 05_control_leche_ordeno.sql → 06_leche_agregada.sql
--
-- Idempotente: se puede volver a correr.
--
-- ⚠️ ESTE ARCHIVO ES LA DEFINICIÓN FINAL DE vw_leche_ordeno. La de 06 es la
--    versión base (solo produccion_leche), válida en su punto de la cadena.
--    Volver a correr 06 solo, sin correr 07 después, deja el tablero ciego a
--    los totales de cantina — que son la mayoría de los días. Mismo patrón que
--    03_hoja_de_vida.sql con vw_historial_animal.
--
-- Qué añade:
--
--   El flujo real de la finca son DOS registros, no uno:
--     · Casi todos los días el operario solo tiene el TOTAL DE CANTINA de cada
--       ordeño: un número, sin desglose.
--     · Cada 2-3 semanas hace el CONTEO INDIVIDUAL, vaca por vaca.
--
--   El total no puede vivir en produccion_leche: esa tabla tiene animal_id NOT
--   NULL con FK a animales y alimenta vw_historial_animal. Un total del hato no
--   tiene animal, y meterlo ahí exigiría un animal fantasma tipo «CANTINA» que
--   aparecería en el inventario, en la genealogía y en el listado de ordeño.
--
--   controles_leche sí tiene exactamente esa forma —una fila por finca, fecha y
--   ordeño, con quién y cuándo—, así que discrimina por `tipo` en vez de crear
--   una tabla nueva.
--
-- Los dos conviven en el mismo ordeño A PROPÓSITO (la unicidad se abre a
-- `tipo`). Un día de conteo individual tiene dos mediciones del mismo ordeño
-- con instrumentos distintos, y las dos valen:
--   · la cantina es lo que se vendió;
--   · el desglose es cómo se repartió entre las vacas.
-- La diferencia entre ambas es el CUADRE: 2 L es evaporación y salpicadura;
-- 40 L es alguien ordeñando en balde. Obligar a que se reemplacen destruiría
-- justamente ese dato.
--
-- ⚠️ NO aplicar en el proyecto Supabase real sin aprobación explícita.
-- ============================================================================


-- ============================================================================
-- 1) controles_leche — `tipo` y el total de cantina
-- ----------------------------------------------------------------------------
-- `default 'individual'` rellena bien lo que ya existe: todo control registrado
-- hasta hoy es un conteo vaca por vaca.
--
-- `litros_total` queda NULL en el individual A PROPÓSITO: ahí el total se
-- deriva sumando el detalle. Guardarlo denormalizado es el mismo error que
-- calcular retiro_leche_hasta en dos sitios — se corrige una vaca y el total
-- queda mintiendo, sin que nada avise.
-- ============================================================================
alter table controles_leche
  add column if not exists tipo         text not null default 'individual',
  add column if not exists litros_total numeric(7,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'controles_leche'::regclass and conname = 'ck_control_tipo'
  ) then
    alter table controles_leche add constraint ck_control_tipo
      check (tipo in ('diario','individual'));
  end if;

  -- El invariante que impide una fila a medias: un total de cantina SIN número,
  -- o un conteo individual con un total escrito a mano que nadie derivó.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'controles_leche'::regclass and conname = 'ck_control_total_segun_tipo'
  ) then
    alter table controles_leche add constraint ck_control_total_segun_tipo
      check (
        (tipo = 'diario'     and litros_total is not null and litros_total >= 0)
     or (tipo = 'individual' and litros_total is null)
      );
  end if;
end $$;


-- ============================================================================
-- 2) La unicidad se abre a `tipo`
-- ----------------------------------------------------------------------------
-- Antes: una fila por (finca, fecha, ordeño) — lo que frena el doble envío.
-- Ahora: una por (finca, fecha, ordeño, TIPO) — sigue frenando el doble envío
-- de cada modo, pero deja que el conteo individual y el total de cantina del
-- mismo ordeño coexistan, que es el caso normal cada 2-3 semanas.
-- ============================================================================
alter table controles_leche drop constraint if exists uq_control_finca_fecha_ordeno;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'controles_leche'::regclass
       and conname  = 'uq_control_finca_fecha_ordeno_tipo'
  ) then
    alter table controles_leche add constraint uq_control_finca_fecha_ordeno_tipo
      unique (finca_id, fecha, ordeno, tipo);
  end if;
end $$;

create index if not exists idx_controles_leche_tipo_fecha
  on controles_leche(finca_id, tipo, fecha);


-- ============================================================================
-- 3) vw_leche_ordeno — definición FINAL (reemplaza la de db/06)
-- ----------------------------------------------------------------------------
-- Una fila por finca, fecha y ordeño, venga de donde venga la medición.
--
-- ⚠️ El volumen del hato es el de CANTINA cuando existe, y solo cae al desglose
-- cuando no hay cantina. No es arbitrario: la cantina es el instrumento que hay
-- TODOS los días, y el desglose solo uno de cada quince. Preferir el desglose
-- los días que existe metería un instrumento distinto en la serie y dibujaría
-- un escalón cada 2-3 semanas que no pasó en el potrero — la suma de las vacas
-- siempre queda algo por debajo de la cantina (salpicadura, leche del ternero,
-- la vaca que se ordeñó en balde).
--
-- `vacas` y `litros_individual` quedan NULL los días de solo cantina: no se
-- sabe cuántas vacas se ordeñaron, y poner un número sería inventarlo.
-- ============================================================================
create or replace view vw_leche_ordeno
with (security_invoker = true) as
with individual as (
  select finca_id, fecha, ordeno,
         sum(litros)::numeric(10,2)     as litros,
         count(distinct animal_id)::int as vacas
    from produccion_leche
   group by finca_id, fecha, ordeno
),
cantina as (
  select finca_id, fecha, ordeno, litros_total
    from controles_leche
   where tipo = 'diario'
)
select
  coalesce(c.finca_id, i.finca_id)                  as finca_id,
  coalesce(c.fecha, i.fecha)                        as fecha,
  coalesce(c.ordeno, i.ordeno)                      as ordeno,
  coalesce(c.litros_total, i.litros)::numeric(10,2) as litros,
  case when c.litros_total is not null then 'cantina' else 'individual' end as medido_con,
  c.litros_total                                    as litros_cantina,
  i.litros                                          as litros_individual,
  i.vacas                                           as vacas
from cantina c
full outer join individual i
  on  i.finca_id = c.finca_id
  and i.fecha    = c.fecha
  and i.ordeno   = c.ordeno;


-- ============================================================================
-- 4) Verificación
-- ----------------------------------------------------------------------------
--   select column_name, is_nullable from information_schema.columns
--    where table_name = 'controles_leche' order by ordinal_position;
--   -- espera: tipo NOT NULL, litros_total NULLABLE
--
--   select conname from pg_constraint where conrelid = 'controles_leche'::regclass;
--   -- espera: ck_control_tipo, ck_control_total_segun_tipo,
--   --         uq_control_finca_fecha_ordeno_tipo
--   --  y NO:  uq_control_finca_fecha_ordeno
--
--   -- El cuadre de los ordeños que tienen las dos mediciones:
--   select fecha, ordeno, litros_cantina, litros_individual, vacas,
--          round(litros_cantina - litros_individual, 2) as diferencia
--     from vw_leche_ordeno
--    where litros_cantina is not null and litros_individual is not null
--    order by fecha desc;
-- ============================================================================
