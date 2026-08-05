-- Found while testing 20260805113000: if a product had already been saved
-- at least once since the sync trigger went live, it already has its own
-- auto-created warehouse_products row under its real sku — so the OLD,
-- pre-existing warehouse row (the one with real accumulated stock, sitting
-- under the legacy mismatched code) is a second, separate row with the same
-- name. The original link_catalog_item() just renamed the old row's sku to
-- match the product — which would hit the warehouse_products.sku unique
-- constraint and fail, since a row with that sku already exists.
--
-- Fixed to upsert the canonical row (same logic the trigger uses) instead
-- of blindly renaming the target, move any stock off the old code onto the
-- canonical sku either way, and only delete the old row if it turned out to
-- be a genuine duplicate of the canonical one (not the same row).
begin;

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
  v_canonical_id uuid;
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

  insert into public.warehouse_products (sku, name, category, reorder_level)
  values (v_product.sku, v_product.name, coalesce(v_product.category, 'General'), coalesce(v_product.reorder_level, 10))
  on conflict (sku) do update set
    name = excluded.name,
    category = excluded.category,
    reorder_level = excluded.reorder_level
  returning id into v_canonical_id;

  if v_old_sku is not null and v_old_sku <> v_product.sku then
    update public.warehouse_stock_balance
    set item_code = v_product.sku,
        item_name = v_product.name,
        updated_at = now()
    where item_code = v_old_sku;

    if p_warehouse_product_id <> v_canonical_id then
      delete from public.warehouse_products where id = p_warehouse_product_id;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

commit;
