-- ============================================================================
-- 03 - Hoja de vida del animal: registro oficial, genealogía extendida,
--      chequeos reproductivos, protocolos de sincronización, secado y
--      control de leche manual.
-- ----------------------------------------------------------------------------
-- Aplicar DESPUÉS de:
--   schema.sql → alerts_views.sql → backup.sql → 01_bot_schema.sql → 02_multitenant.sql
--
-- Idempotente: se puede volver a correr. Solo agrega — no borra ni reescribe datos.
--
-- ⚠️ NO aplicar en el proyecto Supabase real sin aprobación explícita.
--
-- ⚠️ ESTE ARCHIVO ES LA DEFINICIÓN FINAL DE DOS VISTAS:
--      · vw_historial_animal   (definición base en schema.sql)
--      · vw_respaldo_completo  (definición base en backup.sql)
--    Las versiones de esos archivos son válidas en su punto de la cadena —
--    todavía no existen las tablas nuevas — y este archivo las reemplaza al
--    final. Si vuelves a correr schema.sql o backup.sql sueltos, corre también
--    este archivo después o las vistas quedan sin los eventos nuevos.
-- ============================================================================


-- ============================================================================
-- 1) animales — registro oficial + genealogía extendida
-- ----------------------------------------------------------------------------
-- `foto_url` y `padre_externo` ya existían en schema.sql. `madre_externa` es la
-- contraparte que faltaba.
--
-- Las cuatro columnas de abuelos son SOLO PARA GENEALOGÍA EXTERNA: cuando el
-- padre o la madre sí están en el sistema, el abuelo se deriva de
-- madre.padre_id / madre.madre_id. La regla de resolución (ver vw_genealogia,
-- sección 8) es: primero el vínculo real, y solo si no existe, el texto manual.
-- Guardar ambos como fuente de verdad los hace divergir.
-- ============================================================================
alter table animales
  add column if not exists registro_oficial text,   -- ICA / asociación de raza (animales puros)
  add column if not exists madre_externa    text,   -- madre no registrada en el hato
  add column if not exists abuelo_paterno   text,
  add column if not exists abuela_paterna   text,
  add column if not exists abuelo_materno   text,
  add column if not exists abuela_materna   text;

-- Único por finca, no global: en Fase 1 dos fincas pueden manejar registros de
-- asociaciones distintas. Parcial para que los NULL (la mayoría del hato
-- comercial) no compitan entre sí.
create unique index if not exists uq_animales_registro_oficial
  on animales(finca_id, registro_oficial)
  where registro_oficial is not null;


-- ============================================================================
-- 2) Objetivo de las FK compuestas (finca_id, animal_id)
-- ----------------------------------------------------------------------------
-- Una FK simple a animales(id) NO impide que una fila de la finca A apunte a un
-- animal de la finca B: la base aceptaría el cruce y RLS no lo vería (filtra por
-- la fila hija, no por el padre). Las tablas nuevas usan FK compuesta contra
-- este UNIQUE, que sí lo hace imposible a nivel de motor.
--
-- Las 7 tablas de datos anteriores siguen con FK simple; migrarlas es un cambio
-- aparte, no se mezcla aquí.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'animales'::regclass
       and conname  = 'uq_animales_id_finca'
  ) then
    alter table animales add constraint uq_animales_id_finca unique (id, finca_id);
  end if;
end $$;


