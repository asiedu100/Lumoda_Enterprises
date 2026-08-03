-- Only admins can delete warehouse catalog items; any authenticated staff
-- can still read/add/edit them (unchanged from before). Previously the
-- table had a single ALL/true policy, so any authenticated user could
-- delete items via the API even though nothing in the UI exposed it.
begin;

drop policy if exists warehouse_products_all on public.warehouse_products;

create policy warehouse_products_select on public.warehouse_products
  for select to authenticated
  using (true);

create policy warehouse_products_insert on public.warehouse_products
  for insert to authenticated
  with check (true);

create policy warehouse_products_update on public.warehouse_products
  for update to authenticated
  using (true)
  with check (true);

create policy warehouse_products_delete on public.warehouse_products
  for delete to authenticated
  using (public.is_admin());

commit;
