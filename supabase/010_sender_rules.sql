-- =====================================================================
--  Kto pisze o kim: mapowanie nadawcy (4Parents / Librus) na dziecko
--  Opiekunki się zmieniają, więc regułami zarządza się w aplikacji.
-- =====================================================================
create table if not exists public.sender_rules (
  source     text not null,                    -- '4parents' | 'librus'
  sender     text not null,                    -- imię i nazwisko tak, jak przychodzi z API
  scope      text not null default 'child',    -- 'child' = konkretne dziecko, 'all' = całe przedszkole
  child_id   uuid references public.children(id) on delete cascade,
  updated_by uuid references public.family_members(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (source, sender)
);

alter table public.sender_rules enable row level security;
drop policy if exists sender_rules_family_all on public.sender_rules;
create policy sender_rules_family_all on public.sender_rules
  for all using (public.is_family_member()) with check (public.is_family_member());

do $$ begin
  begin alter publication supabase_realtime add table public.sender_rules; exception when duplicate_object then null; end;
end $$;

select 'ok' as status;
