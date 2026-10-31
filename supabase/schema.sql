-- =====================================================================
--  AGENT DUŻEJ RODZINY — schemat bazy Supabase (PostgreSQL)
--  Wklej całość w Supabase → SQL Editor → Run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Członkowie rodziny (Ty i żona). Każdy wiersz = jedno konto logowania.
-- ---------------------------------------------------------------------
create table if not exists public.family_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  color        text not null default '#64748b',
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Dzieci
-- ---------------------------------------------------------------------
create table if not exists public.children (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#3b82f6',
  institution text,                 -- np. 'szkoła', 'przedszkole'
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Wpisy — zunifikowany strumień z dzienników (Librus, 4Parents) + ręczne
-- ---------------------------------------------------------------------
create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  child_id     uuid references public.children(id) on delete set null,
  source       text not null,       -- 'librus' | '4parents' | 'manual'
  kind         text not null,       -- 'message' | 'announcement' | 'homework' | 'event' | 'grade' | 'attendance' | 'other'
  external_id  text,                -- id w systemie źródłowym (do deduplikacji)
  title        text not null,
  body         text,
  sender       text,
  occurred_at  timestamptz,         -- termin/data, której dotyczy wpis (jeśli jest)
  published_at timestamptz not null default now(),
  url          text,
  raw          jsonb,
  created_at   timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists items_published_idx on public.items (published_at desc);
create index if not exists items_child_idx     on public.items (child_id);

-- Kto przeczytał który wpis
create table if not exists public.item_reads (
  item_id uuid references public.items(id) on delete cascade,
  user_id uuid references public.family_members(user_id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

-- ---------------------------------------------------------------------
-- Zadania (wspólna tablica)
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  notes      text,
  child_id   uuid references public.children(id) on delete set null,
  assignee   uuid references public.family_members(user_id) on delete set null,
  due_at     timestamptz,
  status     text not null default 'todo' check (status in ('todo','done')),
  item_id    uuid references public.items(id) on delete set null,
  created_by uuid references public.family_members(user_id) on delete set null,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index if not exists tasks_status_due_idx on public.tasks (status, due_at);

-- ---------------------------------------------------------------------
-- Wydarzenia (kalendarz)
-- ---------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  child_id    uuid references public.children(id) on delete set null,
  title       text not null,
  notes       text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default true,
  source      text not null default 'manual',
  external_id text,
  item_id     uuid references public.items(id) on delete set null,
  created_by  uuid references public.family_members(user_id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists events_starts_idx on public.events (starts_at);

-- ---------------------------------------------------------------------
-- Czat
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid references public.family_members(user_id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages (created_at);

-- =====================================================================
--  BEZPIECZEŃSTWO (RLS): dostęp mają wyłącznie członkowie rodziny.
-- =====================================================================
create or replace function public.is_family_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.family_members where user_id = auth.uid());
$$;

alter table public.family_members enable row level security;
alter table public.children       enable row level security;
alter table public.items          enable row level security;
alter table public.item_reads     enable row level security;
alter table public.tasks          enable row level security;
alter table public.events         enable row level security;
alter table public.messages       enable row level security;

-- family_members: członkowie widzą się nawzajem; nowe wiersze dodajesz w SQL (patrz README)
drop policy if exists fm_select on public.family_members;
create policy fm_select on public.family_members for select using (public.is_family_member());
drop policy if exists fm_update_self on public.family_members;
create policy fm_update_self on public.family_members for update using (user_id = auth.uid());

-- pozostałe tabele: pełny dostęp dla członków rodziny
do $$
declare t text;
begin
  foreach t in array array['children','items','item_reads','tasks','events','messages'] loop
    execute format('drop policy if exists %I_family_all on public.%I', t, t);
    execute format(
      'create policy %I_family_all on public.%I for all using (public.is_family_member()) with check (public.is_family_member())',
      t, t);
  end loop;
end $$;

-- =====================================================================
--  REALTIME (czat, zadania, wydarzenia, wpisy odświeżają się na żywo)
-- =====================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tasks;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.events;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.items;    exception when duplicate_object then null; end;
end $$;

-- =====================================================================
--  PO UTWORZENIU KONT W Authentication → Users wklej (podmień e-maile):
-- =====================================================================
-- insert into public.family_members (user_id, display_name, color)
-- select id, 'Dawid', '#0ea5e9' from auth.users where email = 'dawid@example.com';
-- insert into public.family_members (user_id, display_name, color)
-- select id, 'Żona', '#ec4899' from auth.users where email = 'zona@example.com';
