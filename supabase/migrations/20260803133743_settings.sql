-- Business Settings (admin-editable, everyone can read) + a personal
-- preference column on profiles for "My Settings" (default landing page).
begin;

create table if not exists public.business_settings (
  id smallint primary key default 1 check (id = 1), -- singleton row
  business_name text not null default '',
  phone text not null default '',
  address text not null default '',
  currency_symbol text not null default 'GH₵',
  default_reorder_level integer not null default 10,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.business_settings enable row level security;

drop policy if exists "business_settings_select" on public.business_settings;
create policy "business_settings_select" on public.business_settings
  for select to authenticated using (true);

drop policy if exists "business_settings_admin_write" on public.business_settings;
create policy "business_settings_admin_write" on public.business_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.business_settings to authenticated;
grant insert, update on public.business_settings to authenticated;

-- Seed the singleton row with the business's real current contact info
-- (previously only ever hardcoded in the public site's HTML).
insert into public.business_settings (id, business_name, phone, address, currency_symbol, default_reorder_level)
values (1, 'Lumoda Enterprise — Maa Lucy''s Place', '0546 014 044', 'Alabar & Morocco (K.O), Kumasi', 'GH₵', 10)
on conflict (id) do nothing;

alter table public.profiles add column if not exists default_landing_page text;

commit;
