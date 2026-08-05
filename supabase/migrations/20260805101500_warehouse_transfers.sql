-- Warehouse-to-warehouse transfers: wires up the `transfer` movement type and
-- `to_warehouse_id` column added (but never used) in
-- 20260802174352_multi_warehouse_m1.sql. One call moves stock between two
-- warehouses in a single transaction/movement row instead of a manual
-- stock_out + stock_in pair (which would create two audit entries and a
-- window where the stock is "in neither warehouse").
--
-- Permission model mirrors stock_out: only the SOURCE warehouse requires
-- can_access_warehouse() (unchanged from the existing p_warehouse_id check)
-- — destination access is deliberately NOT required, same as how Stock In
-- already lets a manager receive goods without a destination-specific gate.
-- Stays auto-executing with no approval step, like every other movement
-- type, because the admin is frequently unreachable.
begin;

-- Must drop the old 11-arg signature explicitly before creating the new
-- 12-arg one — CREATE OR REPLACE only replaces a function whose parameter
-- *types* match exactly. Adding a trailing parameter would otherwise create
-- a second overload, and PostgREST would fail with "could not choose the
-- best candidate function" on every call that omits p_to_warehouse_id (i.e.
-- every existing stock_in/stock_out/opening_balance/adjustment call), since
-- both overloads would match.
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

  -- Every movement type auto-executes immediately — see comment above.
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
-- destination they don't otherwise have access to (deliberate — see comment
-- above), so the previous can_access_warehouse()-gated select policy is too
-- narrow. Mirrors the existing shared-catalog model already used for
-- warehouse_products/warehouse_suppliers.
drop policy if exists "warehouses_select" on public.warehouses;
create policy "warehouses_select" on public.warehouses for select to authenticated using (true);
-- Admin-only write policy on warehouses (insert/update/delete) is unchanged.

commit;
