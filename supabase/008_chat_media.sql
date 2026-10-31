-- Czat: obrazki/GIF-y + zapis i usuwanie plików przez członków rodziny
alter table public.messages add column if not exists media_path text;

drop policy if exists attachments_family_write on storage.objects;
create policy attachments_family_write on storage.objects
  for insert with check (bucket_id = 'attachments' and public.is_family_member());

drop policy if exists attachments_family_delete on storage.objects;
create policy attachments_family_delete on storage.objects
  for delete using (bucket_id = 'attachments' and public.is_family_member());
