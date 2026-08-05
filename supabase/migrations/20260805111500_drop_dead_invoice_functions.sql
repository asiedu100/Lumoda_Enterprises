-- create_invoice and soft_delete_invoice are the original, stock-aware
-- versions of invoice creation/deletion, superseded by create_invoice_no_stock
-- and soft_delete_invoice_no_stock. Confirmed via grep across every client
-- file: zero callers of either. Stock enforcement on sale was reviewed this
-- session and explicitly left as-is (client's call), so these aren't needed
-- as a reference for that either — just dead weight, dropped the same way
-- approve_warehouse_movement was earlier.
begin;

drop function if exists public.create_invoice(
  text, public.branch_location, jsonb, text, text, public.invoice_status, public.payment_method, text, text
);
drop function if exists public.soft_delete_invoice(uuid);

commit;
