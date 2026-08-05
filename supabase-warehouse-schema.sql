-- LUMODA ENTERPRISE Warehouse schema
-- Run this separately after the core schema in supabase-schema.sql.
-- Dependencies: auth.users, public.audit_logs, and the core product/profile tables.
--
-- Baseline sync note: this file previously described a `warehouse_products`
-- shape (a `code` column, no stock tracking) and a `warehouse_movements`
-- shape (description required, no approval workflow) that no longer matches
-- what has been running live for some time. Rewritten below to match the
-- live project exactly, plus the tables/functions that existed live but were
-- never captured here at all (warehouse_stock_balance, warehouse_stock_journal,
-- post_warehouse_movement_direct, approve_warehouse_movement).

create table if not exists public.warehouse_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text,
  cartons integer not null default 0,
  reorder_level integer not null default 0,
  created_at timestamptz not null default now()
);

-- Legacy/unused: referenced only by warehouse_movements.supplier_id below,
-- which itself is not written to by any current code path (the app records
-- supplier as free text on the movement, and uses public.warehouse_suppliers
-- for the supplier directory). Kept only so that FK resolves; currently empty.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  contact_person text,
  notes text,
  created_at timestamptz default now()
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

-- product_id/quantity/supplier_id/branch_location/note are an earlier, no
-- longer written-to shape, superseded by the items/jsonb + status/approval
-- columns below. Kept (nullable) for backward compatibility with any old rows.
create table if not exists public.warehouse_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.warehouse_products(id) on delete cascade,
  type text not null check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment')),
  quantity integer,
  supplier_id uuid references public.suppliers(id),
  branch_location text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  status text default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  executed_at timestamptz,
  rejection_reason text,
  description text,
  cartons integer not null default 0 check (cartons >= 0),
  items jsonb not null default '[]'::jsonb,
  requisition_no text,
  issue_to text,
  storekeeper text,
  supplier text,
  notes text,
  created_by_name text
);

