-- ============================================================================
-- Finca Bot - State machine + catalogs (run in the SAME Supabase project)
-- Reuses existing tables: animales, eventos_sanitarios, eventos_reproductivos,
-- pesajes, movimientos. Adds the pieces the interactive bot needs.
-- ============================================================================

-- ---------- WhatsApp users (only registered numbers can use the bot) --------
create table if not exists whatsapp_users (
  telefono   text primary key,                 -- wa_id (e.g. 573112226150)
  nombre     text not null,
  rol        text not null default 'vaquero'
               check (rol in ('dueno','admin','veterinario','vaquero')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Conversational state machine ------------------------------------
create table if not exists whatsapp_sessions (
  telefono     text primary key,
  current_flow text,                            -- e.g. 'salud.vacunacion'
  current_step integer not null default 0,
  temp_data    jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- ---------- Editable catalogs (admin maintains them from the dashboard) -----
create table if not exists cat_vacunas (
  id serial primary key, nombre text not null unique,
  retiro_default_dias integer, activo boolean not null default true, orden integer default 100
);
create table if not exists cat_medicamentos (
  id serial primary key, nombre text not null unique,
  retiro_horas_default integer, activo boolean not null default true, orden integer default 100
);
create table if not exists cat_diagnosticos (
  id serial primary key, nombre text not null unique,
  grupo text, activo boolean not null default true, orden integer default 100
);
create table if not exists cat_razas (
  id serial primary key, nombre text not null unique, activo boolean not null default true, orden integer default 100
);
create table if not exists cat_tecnicos (
  id serial primary key, nombre text not null unique, activo boolean not null default true, orden integer default 100
);
create table if not exists cat_causas_mortalidad (
  id serial primary key, nombre text not null unique, activo boolean not null default true, orden integer default 100
);

-- ---------- Columns the brief flows need on existing tables -----------------
alter table eventos_sanitarios add column if not exists retiro_leche_hasta date;
alter table pesajes            add column if not exists condicion_corporal integer
                                 check (condicion_corporal between 1 and 5);

-- ============================================================================
-- Seed: catalogs (frequent options from the brief)
-- ============================================================================
insert into cat_vacunas (nombre, retiro_default_dias, orden) values
  ('Aftosa', 180, 1), ('Brucelosis', 180, 2), ('Carbon sintomatico', 180, 3),
  ('Clostridiosis', 180, 4), ('Rabia', 365, 5)
on conflict (nombre) do nothing;

insert into cat_medicamentos (nombre, retiro_horas_default, orden) values
  ('Bloat-Away', 0, 1), ('Oxitetraciclina', 168, 2), ('Penicilina', 96, 3),
  ('Flunixin', 72, 4), ('Dexametasona', 72, 5), ('Suero oral', 0, 6),
  ('Doramec', 0, 7), ('Ivermectina', 0, 8)
on conflict (nombre) do nothing;

insert into cat_diagnosticos (nombre, grupo, orden) values
  ('Timpanismo', 'Digestivo', 1), ('Diarrea', 'Digestivo', 2), ('Indigestion', 'Digestivo', 3),
  ('Neumonia', 'Respiratorio', 4), ('Tos / Bronquitis', 'Respiratorio', 5),
  ('Metritis', 'Reproductivo', 6), ('Retencion placenta', 'Reproductivo', 7),
  ('Mastitis', 'Otros', 8), ('Cojera', 'Otros', 9), ('Herida / Trauma', 'Otros', 10)
on conflict (nombre) do nothing;

insert into cat_razas (nombre, orden) values
  ('Gyr', 1), ('Holstein', 2), ('Pardo Suizo', 3), ('Brahman', 4),
  ('Simmental', 5), ('Jersey', 6), ('Normando', 7), ('F1', 8)
on conflict (nombre) do nothing;

insert into cat_tecnicos (nombre, orden) values
  ('Veterinario externo', 1), ('Yo mismo', 2)
on conflict (nombre) do nothing;

insert into cat_causas_mortalidad (nombre, orden) values
  ('Timpanismo', 1), ('Mastitis severa', 2), ('Neumonia', 3),
  ('Parto complicado', 4), ('Serpiente / Accidente', 5), ('Causa desconocida', 6)
on conflict (nombre) do nothing;

-- ============================================================================
-- Seed: register the owner so the bot accepts messages from this number
-- ============================================================================
insert into whatsapp_users (telefono, nombre, rol) values
  ('573112226150', 'Johan', 'dueno')
on conflict (telefono) do nothing;
