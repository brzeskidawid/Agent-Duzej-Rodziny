-- Zadanie z wiadomości o sprawdzianie nie powstaje, gdy tego dnia dla tego dziecka jest już zadanie z terminarza o tym samym typie
create or replace function public.item_to_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare kw text;
begin
  if new.occurred_at is null or new.occurred_at < now() - interval '1 day' then return new; end if;
  if exists (select 1 from public.tasks t where t.item_id = new.id) then return new; end if;
  if new.kind in ('homework', 'event') then
    insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
    values (left(new.title, 300), new.child_id, new.occurred_at, 'todo', new.id, true, left(new.body, 500))
    on conflict do nothing;
  elsif new.kind = 'message' then
    kw := lower((regexp_match(new.title, 'sprawdzian|kartk|dyktand|praca klasowa|klas[óo]wk|test|egzamin', 'i'))[1]);
    if kw is null then return new; end if;
    if exists (
      select 1 from public.tasks t
      where t.child_id is not distinct from new.child_id
        and t.due_at::date = new.occurred_at::date and t.title ilike '%' || kw || '%'
    ) then return new; end if;
    insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
    values (left(new.title, 300), new.child_id, new.occurred_at, 'todo', new.id, true, left(new.body, 500))
    on conflict do nothing;
  end if;
  return new;
end $$;

-- usuń istniejące duplikaty z wiadomości (zostaje zadanie z terminarza)
delete from public.tasks m
using public.items i
where m.item_id = i.id and i.kind = 'message' and m.auto
  and exists (
    select 1 from public.tasks t join public.items ti on ti.id = t.item_id
    where t.auto and ti.kind in ('event','homework') and t.id <> m.id
      and t.child_id is not distinct from m.child_id and t.due_at::date = m.due_at::date
      and lower(t.title) like '%' || lower((regexp_match(m.title, 'sprawdzian|kartk|dyktand|praca klasowa|klas[óo]wk|test|egzamin', 'i'))[1]) || '%'
  );
select count(*) filter (where auto) as automatyczne, count(*) as razem from public.tasks;
