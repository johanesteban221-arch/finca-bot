-- ============================================================================
-- 04 - Autenticación por usuario y roles del tablero (Fase 2)
-- ----------------------------------------------------------------------------
-- Aplicar DESPUÉS de:
--   schema.sql → alerts_views.sql → backup.sql → 01_bot_schema.sql
--   → 02_multitenant.sql → 03_hoja_de_vida.sql
--
-- Idempotente: se puede volver a correr. Solo agrega — no borra ni reescribe datos.
--
-- ⚠️ NO aplicar en el proyecto Supabase real sin aprobación explícita.
--
-- Qué NO hace este archivo:
--   · No toca whatsapp_users. El bot sigue autenticando por teléfono igual que
--     hoy; el rework N:M (whatsapp_user_fincas) es un paso aparte, decidido así
--     para no mover la autenticación del bot y la del tablero en la misma tanda.
--   · No guarda contraseñas. Viven en auth.users, gestionadas por Supabase Auth.
--     Si alguna vez aparece una columna de contraseña aquí, algo se hizo mal.
-- ============================================================================


-- ============================================================================
-- 1) usuarios — el perfil de la persona, colgado de Supabase Auth
-- ----------------------------------------------------------------------------
-- `id` NO es un uuid nuevo: es exactamente el de auth.users. Esa igualdad es la
-- que permite pasar del JWT al perfil sin una tabla de mapeo, y el ON DELETE
-- CASCADE evita perfiles huérfanos cuando se borra la cuenta desde Supabase.
--
-- `email` se duplica aquí (ya está en auth.users) a propósito: el listado de
-- usuarios del tablero es una consulta a esta tabla, y sin la copia habría que
-- llamar a la API de administración de Auth para pintar una tabla.
-- ============================================================================
create table if not exists usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null unique,
  nombre        text not null,
  telefono      text,                       -- para cruzarlo con whatsapp_users más adelante
  activo        boolean not null default true,
  ultimo_acceso timestamptz,                -- lo escribe el login; instante UTC, no fecha de finca
  created_at    timestamptz not null default now()
);

create index if not exists idx_usuarios_email on usuarios(email);


-- ============================================================================
-- 2) usuario_fincas — N:M con el rol POR FINCA
-- ----------------------------------------------------------------------------
-- El rol no vive en `usuarios` sino aquí: la misma persona puede ser dueño de su
-- finca y veterinario externo en otra. Ponerlo en el perfil obligaría a
-- rehacer el modelo en Fase 1, que es justo lo que estas decisiones evitan.
--
-- Valores SIN tilde, iguales al CHECK de whatsapp_users.rol en 01_bot_schema.sql.
-- Un 'dueño' con tilde aquí no coincidiría con ningún filtro del cron.
-- ============================================================================
create table if not exists usuario_fincas (
  usuario_id uuid not null references usuarios(id) on delete cascade,
  finca_id   uuid not null references fincas(id)   on delete cascade,
  rol        text not null
               check (rol in ('dueno','admin','veterinario','vaquero')),
  created_at timestamptz not null default now(),
  primary key (usuario_id, finca_id)
);

create index if not exists idx_usuario_fincas_finca on usuario_fincas(finca_id);

-- Una finca sin dueño es una finca que nadie puede administrar. No se fuerza con
-- un CHECK (no se puede, es una condición entre filas): lo sostiene la app, que
-- se niega a quitarle el rol al último dueño. La consulta de verificación está
-- al final de este archivo.


-- ============================================================================
-- 3) RLS — habilitada y, como el resto del sistema, DORMIDA en Fase 0
-- ----------------------------------------------------------------------------
-- La app entra con service_role, que se salta RLS por completo. En Fase 2 el
-- aislamiento real lo hace la capa de autorización del servidor
-- (src/lib/auth/roles.ts) más el filtro explícito por finca_id de las consultas.
-- Estas políticas quedan listas para el día que la conexión deje de ser
-- service_role — no antes.
--
-- `usuarios` se filtra por el propio id (cada quien se ve a sí mismo) y
-- `usuario_fincas` por la finca activa, igual que las tablas de datos.
-- ============================================================================
alter table usuarios       enable row level security;
alter table usuario_fincas enable row level security;

drop policy if exists self_access on usuarios;
create policy self_access on usuarios
  using      (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists tenant_isolation on usuario_fincas;
create policy tenant_isolation on usuario_fincas
  using      (finca_id = current_setting('app.finca_id', true)::uuid)
  with check (finca_id = current_setting('app.finca_id', true)::uuid);


-- ============================================================================
-- 4) Arranque en frío — cómo entra el primer dueño
-- ----------------------------------------------------------------------------
-- Hay un huevo-y-gallina: crear usuarios exige estar autenticado como dueño, y
-- todavía no existe ningún dueño. Se resuelve SIN un script que inserte a mano
-- un uuid inventado (que no existiría en auth.users y rompería la FK):
--
--   1. El tablero conserva el Basic Auth actual mientras `AUTH_LEGACY_BASIC=1`
--      esté en las variables de entorno. Esa sesión actúa como 'dueno'.
--   2. Con ella se entra a /dashboard/usuarios y se crea el primer usuario real.
--      La app llama a la API de administración de Auth (service_role), crea la
--      cuenta y escribe estas dos tablas en el mismo paso.
--   3. Se verifica que el login nuevo funciona y recién ahí se quita
--      AUTH_LEGACY_BASIC de Easypanel. Ese es el único momento en que el Basic
--      Auth se apaga: apagarlo antes deja al dueño afuera de su propia finca.
--
-- Verificación después de crear el primer usuario (debe devolver una fila):
--   select u.email, uf.rol, f.nombre
--     from usuarios u
--     join usuario_fincas uf on uf.usuario_id = u.id
--     join fincas f on f.id = uf.finca_id
--    where uf.rol = 'dueno';
-- ============================================================================
