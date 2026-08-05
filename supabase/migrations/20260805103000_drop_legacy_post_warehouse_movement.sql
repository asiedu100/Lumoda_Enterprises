-- Discovered while applying 20260805101500_warehouse_transfers.sql: a THIRD
-- copy of post_warehouse_movement_direct was still live in production — the
-- original 10-arg pre-multi-warehouse version (no p_warehouse_id, no
-- can_access_warehouse() check at all, and the old pending-approval /
-- reserved_cartons-only stock_out logic that 20260804064003 was meant to
-- retire). It survived because the multi-warehouse migration added
-- p_warehouse_id via CREATE OR REPLACE without first dropping the old
-- signature — the exact overload trap this migration's sibling file calls
-- out. In its current form it would actually error on any stock_in/opening/
-- adjustment (its `on conflict (item_code)` no longer matches the table's
-- real `(warehouse_id, item_code)` unique constraint), but a stock_out call
-- would silently succeed while completely bypassing per-warehouse
-- authorization and reintroducing the stuck-forever "pending" bug. The live
-- app was never actually calling this overload (supabase-client.js always
-- sends p_warehouse_id/p_to_warehouse_id now), but it was reachable by
-- anyone calling the RPC directly, so it's dropped outright rather than left
-- as a dangling landmine.
begin;

drop function if exists public.post_warehouse_movement_direct(
  text, text, integer, jsonb, text, text, text, text, text, text
);

commit;
