-- Storage bucket for the business logo, uploaded from Business Settings.
-- Public read (the login screen needs to show it before anyone is
-- authenticated); only admins can upload/replace/remove it.
begin;

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read" on storage.objects
  for select using (bucket_id = 'branding');

drop policy if exists "branding_admin_insert" on storage.objects;
create policy "branding_admin_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'branding' and public.is_admin());

drop policy if exists "branding_admin_update" on storage.objects;
create policy "branding_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'branding' and public.is_admin());

drop policy if exists "branding_admin_delete" on storage.objects;
create policy "branding_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'branding' and public.is_admin());

alter table public.business_settings add column if not exists logo_url text;

commit;
