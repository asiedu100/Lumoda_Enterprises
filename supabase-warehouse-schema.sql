-- LUMODA ENTERPRISE Warehouse schema
-- Run this separately after the core schema in supabase-schema.sql.
-- Dependencies: auth.users, public.audit_logs, and the core product/profile tables.

create table if not exists public.warehouse_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default 'General',
  reorder_level integer not null default 5 check (reorder_level >= 0),
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouse_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  location text,
  notes text,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouse_movements (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment')),
  requisition_no text,
  issue_to text,
  storekeeper text,
  supplier text,
  description text not null,
  cartons integer not null default 0 check (cartons >= 0),
  notes text,
  items jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.warehouse_requisitions (
  id uuid primary key default gen_random_uuid(),
  requisition_no text not null unique,
  issue_to text not null,
  storekeeper text not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.warehouse_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.warehouse_requisitions(id) on delete cascade,
  item_code text,
  description text not null,
  cartons integer not null default 0 check (cartons >= 0),
  quantity_supplied integer not null default 0 check (quantity_supplied >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists warehouse_products_name_idx on public.warehouse_products(name);
create index if not exists warehouse_products_created_at_idx on public.warehouse_products(created_at desc);
create index if not exists warehouse_suppliers_created_at_idx on public.warehouse_suppliers(created_at desc);
create index if not exists warehouse_movements_created_at_idx on public.warehouse_movements(created_at desc);
create index if not exists warehouse_movements_type_idx on public.warehouse_movements(type);
create index if not exists warehouse_requisitions_created_at_idx on public.warehouse_requisitions(created_at desc);
create index if not exists warehouse_requisition_items_requisition_id_idx on public.warehouse_requisition_items(requisition_id);
