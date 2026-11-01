-- =====================================================================
--  Zadania własne: zakres dat (od–do) + zadania stałe (powtarzalne)
-- =====================================================================

alter table public.tasks add column if not exists starts_at timestamptz;          -- "od"
alter table public.tasks add column if not exists repeat    text;                 -- null | daily | weekdays | weekly

-- Odhaczanie zadania stałego osobno dla każdego dnia
create table if not exists public.task_completions (
  task_id uuid not null references public.tasks(id) on delete cascade,
  day     date not null,
  user_id uuid references public.family_members(user_id) on delete set null,
  done_at timestamptz not null default now(),
  primary key (task_id, day)
);
create index if not exists task_completions_day_idx on public.task_completions (day);

alter table public.task_completions enable row level security;
drop policy if exists task_completions_family_all on public.task_completions;
create policy task_completions_family_all on public.task_completions
  for all using (public.is_family_member()) with check (public.is_family_member());

do $$ begin
  begin alter publication supabase_realtime add table public.task_completions; exception when duplicate_object then null; end;
end $$;

select 'ok' as status;
