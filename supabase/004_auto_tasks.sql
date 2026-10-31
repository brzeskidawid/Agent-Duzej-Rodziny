-- =====================================================================
--  Zadania: 'Dziecko' jako wykonawca + automatyczne zadania z wpisów
-- =====================================================================

alter table public.tasks add column if not exists child_assignee boolean not null default false; -- wykonawca: Dziecko
alter table public.tasks add column if not exists auto boolean not null default false;

-- jedno automatyczne zadanie na wpis
create unique index if not exists tasks_auto_item_idx on public.tasks (item_id) where auto;

-- Nowy wpis z terminem (zadanie domowe / wydarzenie z terminarza) => zadanie w "Nieprzypisanych"
create or replace function public.item_to_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('homework', 'event') and new.occurred_at is not null
     and new.occurred_at >= now() - interval '1 day' then
    insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
    values (left(new.title, 300), new.child_id, new.occurred_at, 'todo', new.id, true, left(new.body, 500))
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists items_auto_task on public.items;
create trigger items_auto_task after insert on public.items
  for each row execute function public.item_to_task();

-- Przelanie już istniejących wpisów z przyszłym terminem
insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
select left(i.title, 300), i.child_id, i.occurred_at, 'todo', i.id, true, left(i.body, 500)
from public.items i
where i.kind in ('homework', 'event') and i.occurred_at >= now() - interval '1 day'
  and not exists (select 1 from public.tasks t where t.item_id = i.id)
on conflict do nothing;

select count(*) filter (where auto) as automatyczne, count(*) as razem from public.tasks;