create table if not exists public.warehouse_requisitions (
  id uuid primary key default gen_random_uuid(),
  requisition_no text not null unique,
  issue_to text not null,
  storekeeper text not null,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.warehouse_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.warehouse_requisitions(id) on delete cascade,
  product_id uuid references public.warehouse_products(id),
  description text not null,
  cartons integer not null default 0 check (cartons >= 0),
  quantity_supplied integer not null default 0 check (quantity_supplied >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);

-- Server-authoritative stock ledger, keyed by item_code (not product_id — the
-- app matches on the free-text code/description it also stores on movements).
-- See WAREHOUSE_V2_PLAN.md for the design this implements.
create table if not exists public.warehouse_stock_balance (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_name text not null,
  total_cartons integer not null default 0 check (total_cartons >= 0),
  reserved_cartons integer not null default 0 check (reserved_cartons >= 0),
  available_cartons integer generated always as (total_cartons - reserved_cartons) stored,
  reorder_level integer not null default 10,
  last_movement_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Audit trail of every balance-affecting change, one row per item per
-- movement. Not currently written to by post_warehouse_movement_direct /
-- approve_warehouse_movement below (present live, unused so far) — kept here
-- so the table exists for when that's wired up, per WAREHOUSE_V2_PLAN.md.
create table if not exists public.warehouse_stock_journal (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid references public.warehouse_movements(id) on delete cascade,
  item_code text not null,
  item_name text not null,
  movement_type text not null check (movement_type in ('stock_in', 'stock_out', 'adjustment')),
  cartons_before integer not null,
  cartons_delta integer not null,
  cartons_after integer not null,
  balance_before integer not null,
  balance_after integer not null,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists warehouse_products_name_idx on public.warehouse_products(name);
create index if not exists warehouse_products_created_at_idx on public.warehouse_products(created_at desc);
create index if not exists warehouse_suppliers_created_at_idx on public.warehouse_suppliers(created_at desc);
create index if not exists warehouse_movements_created_at_idx on public.warehouse_movements(created_at desc);
create index if not exists warehouse_movements_type_idx on public.warehouse_movements(type);
create index if not exists warehouse_requisitions_created_at_idx on public.warehouse_requisitions(created_at desc);
create index if not exists warehouse_requisition_items_requisition_id_idx on public.warehouse_requisition_items(requisition_id);
create index if not exists warehouse_stock_balance_item_code_idx on public.warehouse_stock_balance(item_code);
create index if not exists warehouse_stock_balance_updated_at_idx on public.warehouse_stock_balance(updated_at desc);
create index if not exists warehouse_stock_journal_movement_id_idx on public.warehouse_stock_journal(movement_id);
create index if not exists warehouse_stock_journal_item_code_idx on public.warehouse_stock_journal(item_code);
create index if not exists warehouse_stock_journal_created_at_idx on public.warehouse_stock_journal(created_at desc);

-- Records a stock movement server-side: validates role, validates available
-- balance before a stock_out (row-locked to prevent a double-oversell race),
-- and inserts/updates warehouse_stock_balance. stock_in/opening_balance/
-- adjustment post immediately (status 'executed'); stock_out is left
-- 'pending' — cartons are reserved, not yet deducted — until an admin calls
-- approve_warehouse_movement below.
create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  insert into public.warehouse_movements (
    type, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    case when p_type in ('stock_in', 'opening_balance', 'adjustment') then 'executed' else 'pending' end,
    case when p_type in ('stock_in', 'opening_balance', 'adjustment') then now() else null end
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      update public.warehouse_stock_balance
      set reserved_cartons = reserved_cartons + v_cartons,
          updated_at = now()
      where item_code = v_item_code;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

-- Admin-only. Finalizes a pending stock_out: on approval, deducts the
-- reserved cartons from total_cartons; on rejection, releases the reservation
-- without touching total_cartons.
create or replace function public.approve_warehouse_movement(
  p_movement_id uuid,
  p_approved boolean default true,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_movement record;
  v_item jsonb;
  v_item_code text;
  v_cartons integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'admin' and active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Only admin can approve');
  end if;

  select * into v_movement
  from public.warehouse_movements
  where id = p_movement_id
  for update;

  if v_movement.id is null then
    return jsonb_build_object('success', false, 'error', 'Movement not found');
  end if;

  if v_movement.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'This movement was already ' || v_movement.status);
  end if;

  if p_approved = true then
    update public.warehouse_movements
    set status = 'executed', approved_by = v_user_id, approved_at = now(), executed_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set total_cartons = total_cartons - v_cartons,
            reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where item_code = v_item_code;
      end loop;
    end if;
  else
    update public.warehouse_movements
    set status = 'rejected', rejection_reason = p_rejection_reason, approved_by = v_user_id, approved_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where item_code = v_item_code;
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

alter table public.warehouse_products enable row level security;
alter table public.warehouse_suppliers enable row level security;
alter table public.warehouse_movements enable row level security;
alter table public.warehouse_requisitions enable row level security;
alter table public.warehouse_requisition_items enable row level security;
alter table public.warehouse_stock_balance enable row level security;
alter table public.warehouse_stock_journal enable row level security;

-- Baseline sync note: every policy below is currently `true` on the live
-- project — i.e. there is no real row-level access control on warehouse data
-- today, only frontend menu-hiding (any authenticated user can read/write
-- these tables directly via the API). Captured as-is here because that's
-- what's actually live; Milestone 1 of the multi-warehouse migration
-- replaces these with real per-warehouse checks.
-- Read/add/edit stay open to any authenticated staff (the catalog is
-- shared across every warehouse); delete is admin-only.
drop policy if exists "warehouse_products_all" on public.warehouse_products;
drop policy if exists "warehouse_products_select" on public.warehouse_products;
create policy "warehouse_products_select" on public.warehouse_products for select to authenticated using (true);
drop policy if exists "warehouse_products_insert" on public.warehouse_products;
create policy "warehouse_products_insert" on public.warehouse_products for insert to authenticated with check (true);
drop policy if exists "warehouse_products_update" on public.warehouse_products;
create policy "warehouse_products_update" on public.warehouse_products for update to authenticated using (true) with check (true);
drop policy if exists "warehouse_products_delete" on public.warehouse_products;
create policy "warehouse_products_delete" on public.warehouse_products for delete to authenticated using (public.is_admin());

drop policy if exists "warehouse_suppliers_all" on public.warehouse_suppliers;
create policy "warehouse_suppliers_all" on public.warehouse_suppliers for all to authenticated using (true) with check (true);

drop policy if exists "warehouse_movements_select" on public.warehouse_movements;
create policy "warehouse_movements_select" on public.warehouse_movements for select to authenticated using (true);
drop policy if exists "warehouse_movements_insert" on public.warehouse_movements;
create policy "warehouse_movements_insert" on public.warehouse_movements for insert to authenticated with check (true);
drop policy if exists "warehouse_movements_update" on public.warehouse_movements;
create policy "warehouse_movements_update" on public.warehouse_movements for update to authenticated using (true) with check (true);
drop policy if exists "warehouse_movements_delete" on public.warehouse_movements;
create policy "warehouse_movements_delete" on public.warehouse_movements for delete to authenticated using (true);

drop policy if exists "warehouse_requisitions_all" on public.warehouse_requisitions;
create policy "warehouse_requisitions_all" on public.warehouse_requisitions for all to authenticated using (true) with check (true);

drop policy if exists "warehouse_requisition_items_all" on public.warehouse_requisition_items;
create policy "warehouse_requisition_items_all" on public.warehouse_requisition_items for all to authenticated using (true) with check (true);

drop policy if exists "warehouse_stock_balance_select" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_select" on public.warehouse_stock_balance for select to authenticated using (true);
drop policy if exists "warehouse_stock_balance_insert" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_insert" on public.warehouse_stock_balance for insert to authenticated with check (true);
drop policy if exists "warehouse_stock_balance_update" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_update" on public.warehouse_stock_balance for update to authenticated using (true) with check (true);

drop policy if exists "warehouse_stock_journal_all" on public.warehouse_stock_journal;
create policy "warehouse_stock_journal_all" on public.warehouse_stock_journal for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.warehouse_products to authenticated;
grant select, insert, update, delete on public.warehouse_suppliers to authenticated;
grant select, insert, update, delete on public.warehouse_movements to authenticated;
grant select, insert, update, delete on public.warehouse_requisitions to authenticated;
grant select, insert, update, delete on public.warehouse_requisition_items to authenticated;
grant select, insert, update on public.warehouse_stock_balance to authenticated;
grant select, insert, update, delete on public.warehouse_stock_journal to authenticated;
grant select on public.suppliers to authenticated;

grant execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.approve_warehouse_movement(uuid, boolean, text) to anon, authenticated;

-- ============================================================
-- Multi-warehouse (Milestone 1) — applied via
-- supabase/migrations/20260802174352_multi_warehouse_m1.sql
-- ============================================================

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists warehouses_touch_updated_at on public.warehouses;
create trigger warehouses_touch_updated_at before update on public.warehouses
for each row execute function public.touch_updated_at();

create table if not exists public.warehouse_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, warehouse_id)
);

alter table public.warehouse_stock_balance add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_requisitions add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_stock_journal add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements add column if not exists to_warehouse_id uuid references public.warehouses(id);

alter table public.warehouse_movements drop constraint if exists warehouse_movements_type_check;
alter table public.warehouse_movements add constraint warehouse_movements_type_check
  check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment', 'transfer'));

-- On a fresh environment these NOT NULL/unique changes apply immediately
-- since there's no pre-existing data to backfill first; on the live project
-- this was done as backfill-then-tighten (see the migration file above).
alter table public.warehouse_stock_balance alter column warehouse_id set not null;
alter table public.warehouse_movements alter column warehouse_id set not null;
alter table public.warehouse_requisitions alter column warehouse_id set not null;
alter table public.warehouse_stock_journal alter column warehouse_id set not null;

alter table public.warehouse_stock_balance drop constraint if exists warehouse_stock_balance_item_code_key;
alter table public.warehouse_stock_balance add constraint warehouse_stock_balance_warehouse_item_key unique (warehouse_id, item_code);

create index if not exists warehouse_stock_balance_warehouse_id_idx on public.warehouse_stock_balance(warehouse_id);
create index if not exists warehouse_movements_warehouse_id_idx on public.warehouse_movements(warehouse_id);
create index if not exists warehouse_requisitions_warehouse_id_idx on public.warehouse_requisitions(warehouse_id);
create index if not exists warehouse_stock_journal_warehouse_id_idx on public.warehouse_stock_journal(warehouse_id);

create or replace function public.can_access_warehouse(target_warehouse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_admin()
    or exists (
      select 1 from public.warehouse_staff_assignments wsa
      where wsa.warehouse_id = target_warehouse_id
        and wsa.profile_id = (select auth.uid())
    ),
    false
  )
$$;

revoke execute on function public.can_access_warehouse(uuid) from public;
grant execute on function public.can_access_warehouse(uuid) to authenticated;

alter table public.warehouses enable row level security;
alter table public.warehouse_staff_assignments enable row level security;

drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select to authenticated
  using (public.is_admin() or public.can_access_warehouse(id));
drop policy if exists "warehouses_admin_write" on public.warehouses;
create policy "warehouses_admin_write" on public.warehouses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "warehouse_staff_assignments_select" on public.warehouse_staff_assignments;
create policy "warehouse_staff_assignments_select" on public.warehouse_staff_assignments for select to authenticated
  using (public.is_admin() or profile_id = (select auth.uid()));
drop policy if exists "warehouse_staff_assignments_admin_write" on public.warehouse_staff_assignments;
create policy "warehouse_staff_assignments_admin_write" on public.warehouse_staff_assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Replaces the wide-open `true` policies above for these four tables now
-- that warehouse_id exists — real per-warehouse access control.
drop policy if exists "warehouse_stock_balance_select" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_select" on public.warehouse_stock_balance for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_stock_balance_insert" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_insert" on public.warehouse_stock_balance for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_stock_balance_update" on public.warehouse_stock_balance;
create policy "warehouse_stock_balance_update" on public.warehouse_stock_balance for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));

