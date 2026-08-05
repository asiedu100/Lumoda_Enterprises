-- approve_warehouse_movement was the other half of the "pending approval"
-- flow that 20260804064003_stock_out_auto_execute.sql already disabled by
-- making every movement type auto-execute. Nothing in the frontend calls
-- this RPC (grep confirms zero callers across app/*.js and app/index.html),
-- and no movement can be left in a state this function would ever act on —
-- every insert path sets status = 'executed' directly, confirmed live (zero
-- pending/rejected rows exist in production). Dropping it removes the last
-- piece of dead approval-flow surface area. The movement.status column, its
-- CHECK constraint, and the approved_by/approved_at/rejection_reason
-- columns are left as-is (harmless, unused) — narrowly scoped;
-- warehouse_requisitions/warehouse_stock_journal are untouched.
begin;

drop function if exists public.approve_warehouse_movement(uuid, boolean, text);

commit;
