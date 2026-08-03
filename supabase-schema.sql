-- LUMODA ENTERPRISE Supabase schema
-- Run this in Supabase Dashboard > SQL Editor.
-- After running it, keep Row Level Security enabled on every business table.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('admin', 'staff', 'warehouse_manager');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.branch_location as enum ('All', 'Alabar', 'Morocco');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.invoice_status as enum ('paid', 'pending', 'partial');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_method as enum ('cash', 'momo');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  full_name text not null,
  role public.user_role not null default 'staff',
  location public.branch_location not null default 'Alabar',
  active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (role in ('admin', 'warehouse_manager') and location = 'All')
    or (role = 'staff' and location in ('Alabar', 'Morocco'))
  )
);

alter table public.profiles
  add column if not exists email text;

create unique index if not exists profiles_email_idx
  on public.profiles (lower(email))
  where email is not null;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text not null default 'General',
  price numeric(12,2) not null check (price >= 0),
  retail_price numeric(12,2) not null default 0 check (retail_price >= 0),
  wholesale_price numeric(12,2) not null default 0 check (wholesale_price >= 0),
  carton_price numeric(12,2) not null default 0 check (carton_price >= 0),
  stock_alabar integer not null default 0 check (stock_alabar >= 0),
  stock_morocco integer not null default 0 check (stock_morocco >= 0),
  reorder_level integer not null default 5 check (reorder_level >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
  add column if not exists retail_price numeric(12,2) not null default 0 check (retail_price >= 0),
  add column if not exists wholesale_price numeric(12,2) not null default 0 check (wholesale_price >= 0),
  add column if not exists carton_price numeric(12,2) not null default 0 check (carton_price >= 0);

update public.products
set retail_price = case when retail_price = 0 then price else retail_price end,
    wholesale_price = case when wholesale_price = 0 then price else wholesale_price end,
    carton_price = case when carton_price = 0 then price else carton_price end;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  location public.branch_location not null check (location in ('Alabar', 'Morocco')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence if not exists public.invoice_number_seq start with 2388;

create or replace function public.generate_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return lpad(nextval('public.invoice_number_seq')::text, 6, '0');
end;
$$;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default public.generate_invoice_number(),
  customer_id uuid references public.customers(id),
  customer_name text not null,
  customer_phone text,
  customer_address text,
  location public.branch_location not null check (location in ('Alabar', 'Morocco')),
  total numeric(12,2) not null default 0 check (total >= 0),
  status public.invoice_status not null default 'pending',
  pay_method public.payment_method,
  momo_number text,
  notes text,
  created_by uuid not null references auth.users(id),
  deleted boolean not null default false,
  deleted_by uuid references auth.users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices
alter column number set default public.generate_invoice_number();

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid references public.products(id),
  name text not null,
  sale_type text not null default 'retail' check (sale_type in ('retail', 'wholesale', 'carton')),
  qty integer not null check (qty > 0),
  price numeric(12,2) not null check (price >= 0),
  total numeric(12,2) generated always as (qty * price) stored
);

alter table public.invoice_items
  add column if not exists sale_type text not null default 'retail' check (sale_type in ('retail', 'wholesale', 'carton'));

create table if not exists public.stock_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  product_name text not null,
  location public.branch_location not null check (location in ('Alabar', 'Morocco')),
  change integer not null,
  type text not null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  detail text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Partial-payment / cash-sale support, added directly on the live project
-- after this file was first written. Captured here so the file matches
-- what's actually running (baseline sync).
alter table public.invoices
  add column if not exists subtotal numeric(12,2) default 0,
  add column if not exists discount numeric(12,2) default 0,
  add column if not exists amount_paid numeric(12,2) not null default 0,
  add column if not exists balance numeric(12,2) not null default 0,
  add column if not exists partial_method text,
  add column if not exists partial_momo_number text,
  add column if not exists is_cash_sale boolean not null default false,
  add column if not exists cash_tendered numeric(12,2);

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  method text,
  momo_number text,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists invoice_payments_invoice_id_idx on public.invoice_payments(invoice_id);

-- Discount / item-change requests from non-admin staff, held for admin
-- approval instead of being applied directly (see create_invoice_no_stock
-- and update_invoice_no_stock below).
create table if not exists public.invoice_edit_requests (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id),
  request_type text not null check (request_type in ('item_change', 'discount')),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text
);

create index if not exists invoice_edit_requests_pending_idx
  on public.invoice_edit_requests (status, requested_at desc)
  where status = 'pending';

-- Warehouse schema lives in `supabase-warehouse-schema.sql` to keep it separate
-- from the core auth, invoicing, customer, and product schema.

create or replace function public.log_audit(
  p_action text,
  p_detail text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_log_id uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.audit_logs (action, detail, created_by)
  values (trim(p_action), trim(p_detail), v_user)
  returning id into v_log_id;

  return v_log_id;
end;
$$;

create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_location_idx on public.profiles(location);
create index if not exists products_sku_idx on public.products(sku);
create index if not exists customers_location_idx on public.customers(location);
create index if not exists invoices_location_idx on public.invoices(location);
create index if not exists invoices_created_by_idx on public.invoices(created_by);
create index if not exists invoices_location_created_at_idx on public.invoices(location, created_at desc);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);
create index if not exists stock_history_product_location_idx on public.stock_history(product_id, location);
create index if not exists stock_history_location_idx on public.stock_history(location);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at before update on public.customers
for each row execute function public.touch_updated_at();

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at before update on public.invoices
for each row execute function public.touch_updated_at();

create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
  where id = (select auth.uid()) and active = true
$$;

create or replace function public.current_profile_location()
returns public.branch_location
language sql
stable
security definer
set search_path = public
as $$
  select location from public.profiles
  where id = (select auth.uid()) and active = true
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.can_access_location(row_location public.branch_location)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or public.current_profile_location() = 'All'
    or public.current_profile_location() = row_location,
    false
  )
$$;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.profiles
  set must_change_password = false,
      updated_at = now()
  where id = auth.uid();
end;
$$;

