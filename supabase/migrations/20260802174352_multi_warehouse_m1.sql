-- Milestone 1: multi-warehouse infrastructure
--
-- Non-destructive: every column is added nullable first, backfilled to a
-- single "Main Warehouse" representing all of today's existing warehouse
-- data, then tightened to NOT NULL. Nothing existing is deleted or renamed.
-- The 4 additional warehouses are intentionally NOT created here — only the
-- infrastructure to add them (via the new admin "Warehouses" page) once real
-- names/locations are provided.
--
-- Backward compatibility: post_warehouse_movement_direct's new p_warehouse_id
-- parameter defaults to Main Warehouse, so the *currently deployed* frontend
-- (which doesn't send it yet) keeps working exactly as before until the
-- updated app/warehouse.js is deployed alongside this migration.

-- 1. Warehouses
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

insert into public.warehouses (code, name, address, active)
values ('MAIN', 'Main Warehouse', null, true)
on conflict (code) do nothing;

-- 2. Staff <-> warehouse assignment (many-to-many; admins implicitly have
-- access to every warehouse via can_access_warehouse() below, so they don't
-- need rows here)
create table if not exists public.warehouse_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, warehouse_id)
);

-- Assign every current admin/warehouse_manager to Main Warehouse so nobody
-- who could act on warehouse data yesterday is locked out today.
insert into public.warehouse_staff_assignments (profile_id, warehouse_id)
select p.id, w.id
from public.profiles p, public.warehouses w
where p.role in ('admin', 'warehouse_manager') and w.code = 'MAIN'
on conflict (profile_id, warehouse_id) do nothing;

-- 3. warehouse_id on every existing warehouse table (nullable first)
alter table public.warehouse_stock_balance add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_requisitions add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_stock_journal add column if not exists warehouse_id uuid references public.warehouses(id);

-- Optional inter-warehouse transfer support (design-now, build-later — see
-- WAREHOUSE_V2_PLAN.md-style approach): a stock_out can either go to
-- to_warehouse_id (internal transfer) or, from Milestone 2 on, to a retail
-- branch via destination_location. Not exercised by any code path yet.
alter table public.warehouse_movements add column if not exists to_warehouse_id uuid references public.warehouses(id);
alter table public.warehouse_movements drop constraint if exists warehouse_movements_type_check;
alter table public.warehouse_movements add constraint warehouse_movements_type_check
  check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment', 'transfer'));

-- 4. Backfill: every existing row belongs to Main Warehouse
update public.warehouse_stock_balance set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;
update public.warehouse_movements set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;
update public.warehouse_requisitions set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;
update public.warehouse_stock_journal set warehouse_id = (select id from public.warehouses where code = 'MAIN') where warehouse_id is null;

-- 5. Tighten to NOT NULL now that every row has a value
alter table public.warehouse_stock_balance alter column warehouse_id set not null;
alter table public.warehouse_movements alter column warehouse_id set not null;
alter table public.warehouse_requisitions alter column warehouse_id set not null;
alter table public.warehouse_stock_journal alter column warehouse_id set not null;

-- 6. Uniqueness moves from item_code alone to (warehouse_id, item_code) —
-- this is the change that actually makes stock per-warehouse instead of global.
alter table public.warehouse_stock_balance drop constraint if exists warehouse_stock_balance_item_code_key;
alter table public.warehouse_stock_balance add constraint warehouse_stock_balance_warehouse_item_key unique (warehouse_id, item_code);

create index if not exists warehouse_stock_balance_warehouse_id_idx on public.warehouse_stock_balance(warehouse_id);
create index if not exists warehouse_movements_warehouse_id_idx on public.warehouse_movements(warehouse_id);
create index if not exists warehouse_requisitions_warehouse_id_idx on public.warehouse_requisitions(warehouse_id);
create index if not exists warehouse_stock_journal_warehouse_id_idx on public.warehouse_stock_journal(warehouse_id);

-- 7. Access control: same shape as the existing can_access_location()
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

-- 8. Replace the wide-open `true` policies with real per-warehouse checks
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

-- warehouse_products/warehouse_suppliers stay global (shared catalog, per
-- the client's explicit "items should be the same across all 5 warehouses"
-- requirement) — left on their existing `true` policies deliberately, not
-- an oversight.

grant select, insert, update on public.warehouses to authenticated;
grant select on public.warehouse_staff_assignments to authenticated;

-- 9. Make the two movement functions warehouse-aware.
-- p_warehouse_id defaults to null and is resolved to Main Warehouse inside
-- the function body (Postgres doesn't allow a subquery in a parameter
-- DEFAULT expression) — so the currently-deployed frontend, which doesn't
-- send it yet, keeps working unchanged until app/warehouse.js is redeployed
-- with the warehouse selector.
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

  -- Backward compatibility: the currently-deployed frontend doesn't send
  -- p_warehouse_id yet — resolve it to Main Warehouse rather than requiring
  -- every caller to be updated in lockstep with this migration.
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

  insert into public.warehouse_movements (
    type, warehouse_id, requisition_no, issue_to, storekeeper, supplier, description,
    cartons, notes, items, created_by, created_by_name, status, executed_at
  )
  values (
    p_type, p_warehouse_id, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description,
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

      update public.warehouse_stock_balance
      set reserved_cartons = reserved_cartons + v_cartons,
          updated_at = now()
      where warehouse_id = p_warehouse_id and item_code = v_item_code;
    end loop;
  end if;

  return jsonb_build_object('success', true, 'movement_id', v_movement_id);
end;
$$;

revoke execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.post_warehouse_movement_direct(text, text, integer, jsonb, text, text, text, text, text, text, uuid) to authenticated;

-- approve_warehouse_movement doesn't need a new parameter — it already reads
-- the movement's own row (which now carries warehouse_id), so scoping its
-- balance update by warehouse_id is enough; the signature is unchanged, so
-- this is a pure behind-the-scenes fix, nothing to coordinate with the frontend.
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