-- ============================================================================
-- 3) chequeos_reproductivos — palpación / ecografía del veterinario
-- ----------------------------------------------------------------------------
-- Vocabulario clínico (confirmado con el fundador):
--   Estado:      P=preñada · V=vacía · SE=servida
--                VAS=vacía en anestro superficial · VAP=vacía en anestro profundo
--                PP=post-parto
--                RECHE=RECHEQUEO — hay que volver a ecografiar para confirmar
--                      preñez o alguna situación dudosa. NO es descarte y NO
--                      cambia el estado del animal: solo deja pendiente una
--                      revisión nueva.
--   Estructura:  CL1/CL2/CL3=cuerpo lúteo grado 1/2/3 · MF=multifolicular
--                QF=quiste folicular · QL=quiste luteínico
--                F8mm/F10mm/F12mm=folículo por tamaño · FPre=folículo preovulatorio
--
-- `estado_codigo` NO es animales.estado_reproductivo. Ese CHECK
-- (vacia|servida|prenada|parida|seca) es del que dependen vw_alertas y
-- analytics.ts, y no se amplía. El código fino se guarda aquí; el canónico lo
-- propaga src/lib/domain/chequeos.ts con su tabla de mapeo.
--
-- RECHE genera alerta: getRechequeosPendientes() en src/lib/alerts.ts busca los
-- animales cuyo chequeo MÁS RECIENTE quedó en RECHE. Por eso el rechequeo se
-- cierra solo — basta con registrar el chequeo siguiente, no hay campo que
-- marcar a mano. Ese índice (animal_id, fecha desc) es el que sostiene la
-- consulta.
--
-- El tratamiento aplicado NO va en columnas de esta tabla: va como fila de
-- eventos_sanitarios (para que se calcule retiro_leche_hasta desde
-- cat_medicamentos) y aquí queda solo el enlace. Una hormona registrada por
-- fuera de ese camino es leche con retiro vigente saliendo al tanque.
-- ============================================================================
create table if not exists chequeos_reproductivos (
  id                  uuid primary key default gen_random_uuid(),
  finca_id            uuid not null references fincas(id)
                        default '00000000-0000-0000-0000-000000000001',
  animal_id           uuid not null,
  fecha               date not null,
  veterinario         text not null,                  -- copia de cat_tecnicos.nombre
  estado_codigo       text not null
                        check (estado_codigo in ('P','V','SE','VAS','VAP','PP','RECHE')),
  ovario_der_mm       numeric(4,1) check (ovario_der_mm > 0),
  ovario_der_estruct  text check (ovario_der_estruct in
                        ('CL1','CL2','CL3','MF','QF','QL','F8mm','F10mm','F12mm','FPre')),
  ovario_izq_mm       numeric(4,1) check (ovario_izq_mm > 0),
  ovario_izq_estruct  text check (ovario_izq_estruct in
                        ('CL1','CL2','CL3','MF','QF','QL','F8mm','F10mm','F12mm','FPre')),
  observaciones       text,
  evento_sanitario_id uuid references eventos_sanitarios(id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint fk_chequeos_animal foreign key (animal_id, finca_id)
    references animales(id, finca_id) on update cascade on delete cascade
);

-- Un chequeo por animal y día. Evita el doble envío del formulario móvil, que
-- es el error real: el vet toca "guardar" dos veces con señal mala en el
-- potrero. Si alguna vez hay que chequear dos veces el mismo día, quitar esto.
create unique index if not exists uq_chequeo_animal_fecha
  on chequeos_reproductivos(animal_id, fecha);

create index if not exists idx_chequeos_reproductivos_animal on chequeos_reproductivos(animal_id);
create index if not exists idx_chequeos_reproductivos_fecha  on chequeos_reproductivos(fecha);
-- Sostiene la alerta de rechequeo: "último chequeo por animal" ordena por
-- (animal_id, fecha desc) y se queda con la primera fila de cada grupo.
create index if not exists idx_chequeos_reproductivos_animal_fecha
  on chequeos_reproductivos(animal_id, fecha desc);


-- ============================================================================
-- 4) protocolos_sincronizacion + protocolo_aplicaciones
-- ----------------------------------------------------------------------------
-- `fecha_ia` y `resultado` NO son datos independientes: son el reflejo de un
-- eventos_reproductivos. La IA del protocolo se registra con registrarServicio()
-- y el resultado con registrarDxPrenez(), y aquí quedan los enlaces. Si el
-- protocolo guardara su propia IA sin generar el evento, vw_alertas,
-- getPrenezPendientes() y todos los KPIs reproductivos de analytics.ts —que se
-- calculan 100% sobre eventos_reproductivos— no la verían.
-- ============================================================================
create table if not exists protocolos_sincronizacion (
  id                 uuid primary key default gen_random_uuid(),
  finca_id           uuid not null references fincas(id)
                       default '00000000-0000-0000-0000-000000000001',
  animal_id          uuid not null,
  nombre_protocolo   text not null,                   -- 'Ovsynch', 'J-Synch', 'CIDR 7 días'...
  fecha_inicio       date not null,
  veterinario        text,
  estado             text not null default 'en_curso'
                       check (estado in ('en_curso','finalizado','cancelado')),
  fecha_ia           date,
  servicio_evento_id uuid references eventos_reproductivos(id) on delete set null,
  resultado          text check (resultado in ('preno','no_preno')),
  dx_evento_id       uuid references eventos_reproductivos(id) on delete set null,
  notas              text,
  created_at         timestamptz not null default now(),

  constraint fk_protocolos_animal foreign key (animal_id, finca_id)
    references animales(id, finca_id) on update cascade on delete cascade,
  -- No hay resultado sin IA previa.
  constraint ck_protocolos_resultado check (resultado is null or fecha_ia is not null),
  constraint ck_protocolos_ia_orden  check (fecha_ia is null or fecha_ia >= fecha_inicio)
);