create or replace function public.generate_product_sku(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_slug text;
begin
  v_slug := upper(
    trim(
      both '-' from regexp_replace(
        regexp_replace(trim(coalesce(p_name, '')), $rx$[.'"]$rx$, '', 'g'),
        '[^A-Za-z0-9]+',
        '-',
        'g'
      )
    )
  );

  if v_slug = '' then
    v_slug := 'PRODUCT';
  end if;

  return 'LMD-' || v_slug;
end;
$$;

drop function if exists public.import_products(jsonb, text, text, integer);
drop function if exists public.import_products(jsonb, text, text, integer, boolean);

create or replace function public.import_products(
  p_products jsonb,
  p_stock_target text default 'both',
  p_default_category text default 'General',
  p_default_reorder integer default 5,
  p_replace_stock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_name text;
  v_sku text;
  v_category text;
  v_price numeric(12,2);
  v_stock integer;
  v_stock_alabar integer;
  v_stock_morocco integer;
  v_reorder integer;
  v_added integer := 0;
  v_updated integer := 0;
  v_existing uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can import products';
  end if;

  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'Products must be a JSON array';
  end if;

  if p_stock_target not in ('both', 'alabar', 'morocco') then
    raise exception 'Invalid stock target';
  end if;

  for v_item in select * from jsonb_array_elements(p_products)
  loop
    v_name := trim(coalesce(v_item->>'name', v_item->>'NAME', ''));
    if v_name = '' then
      continue;
    end if;

    v_price := coalesce(nullif(v_item->>'price', '')::numeric, nullif(v_item->>'PRICE', '')::numeric, 0);
    if v_price < 0 then
      raise exception 'Invalid price for %', v_name;
    end if;

    v_stock := coalesce(nullif(v_item->>'stock', '')::integer, nullif(v_item->>'STOCK', '')::integer, 0);
    if v_stock < 0 then
      raise exception 'Invalid stock for %', v_name;
    end if;

    v_stock_alabar := coalesce(nullif(v_item->>'stock_alabar', '')::integer, nullif(v_item->>'STOCK_ALABAR', '')::integer, case when p_stock_target in ('both', 'alabar') then v_stock else 0 end);
    v_stock_morocco := coalesce(nullif(v_item->>'stock_morocco', '')::integer, nullif(v_item->>'STOCK_MOROCCO', '')::integer, case when p_stock_target in ('both', 'morocco') then v_stock else 0 end);

    if v_stock_alabar < 0 or v_stock_morocco < 0 then
      raise exception 'Invalid branch stock for %', v_name;
    end if;

    v_category := nullif(trim(coalesce(v_item->>'category', v_item->>'CATEGORY', p_default_category, 'General')), '');
    v_reorder := coalesce(nullif(v_item->>'reorder_level', '')::integer, nullif(v_item->>'REORDER_LEVEL', '')::integer, p_default_reorder, 5);
    if v_reorder < 0 then
      raise exception 'Invalid reorder level for %', v_name;
    end if;

    v_sku := nullif(trim(coalesce(v_item->>'sku', v_item->>'SKU', '')), '');
    if v_sku is null then
      v_sku := public.generate_product_sku(v_name);
    end if;

    select id into v_existing
    from public.products
    where sku = v_sku;

    insert into public.products (name, sku, category, price, stock_alabar, stock_morocco, reorder_level)
    values (v_name, v_sku, v_category, v_price, v_stock_alabar, v_stock_morocco, v_reorder)
    on conflict (sku) do update
    set name = excluded.name,
        category = excluded.category,
        price = excluded.price,
        stock_alabar = case when p_replace_stock then excluded.stock_alabar else public.products.stock_alabar end,
        stock_morocco = case when p_replace_stock then excluded.stock_morocco else public.products.stock_morocco end,
        reorder_level = excluded.reorder_level;

    if v_existing is null then
      v_added := v_added + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  insert into public.audit_logs (action, detail, created_by)
  values ('Products Imported', 'Products import completed: ' || v_added || ' added, ' || v_updated || ' updated', v_user);

  return jsonb_build_object('added', v_added, 'updated', v_updated);
end;
$$;

create or replace function public.create_invoice(
  p_customer_name text,
  p_location public.branch_location,
  p_items jsonb,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status public.invoice_status default 'pending',
  p_pay_method public.payment_method default null,
  p_momo_number text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_customer_id uuid;
  v_invoice_id uuid;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_qty integer;
  v_price numeric(12,2);
  v_sale_type text;
  v_item_total numeric(12,2);
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select role, location
    into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then
    raise exception 'Active profile not found';
  end if;

  if p_location not in ('Alabar', 'Morocco') then
    raise exception 'Invalid invoice location';
  end if;

  if v_role <> 'admin' and p_location <> v_user_location then
    raise exception 'You cannot create invoices for this branch';
  end if;

  if length(trim(coalesce(p_customer_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;

  if p_status = 'paid' and p_pay_method is null then
    raise exception 'Payment method is required for paid invoices';
  end if;

  if p_status <> 'paid' then
    p_pay_method := null;
    p_momo_number := null;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice requires at least one item';
  end if;

  select id
    into v_customer_id
  from public.customers
  where lower(name) = lower(trim(p_customer_name))
    and location = p_location
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone, address, location, created_by)
    values (trim(p_customer_name), nullif(trim(coalesce(p_customer_phone, '')), ''), nullif(trim(coalesce(p_customer_address, '')), ''), p_location, v_user)
    returning id into v_customer_id;
  end if;

  insert into public.invoices (
    customer_id,
    customer_name,
    customer_phone,
    customer_address,
    location,
    total,
    status,
    pay_method,
    momo_number,
    notes,
    created_by
  )
  values (
    v_customer_id,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    p_location,
    0,
    p_status,
    p_pay_method,
    nullif(trim(coalesce(p_momo_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_user
  )
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := coalesce((v_item->>'qty')::integer, 0);

    if v_qty < 1 then
      raise exception 'Quantity must be greater than zero';
    end if;

    select *
      into v_product
    from public.products
    where id = v_product_id
    for update;

    if not found then
      raise exception 'Product not found';
    end if;

    if p_location = 'Alabar' then
      if v_product.stock_alabar < v_qty then
        raise exception 'Not enough stock for % at Alabar', v_product.name;
      end if;

      update public.products
      set stock_alabar = stock_alabar - v_qty
      where id = v_product.id;
    else
      if v_product.stock_morocco < v_qty then
        raise exception 'Not enough stock for % at Morocco', v_product.name;
      end if;

      update public.products
      set stock_morocco = stock_morocco - v_qty
      where id = v_product.id;
    end if;

    v_item_total := v_product.price * v_qty;
    v_total := v_total + v_item_total;

    insert into public.invoice_items (invoice_id, product_id, name, qty, price)
    values (v_invoice_id, v_product.id, v_product.name, v_qty, v_product.price);

    insert into public.stock_history (product_id, product_name, location, change, type, note, created_by)
    values (v_product.id, v_product.name, p_location, -v_qty, 'Sale', 'Invoice created', v_user);
  end loop;

  update public.invoices
  set total = v_total
  where id = v_invoice_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Created', 'Invoice ' || (select number from public.invoices where id = v_invoice_id) || ' created for ' || trim(p_customer_name), v_user);

  return v_invoice_id;
exception
  when invalid_text_representation then
    raise exception 'Invalid invoice item product id';
end;
$$;

-- NOTE: this replaces the original 9-param version. The live project grew it
-- to 15 params (partial payments / cash sales / discount-approval routing)
-- without this file being updated to match — captured here (baseline sync).
create or replace function public.create_invoice_no_stock(
  p_customer_name text,
  p_location public.branch_location,
  p_items jsonb,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status public.invoice_status default 'pending',
  p_pay_method public.payment_method default null,
  p_momo_number text default null,
  p_notes text default null,
  p_amount_paid numeric default 0,
  p_discount numeric default 0,
  p_partial_method text default null,
  p_partial_momo text default null,
  p_is_cash_sale boolean default false,
  p_cash_tendered numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_invoice_id uuid;
  v_number text;
  v_customer_id uuid;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_effective_paid numeric(12,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_item_name text;
  v_item_qty integer;
  v_item_price numeric(12,2);
  v_sale_type text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, location into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then raise exception 'Active profile not found'; end if;
  if p_location not in ('Alabar', 'Morocco') then raise exception 'Invalid invoice location'; end if;
  if v_role <> 'admin' and p_location <> v_user_location then raise exception 'You cannot create invoices for this branch'; end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then raise exception 'Customer name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Invoice requires at least one item'; end if;
  if p_status = 'paid' and p_pay_method is null then raise exception 'Payment method is required for paid invoices'; end if;

  -- Any discount from a non-admin is held for approval instead of applied.
  -- Nothing is created yet — the customer record, invoice, and items are
  -- only produced once an admin approves the request (approve_invoice_request).
  if v_role <> 'admin' and coalesce(p_discount, 0) > 0 then
    insert into public.invoice_edit_requests (invoice_id, request_type, requested_by, payload)
    values (
      null,
      'discount',
      v_user,
      jsonb_build_object(
        'p_customer_name', p_customer_name,
        'p_location', p_location,
        'p_items', p_items,
        'p_customer_phone', p_customer_phone,
        'p_customer_address', p_customer_address,
        'p_status', p_status,
        'p_pay_method', p_pay_method,
        'p_momo_number', p_momo_number,
        'p_notes', p_notes,
        'p_amount_paid', p_amount_paid,
        'p_discount', p_discount,
        'p_partial_method', p_partial_method,
        'p_partial_momo', p_partial_momo,
        'p_is_cash_sale', p_is_cash_sale,
        'p_cash_tendered', p_cash_tendered
      )
    );
    return jsonb_build_object('success', true, 'discount_pending_approval', true);
  end if;

  if p_status <> 'paid' then
    p_pay_method := null;
    p_momo_number := null;
  end if;

  select id into v_customer_id
  from public.customers
  where lower(name) = lower(trim(p_customer_name))
    and location = p_location
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone, address, location, created_by)
    values (
      trim(p_customer_name),
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_address, '')), ''),
      p_location,
      v_user
    ) returning id into v_customer_id;
  else
    update public.customers
    set phone = coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), phone),
        address = coalesce(nullif(trim(coalesce(p_customer_address, '')), ''), address)
    where id = v_customer_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);

    if v_item_name = '' then raise exception 'Item name is required'; end if;
    if v_item_qty < 1 then raise exception 'Quantity must be greater than zero'; end if;
    if v_item_price < 0 then raise exception 'Price cannot be negative'; end if;

    v_subtotal := v_subtotal + (v_item_qty * v_item_price);
  end loop;

  if v_subtotal <= 0 then raise exception 'Invoice total must be greater than zero'; end if;

  v_total := greatest(v_subtotal - coalesce(p_discount, 0), 0);

  v_effective_paid := case
    when p_status = 'paid' then v_total
    when p_status = 'partial' then least(greatest(coalesce(p_amount_paid, 0), 0), v_total)
    else 0
  end;

  insert into public.invoices (
    customer_id, customer_name, customer_phone, customer_address,
    location, subtotal, discount, total, status, pay_method, momo_number, notes,
    amount_paid, balance, partial_method, partial_momo_number, is_cash_sale, cash_tendered, created_by
  ) values (
    v_customer_id,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    p_location,
    v_subtotal,
    coalesce(p_discount, 0),
    v_total,
    p_status,
    p_pay_method,
    nullif(trim(coalesce(p_momo_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_effective_paid,
    greatest(v_total - v_effective_paid, 0),
    p_partial_method,
    nullif(trim(coalesce(p_partial_momo, '')), ''),
    coalesce(p_is_cash_sale, false),
    p_cash_tendered,
    v_user
  ) returning id, number into v_invoice_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);
    v_sale_type := coalesce(nullif(v_item->>'sale_type', ''), nullif(v_item->>'priceType', ''), 'retail');
    v_product_id := null;

    if nullif(v_item->>'product_id', '') is not null and v_item->>'product_id' <> 'null' then
      select id into v_product_id
      from public.products
      where id = (v_item->>'product_id')::uuid
      limit 1;
    end if;

    if v_product_id is null then
      select id into v_product_id
      from public.products
      where lower(name) = lower(v_item_name)
      limit 1;
    end if;

    insert into public.invoice_items (invoice_id, product_id, name, sale_type, qty, price)
    values (v_invoice_id, v_product_id, v_item_name, v_sale_type, v_item_qty, v_item_price);
  end loop;

  if v_effective_paid > 0 then
    insert into public.invoice_payments (invoice_id, amount, method, momo_number, note, created_by)
    values (
      v_invoice_id,
      v_effective_paid,
      coalesce(p_pay_method::text, p_partial_method),
      coalesce(p_momo_number, p_partial_momo),
      'Initial payment',
      v_user
    );
  end if;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Created', 'Invoice ' || v_number || ' created for ' || trim(p_customer_name), v_user);

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'number', v_number,
    'subtotal', v_subtotal,
    'discount', coalesce(p_discount, 0),
    'total', v_total,
    'paid', v_effective_paid,
    'balance', greatest(v_total - v_effective_paid, 0)
  );
end;
$$;

-- Edits an existing invoice. Item-quantity *reductions* from a non-admin are
-- held for approval (invoice_edit_requests) rather than applied immediately;
-- everything else (status/payment/notes/customer details, or any change from
-- an admin) applies right away.
create or replace function public.update_invoice_no_stock(
  p_invoice_id uuid,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status text default null,
  p_pay_method text default null,
  p_momo_number text default null,
  p_notes text default null,
  p_subtotal numeric default null,
  p_total numeric default null,
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_invoice_location public.branch_location;
  v_invoice_status public.invoice_status;
  v_invoice jsonb;
  v_items jsonb;
  v_current_key text;
  v_current_qty integer;
  v_proposed_qty integer;
  v_needs_approval boolean := false;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role, location into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then raise exception 'Active profile not found'; end if;

  select location, status into v_invoice_location, v_invoice_status
  from public.invoices
  where id = p_invoice_id and deleted = false;

  if not found then raise exception 'Invoice not found'; end if;
  if v_role <> 'admin' and v_invoice_location <> v_user_location then
    raise exception 'You cannot edit invoices for this branch';
  end if;

  if p_items is not null and jsonb_array_length(p_items) > 0
     and v_invoice_status in ('paid', 'partial') and v_role <> 'admin' then
    raise exception 'This invoice is already paid or partially paid — ask an admin to make item changes';
  end if;

  if p_items is not null and jsonb_array_length(p_items) > 0 and v_role <> 'admin' then
    for v_current_key, v_current_qty in
      select coalesce(name,'') || '|' || coalesce(sale_type,'retail'), sum(qty)::integer
      from public.invoice_items
      where invoice_id = p_invoice_id
      group by 1
    loop
      select coalesce(sum((item->>'qty')::integer), 0) into v_proposed_qty
      from jsonb_array_elements(p_items) as item
      where coalesce(item->>'name','') || '|' || coalesce(nullif(item->>'sale_type',''), 'retail') = v_current_key;

      if v_proposed_qty < v_current_qty then
        v_needs_approval := true;
        exit;
      end if;
    end loop;

    if v_needs_approval then
      insert into public.invoice_edit_requests (invoice_id, request_type, requested_by, payload)
      values (
        p_invoice_id,
        'item_change',
        v_user,
        jsonb_build_object(
          'p_invoice_id', p_invoice_id,
          'p_customer_name', p_customer_name,
          'p_customer_phone', p_customer_phone,
          'p_customer_address', p_customer_address,
          'p_status', p_status,
          'p_pay_method', p_pay_method,
          'p_momo_number', p_momo_number,
          'p_notes', p_notes,
          'p_subtotal', p_subtotal,
          'p_total', p_total,
          'p_items', p_items
        )
      );
      return jsonb_build_object('success', true, 'items_pending_approval', true);
    end if;
  end if;

  update invoices set
    customer_name    = coalesce(p_customer_name,    customer_name),
    customer_phone   = coalesce(p_customer_phone,   customer_phone),
    customer_address = coalesce(p_customer_address, customer_address),
    status           = case when p_status is not null then p_status::invoice_status else status end,
    pay_method       = case
                         when p_status = 'paid' and p_pay_method is not null then p_pay_method::payment_method
                         when p_status = 'paid' and p_pay_method is null then null
                         else pay_method
                       end,
    momo_number      = case when p_status = 'paid' then p_momo_number else momo_number end,
    notes            = coalesce(p_notes,    notes),
    subtotal         = coalesce(p_subtotal, subtotal),
    total            = coalesce(p_total,    total),
    updated_at       = now()
  where id = p_invoice_id;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    delete from invoice_items where invoice_id = p_invoice_id;
    insert into invoice_items (invoice_id, name, qty, price, sale_type)
    select
      p_invoice_id,
      (item->>'name')::text,
      (item->>'qty')::integer,
      (item->>'price')::numeric,
      coalesce(nullif(item->>'sale_type', ''), 'retail')
    from jsonb_array_elements(p_items) as item
    where (item->>'name') is not null and (item->>'name') <> '';
  end if;

  select row_to_json(i)::jsonb into v_invoice from invoices i where i.id = p_invoice_id;
  select jsonb_agg(row_to_json(ii)) into v_items from invoice_items ii where ii.invoice_id = p_invoice_id;

  return jsonb_build_object('invoice', v_invoice, 'items', coalesce(v_items, '[]'::jsonb), 'success', true);
end;
$$;

create or replace function public.record_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set last_login = now()
  where id = auth.uid();
end;
$$;

create or replace function public.record_partial_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text default null,
  p_momo_number text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_new_paid numeric(12,2);
  v_new_balance numeric(12,2);
  v_new_status public.invoice_status;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and deleted = false
  for update;

  if not found then raise exception 'Invoice not found'; end if;
  if not public.can_access_location(v_invoice.location) then raise exception 'Access denied'; end if;

  v_new_paid := least(coalesce(v_invoice.amount_paid, 0) + p_amount, v_invoice.total);
  v_new_balance := greatest(v_invoice.total - v_new_paid, 0);
  v_new_status := case when v_new_balance = 0 then 'paid'::public.invoice_status else 'partial'::public.invoice_status end;

  insert into public.invoice_payments (invoice_id, amount, method, momo_number, note, created_by)
  values (p_invoice_id, p_amount, p_method, nullif(trim(coalesce(p_momo_number, '')), ''), nullif(trim(coalesce(p_note, '')), ''), v_user);

  update public.invoices
  set amount_paid = v_new_paid,
      balance = v_new_balance,
      status = v_new_status,
      partial_method = p_method,
      partial_momo_number = nullif(trim(coalesce(p_momo_number, '')), '')
  where id = p_invoice_id;

  return jsonb_build_object(
    'new_paid', v_new_paid,
    'new_balance', v_new_balance,
    'new_status', v_new_status
  );
end;
$$;

create or replace function public.approve_invoice_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_request public.invoice_edit_requests%rowtype;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role from public.profiles where id = v_user and active = true;
  if not found or v_role <> 'admin' then
    raise exception 'Only an admin can approve requests';
  end if;

  select * into v_request from public.invoice_edit_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'Request has already been reviewed'; end if;

  if v_request.request_type = 'discount' then
    select public.create_invoice_no_stock(
      p_customer_name    => v_request.payload->>'p_customer_name',
      p_location         => (v_request.payload->>'p_location')::public.branch_location,
      p_items            => v_request.payload->'p_items',
      p_customer_phone   => v_request.payload->>'p_customer_phone',
      p_customer_address => v_request.payload->>'p_customer_address',
      p_status           => coalesce((v_request.payload->>'p_status')::public.invoice_status, 'pending'),
      p_pay_method       => nullif(v_request.payload->>'p_pay_method','')::public.payment_method,
      p_momo_number      => v_request.payload->>'p_momo_number',
      p_notes            => v_request.payload->>'p_notes',
      p_amount_paid      => coalesce((v_request.payload->>'p_amount_paid')::numeric, 0),
      p_discount         => coalesce((v_request.payload->>'p_discount')::numeric, 0),
      p_partial_method   => v_request.payload->>'p_partial_method',
      p_partial_momo     => v_request.payload->>'p_partial_momo',
      p_is_cash_sale     => coalesce((v_request.payload->>'p_is_cash_sale')::boolean, false),
      p_cash_tendered    => nullif(v_request.payload->>'p_cash_tendered','')::numeric
    ) into v_result;

  elsif v_request.request_type = 'item_change' then
    select public.update_invoice_no_stock(
      p_invoice_id       => v_request.invoice_id,
      p_customer_name    => v_request.payload->>'p_customer_name',
      p_customer_phone   => v_request.payload->>'p_customer_phone',
      p_customer_address => v_request.payload->>'p_customer_address',
      p_status           => v_request.payload->>'p_status',
      p_pay_method       => v_request.payload->>'p_pay_method',
      p_momo_number      => v_request.payload->>'p_momo_number',
      p_notes            => v_request.payload->>'p_notes',
      p_subtotal         => nullif(v_request.payload->>'p_subtotal','')::numeric,
      p_total            => nullif(v_request.payload->>'p_total','')::numeric,
      p_items            => v_request.payload->'p_items'
    ) into v_result;
  else
    raise exception 'Unknown request type';
  end if;

  update public.invoice_edit_requests
  set status = 'approved', reviewed_by = v_user, reviewed_at = now()
  where id = p_request_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Request Approved', v_request.request_type || ' request approved', v_user);

  return v_result;
end;
$$;

create or replace function public.reject_invoice_request(p_request_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_request public.invoice_edit_requests%rowtype;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  select role into v_role from public.profiles where id = v_user and active = true;
  if not found or v_role <> 'admin' then
    raise exception 'Only an admin can reject requests';
  end if;

  select * into v_request from public.invoice_edit_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.status <> 'pending' then raise exception 'Request has already been reviewed'; end if;

  update public.invoice_edit_requests
  set status = 'rejected', reviewed_by = v_user, reviewed_at = now(), rejection_reason = p_reason
  where id = p_request_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Request Rejected', v_request.request_type || ' request rejected' || coalesce(': ' || p_reason, ''), v_user);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.soft_delete_invoice_no_stock(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invoice public.invoices%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can delete invoices';
  end if;

  select *
    into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.deleted then
    return;
  end if;

  update public.invoices
  set deleted = true,
      deleted_by = v_user,
      deleted_at = now()
  where id = p_invoice_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Deleted (no stock)', 'Invoice ' || v_invoice.number || ' deleted (stock not restored)', v_user);
end;
$$;

create or replace function public.soft_delete_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_item public.invoice_items%rowtype;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can delete invoices';
  end if;

  select *
    into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.deleted then
    return;
  end if;

  for v_item in
    select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_invoice.location = 'Alabar' then
      update public.products
      set stock_alabar = stock_alabar + v_item.qty
      where id = v_item.product_id;
    else
      update public.products
      set stock_morocco = stock_morocco + v_item.qty
      where id = v_item.product_id;
    end if;

    insert into public.stock_history (product_id, product_name, location, change, type, note, created_by)
    values (v_item.product_id, v_item.name, v_invoice.location, v_item.qty, 'Return', 'Invoice ' || v_invoice.number || ' deleted', v_user);
  end loop;

  update public.invoices
  set deleted = true,
      deleted_by = v_user,
      deleted_at = now()
  where id = p_invoice_id;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Deleted', 'Invoice ' || v_invoice.number || ' deleted and stock restored', v_user);
end;
$$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.stock_history enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id or public.is_admin());

drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "products_select_authenticated" on public.products;
create policy "products_select_authenticated"
on public.products for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write"
on public.products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "customers_select_by_location" on public.customers;
create policy "customers_select_by_location"
on public.customers for select
to authenticated
using (public.can_access_location(location));

drop policy if exists "customers_insert_by_location" on public.customers;
create policy "customers_insert_by_location"
on public.customers for insert
to authenticated
with check ((select auth.uid()) = created_by and public.can_access_location(location));

drop policy if exists "customers_update_by_location" on public.customers;
create policy "customers_update_by_location"
on public.customers for update
to authenticated
using (public.can_access_location(location))
with check (public.can_access_location(location));

drop policy if exists "customers_delete_admin" on public.customers;
create policy "customers_delete_admin"
on public.customers for delete
to authenticated
using (public.is_admin());

drop policy if exists "invoices_select_by_location" on public.invoices;
create policy "invoices_select_by_location"
on public.invoices for select
to authenticated
using (public.can_access_location(location));

drop policy if exists "invoices_insert_own_location" on public.invoices;

drop policy if exists "invoices_admin_update" on public.invoices;
create policy "invoices_admin_update"
on public.invoices for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invoice_items_select_parent_location" on public.invoice_items;
create policy "invoice_items_select_parent_location"
on public.invoice_items for select
to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_id and public.can_access_location(i.location)
  )
);

drop policy if exists "invoice_items_insert_parent_allowed" on public.invoice_items;

drop policy if exists "invoice_items_admin_update_delete" on public.invoice_items;
drop policy if exists "invoice_items_admin_update" on public.invoice_items;
create policy "invoice_items_admin_update"
on public.invoice_items for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invoice_items_admin_delete" on public.invoice_items;
create policy "invoice_items_admin_delete"
on public.invoice_items for delete
to authenticated
using (public.is_admin())
;

create or replace view public.sales_summary
with (security_invoker = true)
as
select
  location,
  date_trunc('day', created_at) as day,
  sum(total) as total_sales,
  count(*) as invoice_count
from public.invoices
where deleted = false
group by location, date_trunc('day', created_at);

create or replace view public.outstanding_balances
with (security_invoker = true)
as
select id, number, customer_name, customer_phone, location, total, amount_paid, balance, created_at
from public.invoices
where deleted = false and balance > 0;

create or replace view public.product_sales_summary
with (security_invoker = true)
as
select
  ii.name as product_name,
  ii.product_id,
  i.location,
  date_trunc('day', i.created_at) as sale_day,
  date_trunc('week', i.created_at) as sale_week,
  date_trunc('month', i.created_at) as sale_month,
  sum(ii.qty) as qty_sold,
  ii.price as unit_price,
  sum(ii.qty::numeric * ii.price) as revenue
from public.invoice_items ii
join public.invoices i on i.id = ii.invoice_id
where i.deleted = false
group by ii.name, ii.product_id, i.location, date_trunc('day', i.created_at), date_trunc('week', i.created_at), date_trunc('month', i.created_at), ii.price;

drop policy if exists "invoice_payments_select" on public.invoice_payments;
create policy "invoice_payments_select"
on public.invoice_payments for select
to authenticated
using (
  exists (
    select 1 from public.invoices i
    where i.id = invoice_payments.invoice_id
      and public.can_access_location(i.location)
      and (i.deleted = false or public.is_admin())
      and (public.is_admin() or i.created_by = (select auth.uid()))
  )
);

drop policy if exists "invoice_payments_insert" on public.invoice_payments;
create policy "invoice_payments_insert"
on public.invoice_payments for insert
to authenticated
with check (true);

drop policy if exists "invoice_payments_update" on public.invoice_payments;
create policy "invoice_payments_update"
on public.invoice_payments for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "invoice_edit_requests_select" on public.invoice_edit_requests;
create policy "invoice_edit_requests_select"
on public.invoice_edit_requests for select
to authenticated
using (public.is_admin() or requested_by = (select auth.uid()));

drop policy if exists "invoice_edit_requests_insert" on public.invoice_edit_requests;
create policy "invoice_edit_requests_insert"
on public.invoice_edit_requests for insert
to authenticated
with check (requested_by = (select auth.uid()));

drop policy if exists "invoice_edit_requests_update" on public.invoice_edit_requests;
create policy "invoice_edit_requests_update"
on public.invoice_edit_requests for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

alter table public.invoice_payments enable row level security;
alter table public.invoice_edit_requests enable row level security;

drop policy if exists "stock_history_select_by_location" on public.stock_history;
create policy "stock_history_select_by_location"
on public.stock_history for select
to authenticated
using (public.can_access_location(location));

drop policy if exists "stock_history_insert_by_location" on public.stock_history;
create policy "stock_history_insert_by_location"
on public.stock_history for insert
to authenticated
with check ((select auth.uid()) = created_by and public.can_access_location(location));

drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin"
on public.audit_logs for select
to authenticated
using (public.is_admin());

drop policy if exists "audit_logs_insert_authenticated" on public.audit_logs;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, update on public.invoices to authenticated;
grant select, update, delete on public.invoice_items to authenticated;
grant select on public.stock_history to authenticated;
grant select on public.audit_logs to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.invoice_payments to authenticated;
grant select, insert, update on public.invoice_edit_requests to authenticated;
grant all on all tables in schema public to service_role;
revoke all on sequence public.invoice_number_seq from public, anon, authenticated;
revoke execute on function public.current_profile_role() from public;
revoke execute on function public.current_profile_location() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.can_access_location(public.branch_location) from public;
revoke execute on function public.complete_password_change() from public;
revoke execute on function public.generate_product_sku(text) from public;
revoke execute on function public.import_products(jsonb, text, text, integer, boolean) from public;
revoke execute on function public.generate_invoice_number() from public, anon, authenticated;
revoke execute on function public.create_invoice(text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text) from public;
revoke execute on function public.soft_delete_invoice(uuid) from public;
revoke execute on function public.soft_delete_invoice_no_stock(uuid) from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_location() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_location(public.branch_location) to authenticated;
grant execute on function public.complete_password_change() to authenticated;
grant execute on function public.generate_product_sku(text) to authenticated;
grant execute on function public.import_products(jsonb, text, text, integer, boolean) to authenticated;
grant execute on function public.log_audit(text, text) to authenticated;
grant execute on function public.create_invoice(text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text) to authenticated;
grant execute on function public.soft_delete_invoice(uuid) to authenticated;
grant execute on function public.soft_delete_invoice_no_stock(uuid) to authenticated;
grant select on public.sales_summary to authenticated;
grant select on public.outstanding_balances to authenticated;
grant select on public.product_sales_summary to authenticated;

-- create_invoice_no_stock / update_invoice_no_stock / record_login /
-- approve_invoice_request / reject_invoice_request are, on the live project,
-- also granted to `anon`/PUBLIC (Postgres's default for a newly created
-- SECURITY DEFINER function, never explicitly revoked here). Each function
-- still requires `auth.uid()` to resolve, which anon calls can't provide, so
-- this isn't currently exploitable — captured as-is (baseline sync) rather
-- than tightened, since that's a behavior change beyond "match live."
grant execute on function public.create_invoice_no_stock(text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric) to anon, authenticated;
grant execute on function public.update_invoice_no_stock(uuid, text, text, text, text, text, text, text, numeric, numeric, jsonb) to anon, authenticated;
grant execute on function public.record_login() to anon, authenticated;
grant execute on function public.record_partial_payment(uuid, numeric, text, text, text) to authenticated;
grant execute on function public.approve_invoice_request(uuid) to anon, authenticated;
grant execute on function public.reject_invoice_request(uuid, text) to anon, authenticated;

insert into public.products (name, sku, category, price, stock_alabar, stock_morocco, reorder_level)
values
  ('1.5l water jug 6027', 'LMD-15L-WATER-JUG-6027', 'General', 32, 0, 0, 5),
  ('116 strainer', 'LMD-116-STRAINER', 'General', 6.5, 0, 0, 5),
  ('116 strainer small', 'LMD-116-STRAINER-SMALL', 'General', 5.5, 0, 0, 5),
  ('116-1 strainer', 'LMD-116-1-STRAINER', 'General', 8.5, 0, 0, 5),
  ('11pcs measuring spoons', 'LMD-11PCS-MEASURING-SPOONS', 'General', 10, 0, 0, 5),
  ('12" oval plate ggk', 'LMD-12-OVAL-PLATE-GGK', 'General', 21, 0, 0, 5),
  ('133 Tablespoon', 'LMD-133-TABLESPOON', 'General', 8, 0, 0, 5),
  ('148 strainer', 'LMD-148-STRAINER', 'General', 9.5, 0, 0, 5),
  ('18cm metal sieve', 'LMD-18CM-METAL-SIEVE', 'General', 12.5, 0, 0, 5),
  ('20 pcs biscuit cutter', 'LMD-20-PCS-BISCUIT-CUTTER', 'General', 18, 0, 0, 5),
  ('20 pcs dinner set', 'LMD-20-PCS-DINNER-SET', 'General', 215, 0, 0, 5),
  ('22cm metal sieve', 'LMD-22CM-METAL-SIEVE', 'General', 15, 0, 0, 5),
  ('24*34 wooden board s/s', 'LMD-24-34-WOODEN-BOARD-S-S', 'General', 28, 0, 0, 5),
  ('24cm metal sieve', 'LMD-24CM-METAL-SIEVE', 'General', 16, 0, 0, 5),
  ('28*36 wooden board b/s', 'LMD-28-36-WOODEN-BOARD-B-S', 'General', 33, 0, 0, 5),
  ('3080cc', 'LMD-3080CC', 'General', 240, 0, 0, 5),
  ('3081cc', 'LMD-3081CC', 'General', 260, 0, 0, 5),
  ('30cm food cover', 'LMD-30CM-FOOD-COVER', 'General', 12, 0, 0, 5),
  ('34cm rose frying pan', 'LMD-34CM-ROSE-FRYING-PAN', 'General', 95, 0, 0, 5),
  ('35cm food cover', 'LMD-35CM-FOOD-COVER', 'General', 15, 0, 0, 5),
  ('36cm rose frying pan', 'LMD-36CM-ROSE-FRYING-PAN', 'General', 105, 0, 0, 5),
  ('3pcs measuring cup', 'LMD-3PCS-MEASURING-CUP', 'General', 19, 0, 0, 5),
  ('4 pcs cutlery ( colours)', 'LMD-4-PCS-CUTLERY-COLOURS', 'General', 8, 0, 0, 5),
  ('4 pcs cutlery (metal)', 'LMD-4-PCS-CUTLERY-METAL', 'General', 7, 0, 0, 5),
  ('4 pcs wooden spoon', 'LMD-4-PCS-WOODEN-SPOON', 'General', 8.5, 0, 0, 5),
  ('425-17 tray', 'LMD-425-17-TRAY', 'General', 22, 0, 0, 5),
  ('425-19 tray', 'LMD-425-19-TRAY', 'General', 30, 0, 0, 5),
  ('425-21 tray', 'LMD-425-21-TRAY', 'General', 35, 0, 0, 5),
  ('42cm plate rack', 'LMD-42CM-PLATE-RACK', 'General', 90, 0, 0, 5),
  ('5 pcs glass bowl', 'LMD-5-PCS-GLASS-BOWL', 'General', 28, 0, 0, 5),
  ('5 pcs pie cutters', 'LMD-5-PCS-PIE-CUTTERS', 'General', 24, 0, 0, 5),
  ('52cm plate rack', 'LMD-52CM-PLATE-RACK', 'General', 100, 0, 0, 5),
  ('5kg scale', 'LMD-5KG-SCALE', 'General', 32, 0, 0, 5),
  ('6 pcs ice cream glass', 'LMD-6-PCS-ICE-CREAM-GLASS', 'General', 32, 0, 0, 5),
  ('8 pcs cake decorating set', 'LMD-8-PCS-CAKE-DECORATING-SET', 'General', 15, 0, 0, 5),
  ('8" metal knife', 'LMD-8-METAL-KNIFE', 'General', 15.5, 0, 0, 5),
  ('9" metal knife', 'LMD-9-METAL-KNIFE', 'General', 16, 0, 0, 5),
  ('Butcher knife CG050', 'LMD-BUTCHER-KNIFE-CG050', 'General', 50, 0, 0, 5),
  ('Fruit basket', 'LMD-FRUIT-BASKET', 'General', 20, 0, 0, 5),
  ('Grater bowl s/s', 'LMD-GRATER-BOWL-S-S', 'General', 10, 0, 0, 5),
  ('Grater stand G41 b/s', 'LMD-GRATER-STAND-G41-B-S', 'General', 10, 0, 0, 5),
  ('Grater stand G41 s/s', 'LMD-GRATER-STAND-G41-S-S', 'General', 9, 0, 0, 5),
  ('Grater stand G61 b/s', 'LMD-GRATER-STAND-G61-B-S', 'General', 19, 0, 0, 5),
  ('Grater stand G61 sides s/s', 'LMD-GRATER-STAND-G61-SIDES-S-S', 'General', 17, 0, 0, 5),
  ('Grater stand plastic', 'LMD-GRATER-STAND-PLASTIC', 'General', 9, 0, 0, 5),
  ('HK-09 knife', 'LMD-HK-09-KNIFE', 'General', 14.5, 0, 0, 5),
  ('HK-10 knife', 'LMD-HK-10-KNIFE', 'General', 15, 0, 0, 5),
  ('JB 824 plate rack', 'LMD-JB-824-PLATE-RACK', 'General', 30, 0, 0, 5),
  ('K45 knife', 'LMD-K45-KNIFE', 'General', 8, 0, 0, 5),
  ('K46 knife', 'LMD-K46-KNIFE', 'General', 8.5, 0, 0, 5),
  ('Lunch box 4 set', 'LMD-LUNCH-BOX-4-SET', 'General', 100, 0, 0, 5),
  ('Mug M01', 'LMD-MUG-M01', 'General', 13, 0, 0, 5),
  ('Orange squeezer', 'LMD-ORANGE-SQUEEZER', 'General', 34, 0, 0, 5),
  ('Orgas abidjan', 'LMD-ORGAS-ABIDJAN', 'General', 14, 0, 0, 5),
  ('Palette knife', 'LMD-PALETTE-KNIFE', 'General', 11, 0, 0, 5),
  ('Palette knife (offset)', 'LMD-PALETTE-KNIFE-OFFSET', 'General', 11, 0, 0, 5),
  ('Roumezi knife s/s', 'LMD-ROUMEZI-KNIFE-S-S', 'General', 14.5, 0, 0, 5),
  ('Sinboss kettle 4L', 'LMD-SINBOSS-KETTLE-4L', 'General', 150, 0, 0, 5),
  ('Turner A01', 'LMD-TURNER-A01', 'General', 7.5, 0, 0, 5),
  ('Water jug 0.6l ( no box)', 'LMD-WATER-JUG-06L-NO-BOX', 'General', 15, 0, 0, 5),
  ('Water jug 1L', 'LMD-WATER-JUG-1L', 'General', 25, 0, 0, 5),
  ('bread knife ord', 'LMD-BREAD-KNIFE-ORD', 'General', 4.5, 0, 0, 5),
  ('ladle A01', 'LMD-LADLE-A01', 'General', 7.5, 0, 0, 5),
  ('ladle A03', 'LMD-LADLE-A03', 'General', 9, 0, 0, 5),
  ('mini knife with cover', 'LMD-MINI-KNIFE-WITH-COVER', 'General', 3, 0, 0, 5),
  ('plantain knife s/s', 'LMD-PLANTAIN-KNIFE-S-S', 'General', 7, 0, 0, 5),
  ('plastic board m/s', 'LMD-PLASTIC-BOARD-M-S', 'General', 23, 0, 0, 5),
  ('plastic board s/s', 'LMD-PLASTIC-BOARD-S-S', 'General', 15, 0, 0, 5)
on conflict (sku) do update
set name = excluded.name,
    category = excluded.category,
    price = excluded.price,
    reorder_level = excluded.reorder_level;

do $$
declare
  v_admin_id uuid;
  v_product_id uuid;
  v_invoice_id uuid := '2c1d4a7d-25f2-4d49-8d68-6f27dd0c6001';
  v_item_id uuid := '2c1d4a7d-25f2-4d49-8d68-6f27dd0c6002';
  v_audit_id uuid := '2c1d4a7d-25f2-4d49-8d68-6f27dd0c6003';
begin
  select id into v_admin_id
  from public.profiles
  where role = 'admin'
  order by created_at asc
  limit 1;

  select id into v_product_id
  from public.products
  where sku = 'LMD-15L-WATER-JUG-6027'
  limit 1;

  if v_admin_id is null or v_product_id is null then
    return;
  end if;

  insert into public.invoices (
    id,
    number,
    customer_name,
    customer_phone,
    customer_address,
    location,
    total,
    status,
    pay_method,
    momo_number,
    notes,
    created_by,
    deleted,
    created_at,
    updated_at
  )
  values (
    v_invoice_id,
    'SEED-000001',
    'RLS Smoke Test Customer',
    null,
    null,
    'Alabar',
    32,
    'paid',
    'cash',
    null,
    'Seeded for RLS smoke testing',
    v_admin_id,
    false,
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.invoice_items (
    id,
    invoice_id,
    product_id,
    name,
    qty,
    price
  )
  values (
    v_item_id,
    v_invoice_id,
    v_product_id,
    '1.5l water jug 6027',
    1,
    32
  )
  on conflict (id) do nothing;

  insert into public.audit_logs (
    id,
    action,
    detail,
    created_by,
    created_at
  )
  values (
    v_audit_id,
    'Seed Data Loaded',
    'Seeded one audit row and one invoice row for RLS smoke testing',
    v_admin_id,
    now()
  )
  on conflict (id) do nothing;
end $$;

-- Admin Profile Setup
-- Update admin email if admin profile already exists
update public.profiles
set email = 'admin@lumoda.org'
where username = 'admin';

-- Optional: If creating admin fresh, uncomment and customize with UUID from Supabase Auth Dashboard:
-- insert into public.profiles (id, username, full_name, role, location, active, email)
-- values (
--   'YOUR-ADMIN-UUID-FROM-AUTH',
--   'admin',
--   'System Administrator',
--   'admin',
--   'All',
--   true,
--   'admin@lumoda.org'
-- )
-- on conflict (id) do update
-- set username = excluded.username,
--     full_name = excluded.full_name,
--     role = excluded.role,
--     location = excluded.location,
--     active = excluded.active,
--     email = excluded.email;
