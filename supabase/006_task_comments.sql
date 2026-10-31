-- Komentarze do zadań (z @wzmiankami) + kto przeczytał
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author     uuid references public.family_members(user_id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

create table if not exists public.comment_reads (
  comment_id uuid references public.task_comments(id) on delete cascade,
  user_id    uuid references public.family_members(user_id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.task_comments enable row level security;
alter table public.comment_reads enable row level security;
drop policy if exists task_comments_family_all on public.task_comments;
create policy task_comments_family_all on public.task_comments for all using (public.is_family_member()) with check (public.is_family_member());
drop policy if exists comment_reads_family_all on public.comment_reads;
create policy comment_reads_family_all on public.comment_reads for all using (public.is_family_member()) with check (public.is_family_member());

do $$ begin
  begin alter publication supabase_realtime add table public.task_comments; exception when duplicate_object then null; end;
end $$;
select 'ok' as status;
