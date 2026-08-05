-- One-time reset: Main Warehouse's 311 stock balance rows were backfilled
-- from the old single-inventory system before the multi-warehouse feature
-- existed — not a real current count. The client is starting real
-- warehouse operations this week and wants Main Warehouse to start at
-- zero, the same way an unused warehouse (e.g. OLD TAFO) already shows.
-- Rows are kept (item codes/names/reorder levels intact) and only their
-- quantities are zeroed, so this is reversible if needed. Does not touch
-- public.products (stock_alabar/stock_morocco) — a separate system.
begin;

update public.warehouse_stock_balance
set total_cartons = 0, reserved_cartons = 0, updated_at = now()
where warehouse_id = '10d218f7-1e93-4e6b-9b19-9d369e6ed4f5'; -- Main Warehouse

commit;
