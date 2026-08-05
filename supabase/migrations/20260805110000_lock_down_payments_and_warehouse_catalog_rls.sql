-- Codebase review found two real, live permission gaps:
--
-- 1. invoice_payments_insert was `with check (true)` — any authenticated
--    staff login could insert a payment row against ANY invoice, any
--    branch, any amount, directly via the client SDK. The app never
--    actually needs this: every legitimate payment write goes through
--    record_partial_payment() or the initial-payment insert inside
--    create_invoice_no_stock(), both security definer functions that run
--    as the table owner and don't need (or use) this grant/policy to keep
--    working. Locked down to no direct client insert at all.
--
-- 2. warehouse_products/warehouse_suppliers insert/update (and suppliers'
--    delete) were `using (true)` — any authenticated staff account,
--    including a plain branch cashier with zero warehouse involvement,
--    could write to the shared warehouse catalog directly. The UI already
--    hides these actions from non-admin/non-warehouse_manager roles, but
--    nothing enforced it server-side. Read stays open (harmless, shared
--    catalog); writes now require admin or warehouse_manager.
begin;

revoke insert on public.invoice_payments from authenticated;

drop policy if exists "invoice_payments_insert" on public.invoice_payments;
create policy "invoice_payments_insert"
on public.invoice_payments for insert
to authenticated
with check (false);

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

commit;