-- Un solo protocolo activo por animal. Mismo patrón que uq_pend_telefono_activa
-- en schema.sql. Ojo: por eso existe cancelarProtocolo() en el dominio — sin
-- una forma de cerrar un protocolo abandonado, este índice bloquea el animal
-- para siempre.
create unique index if not exists uq_protocolo_activo
  on protocolos_sincronizacion(animal_id)
  where estado = 'en_curso';

create index if not exists idx_protocolos_sincronizacion_animal on protocolos_sincronizacion(animal_id);
create index if not exists idx_protocolos_sincronizacion_estado on protocolos_sincronizacion(estado);

create table if not exists protocolo_aplicaciones (
  id                  uuid primary key default gen_random_uuid(),
  finca_id            uuid not null references fincas(id)
                        default '00000000-0000-0000-0000-000000000001',
  protocolo_id        uuid not null references protocolos_sincronizacion(id) on delete cascade,
  -- Desnormalizado desde la cabecera: permite que vw_historial_animal lo lea sin
  -- join y que se indexe por animal, que es como se consulta la hoja de vida.
  animal_id           uuid not null,
  dia_numero          integer not null check (dia_numero >= 0),
  fecha               date not null,
  producto            text not null,                  -- PGF2α, GnRH, benzoato...
  dosis               text,
  aplicado_por        text,
  evento_sanitario_id uuid references eventos_sanitarios(id) on delete set null,
  created_at          timestamptz not null default now(),

  constraint fk_aplicaciones_animal foreign key (animal_id, finca_id)
    references animales(id, finca_id) on update cascade on delete cascade,
  constraint uq_aplicacion_paso unique (protocolo_id, dia_numero)
);

create index if not exists idx_protocolo_aplicaciones_animal    on protocolo_aplicaciones(animal_id);
create index if not exists idx_protocolo_aplicaciones_protocolo on protocolo_aplicaciones(protocolo_id);
create index if not exists idx_protocolo_aplicaciones_fecha     on protocolo_aplicaciones(fecha);


-- ============================================================================
-- 5) Secado — SIN tabla nueva
-- ----------------------------------------------------------------------------
-- eventos_reproductivos.tipo ya acepta 'secado' y animales.estado_reproductivo
-- ya acepta 'seca' desde schema.sql. El secado son dos hechos y se guardan
-- separados a propósito:
--   · reproductivo → eventos_reproductivos(tipo='secado', fecha_probable_parto)
--   · sanitario    → eventos_sanitarios(tipo='tratamiento') con el intramamario,
--                    que es donde se calcula retiro_leche_hasta. Los secantes de
--                    vaca seca tienen los retiros más largos del inventario.
-- ============================================================================
alter table eventos_reproductivos
  add column if not exists fecha_probable_parto date,
  add column if not exists evento_sanitario_id  uuid references eventos_sanitarios(id) on delete set null;


