-- Lets an admin customize the app's primary accent colour (currently a
-- fixed brown everywhere) instead of it being hardcoded.
begin;

alter table public.business_settings add column if not exists brand_color text not null default '#5C2D0A';

commit;
