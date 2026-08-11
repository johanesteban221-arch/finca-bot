-- ============================================================================
-- Gestion Ganadera Doble Proposito - Database schema (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
-- Run this in the SQL Editor of a NEW Supabase project.
-- Domain identifiers are in Spanish (business language); structural
-- comments are in English per project convention.
-- ============================================================================

create extension if not exists pgcrypto;  -- provides gen_random_uuid()

-- ----------------------------------------------------------------------------
-- updated_at helper trigger
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- 1) animales  -  core registry + genealogy (traceability root)
-- ============================================================================
create table if not exists animales (
  id                  uuid primary key default gen_random_uuid(),
  arete               text not null unique,                 -- ear tag / official visible ID used in the field
  nombre              text,
  sexo                text not null check (sexo in ('M','H')),
  raza                text,                                 -- breed: Gyr, Holstein, Pardo Suizo, F1, Brahman, ...
  fecha_nacimiento    date,
  peso_nacimiento     numeric(6,2),                         -- kg
  madre_id            uuid references animales(id) on delete set null,  -- genealogy: dam (in herd)
  padre_id            uuid references animales(id) on delete set null,  -- genealogy: sire (in herd)
  padre_externo       text,                                 -- sire id when not in herd (semen / pajilla code)
  origen              text not null default 'nacido_en_finca'
                        check (origen in ('nacido_en_finca','comprado')),
  categoria           text,                                 -- ternero, novilla, vaca, toro, vaca_seca, ...
  estado              text not null default 'activo'
                        check (estado in ('activo','vendido','muerto','descartado')),
  estado_reproductivo text default 'vacia'
                        check (estado_reproductivo in ('vacia','servida','prenada','parida','seca')),
  foto_url            text,
  notas               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_animales_arete  on animales(arete);
create index if not exists idx_animales_madre  on animales(madre_id);
create index if not exists idx_animales_padre  on animales(padre_id);
create index if not exists idx_animales_estado on animales(estado);

drop trigger if exists trg_animales_updated_at on animales;
create trigger trg_animales_updated_at
  before update on animales
  for each row execute function set_updated_at();

-- ============================================================================
-- 2) eventos_reproductivos
--    celo | servicio | diagnostico_prenez | parto | aborto | secado
-- ============================================================================
create table if not exists eventos_reproductivos (
  id           uuid primary key default gen_random_uuid(),
  animal_id    uuid not null references animales(id) on delete cascade,
  tipo         text not null
                 check (tipo in ('celo','servicio','diagnostico_prenez','parto','aborto','secado')),
  fecha        date not null,
  -- servicio:
  metodo       text check (metodo in ('IA','monta')),       -- artificial insemination or natural mating
  toro_id      uuid references animales(id) on delete set null,  -- herd bull used
  pajilla      text,                                         -- straw / semen code
  inseminador  text,
  -- diagnostico_prenez:
  resultado    text check (resultado in ('prenada','vacia')),
  -- parto:
  cria_id      uuid references animales(id) on delete set null,  -- link to the calf created
  detalle      jsonb,                                        -- any extra structured data per event type
  notas        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_repro_animal on eventos_reproductivos(animal_id);
create index if not exists idx_repro_tipo   on eventos_reproductivos(tipo);
create index if not exists idx_repro_fecha  on eventos_reproductivos(fecha);

-- ============================================================================
-- 3) produccion_leche  -  milk production per cow (dual-purpose key metric)
-- ============================================================================
create table if not exists produccion_leche (
  id          uuid primary key default gen_random_uuid(),
  animal_id   uuid not null references animales(id) on delete cascade,
  fecha       date not null,
  ordeno      text not null default 'total' check (ordeno in ('manana','tarde','total')),
  litros      numeric(6,2) not null check (litros >= 0),
  notas       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_leche_animal on produccion_leche(animal_id);
create index if not exists idx_leche_fecha  on produccion_leche(fecha);

-- ============================================================================
-- 4) eventos_sanitarios  -  vaccines, deworming, treatments, check-ups
-- ============================================================================
create table if not exists eventos_sanitarios (
  id            uuid primary key default gen_random_uuid(),
  animal_id     uuid not null references animales(id) on delete cascade,
  tipo          text not null
                  check (tipo in ('vacuna','desparasitacion','tratamiento','revision')),
  fecha         date not null,
  producto      text,
  dosis         text,
  via           text,                                       -- oral, IM, SC, ...
  responsable   text,
  diagnostico   text,
  proxima_fecha date,                                       -- next due date -> drives reminders
  notas         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_sani_animal  on eventos_sanitarios(animal_id);
create index if not exists idx_sani_proxima on eventos_sanitarios(proxima_fecha);

-- ============================================================================
-- 5) pesajes  -  weight history (birth, weaning, control, sale)
-- ============================================================================
create table if not exists pesajes (
  id         uuid primary key default gen_random_uuid(),
  animal_id  uuid not null references animales(id) on delete cascade,
  fecha      date not null,
  peso_kg    numeric(6,2) not null check (peso_kg > 0),
  tipo       text check (tipo in ('nacimiento','destete','control','venta')),
  notas      text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pesajes_animal on pesajes(animal_id);

-- ============================================================================
-- 6) movimientos  -  buy / sell / transfer / death / cull
-- ============================================================================
create table if not exists movimientos (
  id          uuid primary key default gen_random_uuid(),
  animal_id   uuid not null references animales(id) on delete cascade,
  tipo        text not null check (tipo in ('compra','venta','traslado','muerte','descarte')),
  fecha       date not null,
  valor       numeric(12,2),
  contraparte text,                                          -- buyer / seller / destination
  notas       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_mov_animal on movimientos(animal_id);

-- ============================================================================
-- 7) confirmaciones_pendientes  -  conversational state for confirm-before-write
--    The WhatsApp bot stores the parsed action here and waits for the user's
--    "si" before committing it to the real tables.
-- ============================================================================
create table if not exists confirmaciones_pendientes (
  id            uuid primary key default gen_random_uuid(),
  telefono      text not null,                              -- WhatsApp sender (wa_id)
  accion        jsonb not null,                             -- parsed action awaiting confirmation
  resumen       text,                                       -- human-readable summary echoed to the user
  fuente        text check (fuente in ('texto','voz')),
  transcripcion text,                                       -- raw transcription when fuente = 'voz'
  estado        text not null default 'pendiente'
                  check (estado in ('pendiente','confirmado','cancelado','expirado')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz                                  -- e.g. now() + interval '15 minutes'
);
-- At most one active pending confirmation per phone number:
create unique index if not exists uq_pend_telefono_activa
  on confirmaciones_pendientes(telefono)
  where estado = 'pendiente';

-- ============================================================================
-- 8) vw_historial_animal  -  unified timeline of everything an animal has done
--    Powers the "muestrame todo de la vaca <arete>" query.
--
--    ⚠️ THIS IS THE BASE DEFINITION, NOT THE FINAL ONE. db/03_hoja_de_vida.sql
--       replaces it at the end of the apply chain with the version that also
--       covers chequeos_reproductivos and protocolo_aplicaciones and exposes
--       finca_id / ref_id. It cannot live here: those tables do not exist yet at
--       this point in the chain. If you re-run this file on its own, re-run 03
--       afterwards or the animal's history loses its newest event types.
-- ============================================================================
create or replace view vw_historial_animal as
  select animal_id, fecha, 'reproductivo'::text as categoria,
         tipo as evento,
         coalesce(notas, detalle::text) as descripcion,
         created_at
    from eventos_reproductivos
  union all
  select animal_id, fecha, 'produccion_leche',
         'ordeno_' || ordeno,
         litros::text || ' L',
         created_at
    from produccion_leche
  union all
  select animal_id, fecha, 'sanitario',
         tipo,
         concat_ws(' ', producto, dosis, notas),
         created_at
    from eventos_sanitarios
  union all
  select animal_id, fecha, 'pesaje',
         coalesce(tipo,'control'),
         peso_kg::text || ' kg',
         created_at
    from pesajes
  union all
  select animal_id, fecha, 'movimiento',
         tipo,
         concat_ws(' ', contraparte, valor::text),
         created_at
    from movimientos;

-- ============================================================================
-- Notes
-- - n8n connects with the service_role key, which bypasses Row Level Security.
--   If you later expose this DB to a frontend, enable RLS and add policies.
-- - All event tables cascade-delete with the animal; movimientos keeps history.
-- ============================================================================