-- ============================================================================
-- 6) Control de leche manual — cabecera nueva, detalle en produccion_leche
-- ----------------------------------------------------------------------------
-- El detalle NO va en una tabla propia. produccion_leche ya tiene exactamente la
-- forma que necesita (animal_id, fecha, ordeno ∈ manana|tarde|total, litros), y
-- separarlo dejaría la sección de leche del dashboard vacía para siempre
-- (analytics.ts lee produccion_leche), partiría la línea de tiempo del animal en
-- dos y dejaría el control fuera de vw_respaldo_completo.
--
-- ⚠️ EL TOTAL NO SE GUARDA. AM → ordeno='manana', PM → ordeno='tarde', y el
--    total se deriva sumando. analytics.ts suma litros de TODAS las filas sin
--    mirar `ordeno`, así que una tercera fila 'total' duplicaría la producción
--    del hato.
-- ============================================================================
create table if not exists controles_leche (
  id         uuid primary key default gen_random_uuid(),
  finca_id   uuid not null references fincas(id)
               default '00000000-0000-0000-0000-000000000001',
  fecha      date not null,
  medido_por text,
  notas      text,
  created_at timestamptz not null default now(),

  -- Un control por finca y día: el formulario es de una sola pantalla para todo
  -- el hato, así que un segundo control el mismo día es un reenvío, no un dato.
  constraint uq_control_finca_fecha unique (finca_id, fecha)
);

create index if not exists idx_controles_leche_fecha on controles_leche(fecha);

alter table produccion_leche
  add column if not exists control_id uuid references controles_leche(id) on delete cascade,
  add column if not exists fuente     text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'produccion_leche'::regclass
       and conname  = 'ck_leche_fuente'
  ) then
    -- 'control'  → pesaje de leche periódico (esta sección)
    -- 'hardware' → ESP32 + HX711, endpoint todavía no construido
    -- 'manual'   → captura suelta; es el default por ser el caso conservador
    alter table produccion_leche add constraint ck_leche_fuente
      check (fuente in ('manual','control','hardware'));
  end if;
end $$;

create index if not exists idx_produccion_leche_control on produccion_leche(control_id);

-- Una sola medición por vaca / día / ordeño. produccion_leche está vacía hoy
-- (no tiene escritor), así que este índice no puede fallar por datos previos;
-- si alguna vez se carga histórico, verificar duplicados antes de re-aplicar.
create unique index if not exists uq_leche_animal_fecha_ordeno
  on produccion_leche(animal_id, fecha, ordeno);


-- ============================================================================
-- 7) finca_id, índice por tenant y RLS en las tablas nuevas
-- ----------------------------------------------------------------------------
-- Mismo patrón fail-closed de 02_multitenant.sql: dormante bajo service_role,
-- y cualquier otra conexión sin `app.finca_id` configurado ve cero filas.
-- ============================================================================
do $$
declare
  t text;
  nuevas constant text[] := array[
    'chequeos_reproductivos', 'protocolos_sincronizacion',
    'protocolo_aplicaciones', 'controles_leche'
  ];
