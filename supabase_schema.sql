-- ══════════════════════════════════════════════════════════════════════
--  AXONTECH · Schema para Supabase (migración desde Firestore)
-- ══════════════════════════════════════════════════════════════════════
--
-- CÓMO USAR ESTE ARCHIVO:
-- 1. Entra a tu proyecto Supabase: https://supabase.com/dashboard
--    Proyecto: gdzsqwyedzrfituewdtt
-- 2. En el menú izquierdo, busca "SQL Editor" (ícono de terminal `</>`)
-- 3. Crea un "New query", pega TODO este archivo y pulsa "Run" (Ctrl+Enter)
-- 4. Debe decir "Success. No rows returned" al terminar.
-- 5. Eso es todo. La estructura de tablas queda creada y lista para usar
--    por la app v31.
--
-- Notas:
--  - Es SEGURO re-ejecutar este script: usa IF NOT EXISTS / OR REPLACE.
--  - No borra datos existentes si los hay.
--  - Las políticas RLS permiten read/write público con la anon key
--    (igual que las reglas de Firestore originales).
--
-- ⚠️  SEGURIDAD (v42):
--  - La app es 100% estática (GitHub Pages) y NO usa Supabase Auth, por lo
--    que RLS no puede distinguir al admin de un atacante: cualquier persona
--    con la publishable key (visible en app.js/catalogo.html) puede leer,
--    escribir y borrar TODAS las tablas.
--  - MITIGACIÓN APLICADA: las contraseñas de gestores ya NO viajan en texto
--    plano (v42: hasheadas con PBKDF2-SHA256, 100k iteraciones). La key de
--    Supabase NO es un secreto: se considera pública por diseño.
--  - Para endurecimiento real (recomendado a futuro): mover la lógica de
--    escritura a Supabase Edge Functions autenticadas con JWT del admin, y
--    restringir RLS a funciones SECURITY DEFINER con la service_role.

-- ─── PostgreSQL extensions ─────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ══════════════════════════════════════════════════════════════════════
--  TABLAS
-- ══════════════════════════════════════════════════════════════════════

-- Cada fila tiene `data` JSONB con TODO el objeto (igual que un doc de
-- Firestore). El `id` es numérico (Date.now() en la app) y primary key.
-- Esto permite updates/upserts atómicos por id sin tocar campos
-- individuales — mismo modelo mental que Firestore pero sobre Postgres.

