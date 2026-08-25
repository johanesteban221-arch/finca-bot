-- ============================================================================
-- Diagnóstico (SOLO LECTURA): filas de leche con ordeno = 'total'
-- ----------------------------------------------------------------------------
-- La regla del proyecto es que el total de un ordeño NO se guarda: se deriva
-- sumando mañana + tarde. Pero produccion_leche.ordeno todavía admite 'total' y
-- ese es el DEFAULT de la columna (schema.sql), así que un INSERT que omita
-- `ordeno` aterriza ahí en silencio.
--
-- Importa porque vw_leche_ordeno (db/06) agrupa por ordeño: una fila 'total'
-- aparece como un tercer ordeño del día y SUMA, inflando la producción del hato
-- sin ningún síntoma.
--
-- Sin sentencias de escritura: este archivo se puede pegar tal cual.
-- ============================================================================

-- 1) ¿Existe alguna fila 'total'?
select fecha, count(*) as filas, sum(litros) as litros
  from produccion_leche
 where ordeno = 'total'
 group by fecha
 order by fecha desc;

-- 2) Las graves: la misma vaca y el mismo día con 'total' Y con un ordeño real.
--    Cada una de estas está contando su leche dos veces.
select p.animal_id, a.arete, p.fecha,
       max(p.litros) filter (where p.ordeno = 'total')   as litros_total,
       sum(p.litros) filter (where p.ordeno <> 'total')  as litros_ordenos
  from produccion_leche p
  join animales a on a.id = p.animal_id
 where exists (
   select 1 from produccion_leche t
    where t.animal_id = p.animal_id and t.fecha = p.fecha and t.ordeno = 'total')
 group by p.animal_id, a.arete, p.fecha
having count(*) filter (where p.ordeno <> 'total') > 0
 order by p.fecha desc;