begin
  foreach t in array nuevas loop
    execute format('create index if not exists idx_%s_finca on %I(finca_id)', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant_isolation on %I', t);
    execute format($p$
      create policy tenant_isolation on %I
        using      (finca_id = current_setting('app.finca_id', true)::uuid)
        with check (finca_id = current_setting('app.finca_id', true)::uuid)
    $p$, t);
  end loop;
end $$;


-- ============================================================================
-- 8) vw_genealogia — animal + padres + abuelos ya resueltos
-- ----------------------------------------------------------------------------
-- Regla de resolución: primero el vínculo dentro del hato, y solo si no existe,
-- el texto manual de la sección 1. Las columnas `*_en_sistema` le dicen a la
-- ficha si puede enlazar a otra ficha o si solo tiene un nombre suelto.
--
-- Se resuelve aquí y no con embeds anidados de PostgREST porque el fake de
-- tests solo simula un nivel de embed; una vista se prueba sin tocarlo.
-- ============================================================================
create or replace view vw_genealogia
with (security_invoker = true) as
select
  a.id                                              as animal_id,
  a.finca_id,
  a.arete,
  a.nombre,
  a.registro_oficial,

  -- Padres
  p.id                                              as padre_id,
  coalesce(p.arete, a.padre_externo)                as padre,
  (p.id is not null)                                as padre_en_sistema,
  m.id                                              as madre_id,
  coalesce(m.arete, a.madre_externa)                as madre,
  (m.id is not null)                                as madre_en_sistema,

  -- Abuelos paternos: padre del padre / madre del padre
  pp.id                                             as abuelo_paterno_id,
  coalesce(pp.arete, a.abuelo_paterno)              as abuelo_paterno,
  (pp.id is not null)                               as abuelo_paterno_en_sistema,
  pm.id                                             as abuela_paterna_id,
  coalesce(pm.arete, a.abuela_paterna)              as abuela_paterna,
  (pm.id is not null)                               as abuela_paterna_en_sistema,

  -- Abuelos maternos: padre de la madre / madre de la madre
  mp.id                                             as abuelo_materno_id,
  coalesce(mp.arete, a.abuelo_materno)              as abuelo_materno,
  (mp.id is not null)                               as abuelo_materno_en_sistema,
  mm.id                                             as abuela_materna_id,
  coalesce(mm.arete, a.abuela_materna)              as abuela_materna,
  (mm.id is not null)                               as abuela_materna_en_sistema
from animales a
left join animales p  on p.id  = a.padre_id
left join animales m  on m.id  = a.madre_id
left join animales pp on pp.id = p.padre_id
left join animales pm on pm.id = p.madre_id
left join animales mp on mp.id = m.padre_id
left join animales mm on mm.id = m.madre_id;


-- ============================================================================
-- 9) vw_historial_animal — línea de tiempo unificada (hoja de vida)
-- ----------------------------------------------------------------------------
-- ⚠️ `finca_id` y `ref_id` van AL FINAL de la lista de columnas a propósito:
--    CREATE OR REPLACE VIEW solo permite AGREGAR columnas al final, nunca
--    renombrar ni reordenar las existentes. Ponerlas primero obligaría a un
--    DROP VIEW y rompería la idempotencia.
--
-- `security_invoker = true` corrige un agujero de Fase 1: por defecto una vista
-- corre con los permisos de su dueño (postgres), así que evade el RLS de quien
-- consulta. Hoy es inocuo —la app entra con service_role— pero en cuanto el
-- dashboard deje de usar service_role, esta vista mostraría el historial de
-- todas las fincas.
--
-- Solo hacen falta dos ramas nuevas: el secado viaja en eventos_reproductivos y
-- el control de leche en produccion_leche, que ya estaban.
-- ============================================================================
create or replace view vw_historial_animal
with (security_invoker = true) as
  select animal_id, fecha, 'reproductivo'::text as categoria,
         tipo as evento,
         coalesce(notas, detalle::text) as descripcion,
         created_at, finca_id, id as ref_id
    from eventos_reproductivos
  union all
  select animal_id, fecha, 'produccion_leche',
         'ordeno_' || ordeno,
         litros::text || ' L',
         created_at, finca_id, id
    from produccion_leche
  union all
  select animal_id, fecha, 'sanitario',
         tipo,
         concat_ws(' ', producto, dosis, notas),
         created_at, finca_id, id
    from eventos_sanitarios
  union all
  select animal_id, fecha, 'pesaje',
         coalesce(tipo,'control'),
         peso_kg::text || ' kg',
         created_at, finca_id, id
    from pesajes
  union all
  select animal_id, fecha, 'movimiento',
         tipo,
         concat_ws(' ', contraparte, valor::text),
         created_at, finca_id, id
    from movimientos
  union all
  -- concat_ws ignora los NULL; el nullif descarta la etiqueta suelta cuando el
  -- ovario quedó sin registrar.
  select animal_id, fecha, 'chequeo_repro',
         estado_codigo,
         concat_ws(' · ',
           nullif(concat_ws(' ', 'OD:', ovario_der_estruct, ovario_der_mm::text), 'OD:'),
           nullif(concat_ws(' ', 'OI:', ovario_izq_estruct, ovario_izq_mm::text), 'OI:'),
           veterinario,
           observaciones),
         created_at, finca_id, id
    from chequeos_reproductivos
  union all
  select animal_id, fecha, 'protocolo',
         'dia_' || dia_numero::text,
         concat_ws(' ', producto, dosis, aplicado_por),
         created_at, finca_id, id
    from protocolo_aplicaciones;