drop policy if exists "warehouse_movements_select" on public.warehouse_movements;
create policy "warehouse_movements_select" on public.warehouse_movements for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_insert" on public.warehouse_movements;
create policy "warehouse_movements_insert" on public.warehouse_movements for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_update" on public.warehouse_movements;
create policy "warehouse_movements_update" on public.warehouse_movements for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));
drop policy if exists "warehouse_movements_delete" on public.warehouse_movements;
create policy "warehouse_movements_delete" on public.warehouse_movements for delete to authenticated
  using (public.is_admin());

drop policy if exists "warehouse_requisitions_all" on public.warehouse_requisitions;
create policy "warehouse_requisitions_select" on public.warehouse_requisitions for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
create policy "warehouse_requisitions_insert" on public.warehouse_requisitions for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));
create policy "warehouse_requisitions_update" on public.warehouse_requisitions for update to authenticated
  using (public.can_access_warehouse(warehouse_id)) with check (public.can_access_warehouse(warehouse_id));

drop policy if exists "warehouse_stock_journal_all" on public.warehouse_stock_journal;
create policy "warehouse_stock_journal_select" on public.warehouse_stock_journal for select to authenticated
  using (public.can_access_warehouse(warehouse_id));
create policy "warehouse_stock_journal_insert" on public.warehouse_stock_journal for insert to authenticated
  with check (public.can_access_warehouse(warehouse_id));

