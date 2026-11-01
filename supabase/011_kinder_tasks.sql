-- =====================================================================
--  Zadania z wpisów przedszkolnych ("przynieś blok", "strój księżniczki")
--  Trafiają do "Nieprzypisanych zadań", bo 4Parents nie mówi, kogo dotyczą.
-- =====================================================================
create or replace function public.item_to_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kw   text;
  zd   text;
  tyt  text;
  wzor text := '(?:przyni|prosimy o|prosz[ęe] o|zabra[ćc]|potrzebn|str[óo]j|przebra|wp[łl]at|kostium)';
begin
  if new.occurred_at is null or new.occurred_at < now() - interval '1 day' then return new; end if;

  if new.kind in ('homework', 'event') then
    insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
    values (left(new.title, 300), new.child_id, new.occurred_at, 'todo', new.id, true, left(new.body, 500))
    on conflict do nothing;

  elsif new.source = '4parents' then
    -- tytuł wpisu to zwykle "Drodzy Rodzice!", więc bierzemy zdanie z samą prośbą
    if not (coalesce(new.title, '') || ' ' || coalesce(new.body, '')) ~* wzor then return new; end if;
    zd := (regexp_match(coalesce(new.title, '') || '. ' || coalesce(new.body, ''),
                        '[^.!?\n]*' || wzor || '[^.!?\n]*', 'i'))[1];
    tyt := btrim(coalesce(nullif(btrim(zd), ''), new.title));
    insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
    values ('Przedszkole: ' || left(tyt, 280), new.child_id, new.occurred_at, 'todo', new.id, true, left(new.body, 500))
    on conflict do nothing;

  elsif new.kind = 'message' then
    kw := lower((regexp_match(new.title, 'sprawdzian|kartk|dyktand|praca klasowa|klas[óo]wk|test|egzamin', 'i'))[1]);
    if kw is null then return new; end if;
    if exists (
      select 1 from public.tasks t
      where t.auto and t.child_id is not distinct from new.child_id
        and t.due_at::date = new.occurred_at::date and t.title ilike '%' || kw || '%'
    ) then return new; end if;
    insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
    values (left(new.title, 300), new.child_id, new.occurred_at, 'todo', new.id, true, left(new.body, 500))
    on conflict do nothing;
  end if;
  return new;
end $$;

-- Dociągnięcie tego, co już wisi w bazie z terminem od dziś
insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
select 'Przedszkole: ' || left(btrim(coalesce(nullif(btrim(
         (regexp_match(coalesce(i.title,'') || '. ' || coalesce(i.body,''),
          '[^.!?\n]*(?:przyni|prosimy o|prosz[ęe] o|zabra[ćc]|potrzebn|str[óo]j|przebra|wp[łl]at|kostium)[^.!?\n]*', 'i'))[1]
       ), ''), i.title)), 280),
       i.child_id, i.occurred_at, 'todo', i.id, true, left(i.body, 500)
from public.items i
where i.source = '4parents'
  and i.occurred_at >= now() - interval '1 day'
  and (coalesce(i.title,'') || ' ' || coalesce(i.body,'')) ~* '(przyni|prosimy o|prosz[ęe] o|zabra[ćc]|potrzebn|str[óo]j|przebra|wp[łl]at|kostium)'
  and not exists (select 1 from public.tasks t where t.item_id = i.id)
on conflict do nothing;

select count(*) filter (where auto) as automatyczne, count(*) as razem from public.tasks;