-- Gestores (vendedores)
create table if not exists gestores (
  id      bigint primary key,
  data    jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Mensajeros
create table if not exists mensajeros (
  id      bigint primary key,
  data    jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Productos (catálogo)
create table if not exists productos (
  id      bigint primary key,
  data    jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Categorías
create table if not exists categorias (
  id      bigint primary key,
  data    jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Vales (lo crítico — lo que no llegaba al admin)
create table if not exists vales (
  id        bigint primary key,
  data      jsonb not null default '{}'::jsonb,
  gestor_id bigint generated always as ((data->>'gestorId')::bigint) stored,
  status    text   generated always as (data->>'status') stored,
  ts        text   generated always as (data->>'ts') stored,
  updated_at timestamptz default now()
);
create index if not exists vales_gestor_id_idx on vales(gestor_id);
create index if not exists vales_status_idx   on vales(status);
create index if not exists vales_ts_desc_idx  on vales(ts desc);

-- Tabla "meta": documentos únicos (config, notifs, estafa, ranking_summary).
-- Mismo patrón que Firestore: una fila por nombre, con data JSONB.
create table if not exists meta (
  name      text primary key,
  data      jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- Backups (snapshots pre-nuke, etc.)
create table if not exists backups (
  name      text primary key,
  data      jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ══════════════════════════════════════════════════════════════════════
--  FUNCIONES HELPER (para upsert desde REST con la anon key)
-- ══════════════════════════════════════════════════════════════════════
-- PostgREST (la API REST de Supabase) puede hacer UPSERT con
-- POST /rest/v1/{tabla}?on_conflict=id — pero necesita una constraint
-- unique en la columna usada para conflict resolution. El primary key
-- ya cumple, así que no hace falta crear constraint extra.

-- ══════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════════
-- IMPORTANTE: la app NO usa Firebase/Supabase Auth (contraseñas propias
-- comparadas en el navegador). Todos los writes van con la anon key
-- pública. Las RLS políticas por lo tanto solo validan la FORMA de los
-- datos — no pueden distinguir "dispositivo de gestor" vs "dispositivo
-- de admin". Esto es el mismo modelo de seguridad que tenía Firestore
-- (reglas en firestore.rules) — no es un paso atrás.

-- Habilitar RLS en todas las tablas
alter table gestores    enable row level security;
alter table mensajeros  enable row level security;
alter table productos   enable row level security;
alter table categorias enable row level security;
alter table vales       enable row level security;
alter table meta        enable row level security;
alter table backups     enable row level security;

-- Políticas: permitir TODO (read, insert, update, delete) con la anon key.
-- Equivalente 1:1 a las reglas `allow read, write: if true` de Firestore.

-- Gestores
drop policy if exists "gestores_read"   on gestores;
drop policy if exists "gestores_insert" on gestores;
drop policy if exists "gestores_update" on gestores;
drop policy if exists "gestores_delete" on gestores;
create policy "gestores_read"   on gestores for select using (true);
create policy "gestores_insert" on gestores for insert with check (true);
create policy "gestores_update" on gestores for update using (true) with check (true);
create policy "gestores_delete" on gestores for delete using (true);

-- Mensajeros
drop policy if exists "mensajeros_read"   on mensajeros;
drop policy if exists "mensajeros_insert" on mensajeros;
drop policy if exists "mensajeros_update" on mensajeros;
drop policy if exists "mensajeros_delete" on mensajeros;
create policy "mensajeros_read"   on mensajeros for select using (true);
create policy "mensajeros_insert" on mensajeros for insert with check (true);
create policy "mensajeros_update" on mensajeros for update using (true) with check (true);
create policy "mensajeros_delete" on mensajeros for delete using (true);

-- Productos
drop policy if exists "productos_read"   on productos;
drop policy if exists "productos_insert" on productos;
drop policy if exists "productos_update" on productos;
drop policy if exists "productos_delete" on productos;
create policy "productos_read"   on productos for select using (true);
create policy "productos_insert" on productos for insert with check (true);
create policy "productos_update" on productos for update using (true) with check (true);
create policy "productos_delete" on productos for delete using (true);

-- Categorías
drop policy if exists "categorias_read"   on categorias;
drop policy if exists "categorias_insert" on categorias;
drop policy if exists "categorias_update" on categorias;
drop policy if exists "categorias_delete" on categorias;
create policy "categorias_read"   on categorias for select using (true);
create policy "categorias_insert" on categorias for insert with check (true);
create policy "categorias_update" on categorias for update using (true) with check (true);
create policy "categorias_delete" on categorias for delete using (true);

-- Vales
drop policy if exists "vales_read"   on vales;
drop policy if exists "vales_insert" on vales;
drop policy if exists "vales_update" on vales;
drop policy if exists "vales_delete" on vales;
create policy "vales_read"   on vales for select using (true);
create policy "vales_insert" on vales for insert with check (true);
create policy "vales_update" on vales for update using (true) with check (true);
create policy "vales_delete" on vales for delete using (true);

-- Meta
drop policy if exists "meta_read"   on meta;
drop policy if exists "meta_insert" on meta;
drop policy if exists "meta_update" on meta;
drop policy if exists "meta_delete" on meta;
create policy "meta_read"   on meta for select using (true);
create policy "meta_insert" on meta for insert with check (true);
create policy "meta_update" on meta for update using (true) with check (true);
create policy "meta_delete" on meta for delete using (true);

-- Backups
drop policy if exists "backups_read"   on backups;
drop policy if exists "backups_insert" on backups;
drop policy if exists "backups_update" on backups;
drop policy if exists "backups_delete" on backups;
create policy "backups_read"   on backups for select using (true);
create policy "backups_insert" on backups for insert with check (true);
create policy "backups_update" on backups for update using (true) with check (true);
create policy "backups_delete" on backups for delete using (true);

-- ══════════════════════════════════════════════════════════════════════
--  TRIGGER para mantener updated_at automáticamente
-- ══════════════════════════════════════════════════════════════════════
create or replace function _touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists gestores_touch_updated_at   on gestores;
drop trigger if exists mensajeros_touch_updated_at on mensajeros;
drop trigger if exists productos_touch_updated_at  on productos;
drop trigger if exists categorias_touch_updated_at on categorias;
drop trigger if exists vales_touch_updated_at      on vales;
drop trigger if exists meta_touch_updated_at       on meta;
drop trigger if exists backups_touch_updated_at    on backups;

create trigger gestores_touch_updated_at   before update on gestores   for each row execute function _touch_updated_at();
create trigger mensajeros_touch_updated_at before update on mensajeros for each row execute function _touch_updated_at();
create trigger productos_touch_updated_at  before update on productos  for each row execute function _touch_updated_at();
create trigger categorias_touch_updated_at before update on categorias for each row execute function _touch_updated_at();
create trigger vales_touch_updated_at      before update on vales      for each row execute function _touch_updated_at();
create trigger meta_touch_updated_at       before update on meta       for each row execute function _touch_updated_at();
create trigger backups_touch_updated_at    before update on backups    for each row execute function _touch_updated_at();

-- ══════════════════════════════════════════════════════════════════════
--  CHECK FINAL
-- ══════════════════════════════════════════════════════════════════════
-- Lista las tablas creadas para confirmar que todo está en su sitio.
select tablename as tabla from pg_tables where schemaname = 'public' order by tablename;