-- ============================================================================
-- 10) vw_respaldo_completo — incluir las tablas nuevas
-- ----------------------------------------------------------------------------
-- Sin esto el respaldo omite en silencio chequeos, protocolos y controles de
-- leche, y el aviso de "saca un respaldo antes de borrar" de
-- db/maintenance/reset_datos.sql deja de ser cierto.
-- Columnas (data, n_animales) sin cambios → CREATE OR REPLACE es válido.
-- ============================================================================
create or replace view vw_respaldo_completo
with (security_invoker = true) as
select jsonb_build_object(
  'animales',                 (select coalesce(jsonb_agg(t), '[]'::jsonb) from animales t),
  'eventos_reproductivos',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from eventos_reproductivos t),
  'produccion_leche',         (select coalesce(jsonb_agg(t), '[]'::jsonb) from produccion_leche t),
  'eventos_sanitarios',       (select coalesce(jsonb_agg(t), '[]'::jsonb) from eventos_sanitarios t),
  'pesajes',                  (select coalesce(jsonb_agg(t), '[]'::jsonb) from pesajes t),
  'movimientos',              (select coalesce(jsonb_agg(t), '[]'::jsonb) from movimientos t),
  'chequeos_reproductivos',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from chequeos_reproductivos t),
  'protocolos_sincronizacion',(select coalesce(jsonb_agg(t), '[]'::jsonb) from protocolos_sincronizacion t),
  'protocolo_aplicaciones',   (select coalesce(jsonb_agg(t), '[]'::jsonb) from protocolo_aplicaciones t),
  'controles_leche',          (select coalesce(jsonb_agg(t), '[]'::jsonb) from controles_leche t)
) as data,
(select count(*) from animales) as n_animales;


-- ============================================================================
-- 11) Catálogo: productos de secado (intramamarios)
-- ----------------------------------------------------------------------------
-- Van en cat_medicamentos, no en un catálogo aparte: es de ahí de donde
-- domain/sanidad.ts saca retiro_horas_default para calcular retiro_leche_hasta.
-- Las horas son órdenes de magnitud típicas de secantes de larga acción —
-- AJUSTAR contra la etiqueta real del producto que use la finca antes de confiar
-- en ellas para despachar leche.
-- ============================================================================
insert into cat_medicamentos (nombre, retiro_horas_default, orden) values
  ('Secante intramamario (larga accion)', 1440, 20),   -- ~60 días
  ('Cefalonio (secado)',                  1440, 21),
  ('Cloxacilina benzatinica (secado)',    1440, 22)
on conflict (nombre) do nothing;

-- Productos de sincronización, por el mismo motivo: si el vet aplica una
-- prostaglandina y el producto no está en el catálogo, el retiro sale NULL.
insert into cat_medicamentos (nombre, retiro_horas_default, orden) values
  ('Prostaglandina (PGF2a)', 0,  30),
  ('GnRH',                   0,  31),
  ('Benzoato de estradiol',  72, 32),
  ('Progesterona (CIDR/DIB)', 0, 33)
on conflict (nombre) do nothing;


-- ============================================================================
-- Diferido a propósito (NO está en este archivo):
--   * animales.arete es UNIQUE global, no por finca. Es un bloqueante de Fase 1
--     (dos fincas no pueden tener el arete '045'), pero cambiarlo toca el índice
--     y todas las búsquedas por arete. Tarea aparte.
--   * Migrar las 7 tablas de datos anteriores a FK compuesta (finca_id, animal_id)
--     como las nuevas de este archivo.
--   * produccion_leche todavía no distingue el ordeño de la tarde para el cálculo
--     de litros/día en analytics.ts: con controles cada 2-3 semanas, "total 30
--     días" pasa a significar "suma de los días de control". Ajustar la etiqueta
--     del dashboard en el Bloque B.
-- ============================================================================
