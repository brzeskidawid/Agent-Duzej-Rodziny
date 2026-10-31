-- Automatyczne zadania także z wiadomości o sprawdzianach (z terminem z treści) + reakcja na uzupełnienie terminu
create or replace function public.item_to_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.occurred_at is not null and new.occurred_at >= now() - interval '1 day'
     and (new.kind in ('homework', 'event')
          or (new.kind = 'message' and new.title ~* 'sprawdzian|kartk|dyktand|praca klasowa|klas[óo]wk|\mtest\M|egzamin')) then
    insert into public.tasks (title, child_id, due_at, status, item_id, auto, notes)
    values (left(new.title, 300), new.child_id, new.occurred_at, 'todo', new.id, true, left(new.body, 500))
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists items_auto_task on public.items;
create trigger items_auto_task after insert or update of occurred_at on public.items
  for each row execute function public.item_to_task();