-- warehouse_products/warehouse_suppliers deliberately stay on their existing
-- `true` policies — the product catalog is shared/global across all
-- warehouses, per the client's explicit requirement.

grant select, insert, update on public.warehouses to authenticated;
grant select on public.warehouse_staff_assignments to authenticated;

-- Replaces the post_warehouse_movement_direct definition earlier in this
-- file — same logic, now warehouse-scoped. p_warehouse_id defaults to null
-- and is resolved to the "MAIN" warehouse inside the function body (Postgres
-- doesn't allow a subquery in a parameter DEFAULT), so callers that don't
-- pass it yet keep working.
create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null,
  p_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if p_warehouse_id is null then
    select id into p_warehouse_id from public.warehouses where code = 'MAIN';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_warehouse_id is null or not public.can_access_warehouse(p_warehouse_id) then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this warehouse');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where warehouse_id = p_warehouse_id and item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  -- Every movement type auto-executes immediately — Stock Out used to be
  -- saved as 'pending' expecting a separate approval step, but nothing in
  -- the frontend ever called approve_warehouse_movement, so Stock Out was
  -- permanently stuck pending and totals never actually decreased. Since
  -- the admin isn't always reachable to approve in real time, the fix is
  -- to remove the gate rather than build a UI around it — the balance
  -- check above still blocks overselling, and the audit trail (who did
  -- what, when) covers accountability instead of a real-time approval.
  insert into public.warehouse_movements (
    type, warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    'executed', now()
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type = 'stock_out' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      -- Deduct straight from total_cartons now that this executes
      -- immediately (previously only touched reserved_cartons, which is
      -- why totals never reflected stock that had actually left).
      update public.warehouse_stock_balance
      set total_cartons = total_cartons - v_cartons,
          last_movement_at = now(),
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

revoke execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) to authenticated;

-- Replaces approve_warehouse_movement earlier in this file — signature is
-- unchanged (it reads warehouse_id off the movement row it's approving), but
-- its stock_out balance update is now warehouse-scoped.
create or replace function public.approve_warehouse_movement(
  p_movement_id uuid,
  p_approved boolean default true,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_movement record;
  v_item jsonb;
  v_item_code text;
  v_cartons integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'admin' and active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Only admin can approve');
  end if;

  select * into v_movement
  from public.warehouse_movements
  where id = p_movement_id
  for update;

  if v_movement.id is null then
    return jsonb_build_object('success', false, 'error', 'Movement not found');
  end if;

  if v_movement.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'This movement was already ' || v_movement.status);
  end if;

  if p_approved = true then
    update public.warehouse_movements
    set status = 'executed', approved_by = v_user_id, approved_at = now(), executed_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set total_cartons = total_cartons - v_cartons,
            reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where warehouse_id = v_movement.warehouse_id and item_code = v_item_code;
      end loop;
    end if;
  else
    update public.warehouse_movements
    set status = 'rejected', rejection_reason = p_rejection_reason, approved_by = v_user_id, approved_at = now()
    where id = p_movement_id;

    if v_movement.type = 'stock_out' then
      for v_item in select * from jsonb_array_elements(v_movement.items)
      loop
        v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
        v_cartons := coalesce((v_item->>'cartons')::integer, 0);

        update public.warehouse_stock_balance
        set reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
        where warehouse_id = v_movement.warehouse_id and item_code = v_item_code;
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ============================================================
-- 20260805100000 / 20260805101500 / 20260805103000 — supplier UI backend
-- fixes, dead approval-flow removal, and warehouse-to-warehouse transfers.
-- ============================================================

-- approve_warehouse_movement (defined above) was the other half of the
-- "pending approval" flow that the auto-execute change above already
-- disabled. Nothing in the frontend calls this RPC, and no movement can be
-- left in a state it would ever act on — every insert path sets
-- status = 'executed' directly (confirmed live: zero pending/rejected rows
-- exist). Dropped outright.
drop function if exists public.approve_warehouse_movement(uuid, boolean, text);

-- Also discovered live at this point: a THIRD copy of
-- post_warehouse_movement_direct had survived from before multi-warehouse
-- support — a 10-arg version with no p_warehouse_id and no
-- can_access_warehouse() check at all, using the original pending-approval /
-- reserved_cartons-only stock_out logic. It was never cleaned up when the
-- 11-arg version was introduced (that migration used CREATE OR REPLACE
-- without first dropping the old signature — the exact overload trap called
-- out below). The live app never called it (supabase-client.js always sends
-- p_warehouse_id), but it was reachable by anyone calling the RPC directly,
-- bypassing per-warehouse authorization entirely. Dropped.
drop function if exists public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text
);

-- Wires up the `transfer` movement type and `to_warehouse_id` column added
-- (but never used) in the multi-warehouse migration — moves stock between
-- two warehouses in a single transaction/movement row instead of a manual
-- stock_out + stock_in pair. Permission model mirrors stock_out: only the
-- SOURCE warehouse requires can_access_warehouse() — destination access is
-- deliberately not required, same as how Stock In already lets a manager
-- receive goods without a destination-specific gate. Stays auto-executing,
-- like every other movement type, because the admin is frequently
-- unreachable.
--
-- Must drop the 11-arg signature explicitly before creating the new 12-arg
-- one — CREATE OR REPLACE only replaces a function whose parameter *types*
-- match exactly; adding a trailing parameter would otherwise create a
-- second overload (the same trap the stray 10-arg function above came
-- from), and PostgREST would fail to pick an overload on any call that
-- omits p_to_warehouse_id.
drop function if exists public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid
);

