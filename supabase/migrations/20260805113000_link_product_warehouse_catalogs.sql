-- Wires the branch product catalog (`products`) and the warehouse catalog
-- (`warehouse_products`) together. Today they're two fully independent
-- catalogs — 310 warehouse items, 417 branch products, zero matching SKUs —
-- even though many represent the same real product under a different code.
--
-- Going forward: a trigger on `products` keeps `warehouse_products` in sync
-- automatically, one direction only (products -> warehouse). A product row
-- requires a price; a warehouse-only item may not have one yet, so the
-- reverse direction (auto-creating a full sellable product from a
-- warehouse-side add) isn't safe to automate — that stays a manual choice.
--
-- Existing mismatch: reconciled via the app's new "Link to Warehouse
-- Catalog" screen (admin-only), which proposes name-matched pairs for a
-- human to confirm or skip — not an unattended auto-merge, since two
-- different real items can easily share a similar name. link_catalog_item()
-- is what a confirmed pair actually calls; backfill_warehouse_catalog_from_products()
-- is the follow-up bulk action for whatever's left unmatched afterward.
begin;

-- ============================================================
-- 1. Forward sync trigger (products -> warehouse_products)
-- ============================================================
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

-- ============================================================
-- 2. One-time reconciliation helpers (admin-only)
-- ============================================================

-- Confirms a proposed pair from the reconciliation screen: the warehouse
-- item takes on the product's sku/name/category/reorder_level (product is
-- canonical going forward), and every existing warehouse_stock_balance row
-- (in every warehouse) that was keyed to the item's OLD sku is renamed to
-- the new shared sku, so live stock tracking doesn't silently disconnect
-- from the catalog entry it belongs to. Historical warehouse_movements
-- rows are left untouched — they're point-in-time snapshots, same as
-- invoice line items already snapshot product names/prices.
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

-- Creates a warehouse catalog entry for every product that still doesn't
-- have one after the manual review pass — the bulk "create the rest" step
-- in the reconciliation screen.
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

commit;
