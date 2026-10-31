-- =====================================================================
--  AGENT DUŻEJ RODZINY — magazyn załączników (Supabase Storage)
--  Wklej w SQL Editor → Run. Tworzy prywatny bucket "attachments":
--  worker zapisuje pliki (klucz tajny), członkowie rodziny mogą je czytać.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

drop policy if exists attachments_family_read on storage.objects;
create policy attachments_family_read on storage.objects
  for select using (bucket_id = 'attachments' and public.is_family_member());