create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text default null,
  p_cartons integer default 0,
  p_items jsonb default '[]'::jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null,
  p_warehouse_id uuid default null,
  p_to_warehouse_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_role public.user_role;
  v_movement_id uuid;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_available integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  if p_warehouse_id is null then
    select id into p_warehouse_id from public.warehouses where code = 'MAIN';
  end if;

  select role into v_role
  from public.profiles
  where id = v_user_id and active = true;

  if v_role is null then
    return jsonb_build_object('success', false, 'error', 'Active profile not found');
  end if;

  if v_role not in ('admin', 'warehouse_manager') then
    return jsonb_build_object('success', false, 'error', 'Not authorized to record warehouse movements');
  end if;

  if p_warehouse_id is null or not public.can_access_warehouse(p_warehouse_id) then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this warehouse');
  end if;

  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment', 'transfer') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  if p_type <> 'transfer' then
    p_to_warehouse_id := null; -- ignore a stray value on non-transfer calls
  end if;

  if p_type = 'transfer' then
    if p_to_warehouse_id is null then
      return jsonb_build_object('success', false, 'error', 'Destination warehouse is required');
    end if;
    if p_to_warehouse_id = p_warehouse_id then
      return jsonb_build_object('success', false, 'error', 'Source and destination warehouse must be different');
    end if;
    if not exists (select 1 from public.warehouses where id = p_to_warehouse_id and active = true) then
      return jsonb_build_object('success', false, 'error', 'Destination warehouse not found or inactive');
    end if;
  end if;

  if p_type in ('stock_out', 'transfer') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      select coalesce(available_cartons, 0)
      into v_available
      from public.warehouse_stock_balance
      where warehouse_id = p_warehouse_id and item_code = v_item_code
      for update;

      if v_available < v_cartons then
        return jsonb_build_object(
          'success', false,
          'error', 'Insufficient stock for ' || v_item_code
        );
      end if;
    end loop;
  end if;

  insert into public.warehouse_movements (
    type, warehouse_id, to_warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_to_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
    p_cartons, p_notes, p_items, v_user_id, p_created_by_name,
    'executed', now()
  )
  returning id into v_movement_id;

  if p_type in ('stock_in', 'opening_balance', 'adjustment') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  if p_type in ('stock_out', 'transfer') then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      update public.warehouse_stock_balance
      set total_cartons = total_cartons - v_cartons,
          last_movement_at = now(),
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  if p_type = 'transfer' then
    for v_item in select * from jsonb_array_elements(p_items)
    loop
      v_item_code := coalesce(v_item->>'itemCode', v_item->>'code');
      v_item_name := coalesce(v_item->>'description', v_item->>'name');
      v_cartons := coalesce((v_item->>'cartons')::integer, 0);

      insert into public.warehouse_stock_balance (
        warehouse_id, item_code, item_name, total_cartons, reserved_cartons, last_movement_at, updated_at
      )
      values (p_to_warehouse_id, v_item_code, v_item_name, v_cartons, 0, now(), now())
      on conflict (warehouse_id, item_code)
      do update set
        item_name = excluded.item_name,
        total_cartons = public.warehouse_stock_balance.total_cartons + excluded.total_cartons,
        last_movement_at = now(),
        updated_at = now();
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

