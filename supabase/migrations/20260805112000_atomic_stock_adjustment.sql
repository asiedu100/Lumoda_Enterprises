-- applyStockAdjustment() (app/js/products.js) used to read the cached stock
-- value, compute a new absolute number client-side, and write it back via a
-- plain upsert (saveProduct) plus a separate fire-and-forget stock_history
-- insert — two concurrent adjustments could both read the same stale value
-- and the second write would silently clobber the first, and a failure
-- between the two calls could leave the stock changed with no history row
-- (or vice versa). This function does the read-check-write and the
-- stock_history insert together, atomically, row-locked, server-side.
begin;

create or replace function public.adjust_product_stock(
  p_product_id uuid,
  p_location public.branch_location,
  p_delta integer,
  p_type text default 'Correction',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_new_stock integer;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_admin() then
    raise exception 'Only admin can adjust stock';
  end if;

  if p_location not in ('Alabar', 'Morocco') then
    raise exception 'Invalid location';
  end if;

  if p_delta = 0 then
    raise exception 'Adjustment quantity must not be zero';
  end if;

  select * into v_product
  from public.products
  where id = p_product_id
  for update;

  if not found then
    raise exception 'Product not found';
  end if;

  if p_location = 'Alabar' then
    v_new_stock := v_product.stock_alabar + p_delta;
    if v_new_stock < 0 then
      raise exception 'Insufficient stock';
    end if;
    update public.products set stock_alabar = v_new_stock, updated_at = now() where id = p_product_id;
  else
    v_new_stock := v_product.stock_morocco + p_delta;
    if v_new_stock < 0 then
      raise exception 'Insufficient stock';
    end if;
    update public.products set stock_morocco = v_new_stock, updated_at = now() where id = p_product_id;
  end if;

  insert into public.stock_history (product_id, product_name, location, change, type, note, created_by)
  values (
    p_product_id, v_product.name, p_location, p_delta,
    coalesce(nullif(trim(coalesce(p_type, '')), ''), 'Correction'),
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Manual ' || coalesce(p_type, 'adjustment')),
    v_user
  );

  return jsonb_build_object(
    'success', true,
    'stock_alabar', case when p_location = 'Alabar' then v_new_stock else v_product.stock_alabar end,
    'stock_morocco', case when p_location = 'Morocco' then v_new_stock else v_product.stock_morocco end
  );
end;
$$;

revoke execute on function public.adjust_product_stock(uuid, public.branch_location, integer, text, text) from public, anon;
grant execute on function public.adjust_product_stock(uuid, public.branch_location, integer, text, text) to authenticated;

commit;