revoke execute on function public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid, uuid
) from public, anon;
grant execute on function public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text, uuid, uuid
) to authenticated;

-- warehouses is a small shared directory (id/code/name/address/active), not
-- sensitive stock or staff data — that stays properly gated by
-- can_access_warehouse() on warehouse_stock_balance/warehouse_movements/etc.
-- A warehouse_manager needs to see every warehouse's name to pick a transfer
-- destination they don't otherwise have access to (deliberate — see above),
-- so the previous can_access_warehouse()-gated select policy (defined
-- earlier in this file) is too narrow. Mirrors the existing shared-catalog
-- model already used for warehouse_products/warehouse_suppliers.
drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select to authenticated using (true);
-- warehouses_admin_write (insert/update/delete), defined earlier in this
-- file, is unchanged — admin-only.

-- ============================================================
-- 20260805110000 / 20260805113000 — codebase-review fixes: close the
-- warehouse_products/warehouse_suppliers write-access gap, and link the
-- product/warehouse catalogs.
-- ============================================================

-- warehouse_products/warehouse_suppliers insert/update (and suppliers'
-- delete) were `using (true)` — any authenticated staff account, including
-- a plain branch cashier with zero warehouse involvement, could write to
-- the shared warehouse catalog directly. Read stays open (harmless, shared
-- catalog); writes now require admin or warehouse_manager.
drop policy if exists "warehouse_products_insert" on public.warehouse_products;
create policy "warehouse_products_insert" on public.warehouse_products for insert to authenticated
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));

drop policy if exists "warehouse_products_update" on public.warehouse_products;
create policy "warehouse_products_update" on public.warehouse_products for update to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'))
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));

drop policy if exists "warehouse_suppliers_all" on public.warehouse_suppliers;
create policy "warehouse_suppliers_select" on public.warehouse_suppliers for select to authenticated using (true);
create policy "warehouse_suppliers_insert" on public.warehouse_suppliers for insert to authenticated
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));
create policy "warehouse_suppliers_update" on public.warehouse_suppliers for update to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'))
  with check (public.current_profile_role() in ('admin', 'warehouse_manager'));
create policy "warehouse_suppliers_delete" on public.warehouse_suppliers for delete to authenticated
  using (public.current_profile_role() in ('admin', 'warehouse_manager'));

-- Products and warehouse items were two fully independent catalogs — 310
-- warehouse items, 417 branch products, zero matching SKUs, even though
-- many represent the same real product under a different code. Going
-- forward, this trigger keeps warehouse_products in sync automatically,
-- one direction only (products -> warehouse): a product row requires a
-- price, which a warehouse-only item may not have yet, so auto-creating a
-- full sellable product from a warehouse-side add isn't safe to automate.
create or replace function public.sync_product_to_warehouse_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sku is null or trim(new.sku) = '' then
    return new;
  end if;

  insert into public.warehouse_products (sku, name, category, reorder_level)
  values (new.sku, new.name, coalesce(new.category, 'General'), coalesce(new.reorder_level, 10))
  on conflict (sku) do update set
    name = excluded.name,
    category = excluded.category,
    reorder_level = excluded.reorder_level;

  return new;
end;
$$;

drop trigger if exists products_sync_warehouse_catalog on public.products;
create trigger products_sync_warehouse_catalog
  after insert or update of name, sku, category, reorder_level on public.products
  for each row execute function public.sync_product_to_warehouse_catalog();

-- Existing mismatch: reconciled via the app's "Link to Warehouse Catalog"
-- screen (admin-only, Products page), which proposes name-matched pairs for
-- a human to confirm or skip. link_catalog_item() is what a confirmed pair
-- calls: the warehouse item takes on the product's sku/name/category/
-- reorder_level (product is canonical going forward), and every existing
-- warehouse_stock_balance row (in every warehouse) keyed to the item's OLD
-- sku is renamed to the new shared sku, so live stock tracking doesn't
-- silently disconnect from the catalog entry it belongs to. Historical
-- warehouse_movements rows are left untouched (point-in-time snapshots,
-- same as invoice line items already snapshot product names/prices).
create or replace function public.link_catalog_item(
  p_product_id uuid,
  p_warehouse_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_wh_product public.warehouse_products%rowtype;
  v_old_sku text;
begin
  if not public.is_admin() then
    raise exception 'Only admin can link catalog items';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  if v_product.sku is null or trim(v_product.sku) = '' then
    raise exception 'This product has no SKU to link with';
  end if;

  select * into v_wh_product from public.warehouse_products where id = p_warehouse_product_id for update;
  if not found then raise exception 'Warehouse item not found'; end if;

  v_old_sku := v_wh_product.sku;

  update public.warehouse_products
  set sku = v_product.sku,
      name = v_product.name,
      category = coalesce(v_product.category, 'General'),
      reorder_level = coalesce(v_product.reorder_level, reorder_level)
  where id = p_warehouse_product_id;

  if v_old_sku is not null and v_old_sku <> v_product.sku then
    update public.warehouse_stock_balance
    set item_code = v_product.sku,
        item_name = v_product.name,
        updated_at = now()
    where item_code = v_old_sku;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- Bulk "create the rest" step in the reconciliation screen — creates a
-- warehouse catalog entry for every product that still doesn't have one
-- after the manual review pass.
create or replace function public.backfill_warehouse_catalog_from_products()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admin can backfill the warehouse catalog';
  end if;

  with missing as (
    select p.sku, p.name, p.category, p.reorder_level
    from public.products p
    where p.sku is not null and trim(p.sku) <> ''
      and not exists (
        select 1 from public.warehouse_products wp where wp.sku = p.sku
      )
  )
  insert into public.warehouse_products (sku, name, category, reorder_level)
  select sku, name, coalesce(category, 'General'), coalesce(reorder_level, 10) from missing;

  get diagnostics v_count = row_count;

  return jsonb_build_object('success', true, 'created', v_count);
end;
$$;

revoke execute on function public.link_catalog_item(uuid, uuid) from public, anon;
grant execute on function public.link_catalog_item(uuid, uuid) to authenticated;
revoke execute on function public.backfill_warehouse_catalog_from_products() from public, anon;
grant execute on function public.backfill_warehouse_catalog_from_products() to authenticated;
