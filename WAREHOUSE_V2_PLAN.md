# LUMODA WAREHOUSE V2: Server-Authoritative Stock Ledger

## 📊 V2 Overview

**V1 (Current)**: Local-first warehouse module
- All data stored in localStorage
- Supabase is "read-only cache" (synced one-way from server)
- No transactional stock deductions
- No real-time balance validation
- Manual sync required

**V2 (Target)**: Server-authoritative warehouse module
- Direct posting to Supabase (no localStorage intermediate)
- Real-time balance validation before stock_out
- Transactional RPC for atomic stock movements
- Approval workflow (pending → approved → executed)
- Full audit trail for compliance
- Cartons-only model maintained

---

## 🔄 Architecture Changes

### V1 Flow (Local-First)
```
Warehouse Manager
    ↓
[Create Stock Out] → localStorage (immediate)
    ↓
[sync to Supabase] (background, unreliable)
    ↓
Server sees data (eventual consistency, no validation)
```

### V2 Flow (Server-Authoritative)
```
Warehouse Manager
    ↓
[Create Stock Out (Pending)]
    ↓
[POST to Supabase RPC: post_warehouse_movement]
    ↓
Supabase validates: 
  - Is balance >= cartons requested?
  - Update warehouse_stock_balance
  - Insert warehouse_movements
  - Log audit entry
    ↓
[Return: success or "Insufficient stock"]
    ↓
UI shows Pending movement
Manager/Admin reviews
    ↓
[Approve (if workflow enabled)]
    ↓
[Execute movement] → balance deducted, movement marked done
```

---

## 📝 Database Changes Required

### 1. Add `warehouse_stock_balance` Table

```sql
create table if not exists public.warehouse_stock_balance (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_name text not null,
  total_cartons integer not null default 0 check (total_cartons >= 0),
  reserved_cartons integer not null default 0 check (reserved_cartons >= 0),
  available_cartons integer generated always as (total_cartons - reserved_cartons) stored,
  last_movement_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index warehouse_stock_balance_item_code_idx on public.warehouse_stock_balance(item_code);
create index warehouse_stock_balance_updated_at_idx on public.warehouse_stock_balance(updated_at desc);
```

### 2. Add `status` Column to `warehouse_movements`

```sql
alter table public.warehouse_movements 
  add column if not exists status text default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed'));

alter table public.warehouse_movements
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists executed_at timestamptz,
  add column if not exists rejection_reason text;

create index warehouse_movements_status_idx on public.warehouse_movements(status);
create index warehouse_movements_type_status_idx on public.warehouse_movements(type, status);
```

### 3. Add `warehouse_stock_journal` Table (Audit)

```sql
create table if not exists public.warehouse_stock_journal (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid references public.warehouse_movements(id) on delete cascade,
  item_code text not null,
  item_name text not null,
  movement_type text not null check (movement_type in ('stock_in', 'stock_out', 'adjustment')),
  cartons_before integer not null,
  cartons_delta integer not null,
  cartons_after integer not null,
  balance_before integer not null,
  balance_after integer not null,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

create index warehouse_stock_journal_movement_id_idx on public.warehouse_stock_journal(movement_id);
create index warehouse_stock_journal_item_code_idx on public.warehouse_stock_journal(item_code);
create index warehouse_stock_journal_created_at_idx on public.warehouse_stock_journal(created_at desc);
```

---

## 🔧 Supabase RPC Functions

### RPC 1: `post_warehouse_movement_direct`

Atomic function that:
1. Validates stock balance
2. Updates warehouse_stock_balance
3. Inserts warehouse_movement
4. Inserts audit trail (warehouse_stock_journal)
5. Inserts requisition (if stock_out)

```sql
create or replace function public.post_warehouse_movement_direct(
  p_type text,
  p_description text,
  p_cartons integer,
  p_items jsonb,
  p_requisition_no text default null,
  p_issue_to text default null,
  p_storekeeper text default null,
  p_supplier text default null,
  p_notes text default null,
  p_created_by_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_balance integer;
  v_item jsonb;
  v_item_code text;
  v_item_name text;
  v_cartons integer;
  v_movement_id uuid;
  v_requisition_id uuid;
  v_user_id uuid;
  v_error text;
begin
  -- Get current user ID
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  -- Validate movement type
  if p_type not in ('stock_in', 'stock_out', 'opening_balance', 'adjustment') then
    return jsonb_build_object('success', false, 'error', 'Invalid movement type');
  end if;

  -- For stock_out, validate balance per item
  if p_type = 'stock_out' and p_items is not null then
    for v_item in select jsonb_array_elements(p_items)
    loop
      v_item_code := v_item->>'itemCode' or v_item->>'code';
      v_item_name := v_item->>'description' or v_item->>'name';
      v_cartons := (v_item->>'cartons')::integer or 0;

      if v_item_code is not null and v_cartons > 0 then
        select coalesce(available_cartons, 0) into v_balance
        from public.warehouse_stock_balance
        where item_code = v_item_code;

        if v_balance < v_cartons then
          v_error := format('Insufficient stock for %s: need %s cartons, available %s', 
            v_item_code, v_cartons, v_balance);
          return jsonb_build_object('success', false, 'error', v_error);
        end if;

        -- Reserve cartons
        update public.warehouse_stock_balance
        set reserved_cartons = reserved_cartons + v_cartons,
            updated_at = now()
        where item_code = v_item_code;
      end if;
    end loop;
  end if;

  -- Insert requisition if stock_out
  if p_type = 'stock_out' and p_requisition_no is not null then
    insert into public.warehouse_requisitions 
      (requisition_no, issue_to, storekeeper, notes, created_by)
    values 
      (p_requisition_no, p_issue_to, p_storekeeper, p_notes, v_user_id)
    on conflict (requisition_no) do nothing
    returning id into v_requisition_id;
  end if;

  -- Insert movement
  insert into public.warehouse_movements
    (type, requisition_no, issue_to, storekeeper, supplier, description, cartons, notes, items, created_by, created_by_name, status)
  values
    (p_type, p_requisition_no, p_issue_to, p_storekeeper, p_supplier, p_description, p_cartons, p_notes, p_items, v_user_id, p_created_by_name, 'pending')
  returning id into v_movement_id;

  -- Optionally auto-execute for stock_in and opening_balance (admin only)
  if p_type in ('stock_in', 'opening_balance') then
    update public.warehouse_movements
    set status = 'executed', executed_at = now()
    where id = v_movement_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'movement_id', v_movement_id,
    'status', case when p_type in ('stock_in', 'opening_balance') then 'executed' else 'pending' end
  );
end;
$$;
```

### RPC 2: `approve_warehouse_movement`

```sql
create or replace function public.approve_warehouse_movement(
  p_movement_id uuid,
  p_approved boolean default true,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_movement record;
  v_user_id uuid;
  v_item jsonb;
  v_item_code text;
  v_cartons integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Not authenticated');
  end if;

  -- Only admin can approve
  if not exists (select 1 from public.profiles where id = v_user_id and role = 'admin') then
    return jsonb_build_object('success', false, 'error', 'Only admin can approve');
  end if;

  select * into v_movement from public.warehouse_movements where id = p_movement_id;
  if v_movement is null then
    return jsonb_build_object('success', false, 'error', 'Movement not found');
  end if;

  if p_approved then
    -- Approve and execute immediately for stock_out
    update public.warehouse_movements
    set 
      status = 'executed',
      approved_by = v_user_id,
      approved_at = now(),
      executed_at = now()
    where id = p_movement_id;

    -- Deduct from total_cartons (reserved → executed)
    if v_movement.type = 'stock_out' and v_movement.items is not null then
      for v_item in select jsonb_array_elements(v_movement.items)
      loop
        v_item_code := v_item->>'itemCode' or v_item->>'code';
        v_cartons := (v_item->>'cartons')::integer or 0;

        if v_item_code is not null and v_cartons > 0 then
          update public.warehouse_stock_balance
          set 
            total_cartons = total_cartons - v_cartons,
            reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
          where item_code = v_item_code;
        end if;
      end loop;
    end if;
  else
    -- Reject movement
    update public.warehouse_movements
    set 
      status = 'rejected',
      rejection_reason = p_rejection_reason,
      approved_by = v_user_id,
      approved_at = now()
    where id = p_movement_id;

    -- Release reserved cartons back to available
    if v_movement.type = 'stock_out' and v_movement.items is not null then
      for v_item in select jsonb_array_elements(v_movement.items)
      loop
        v_item_code := v_item->>'itemCode' or v_item->>'code';
        v_cartons := (v_item->>'cartons')::integer or 0;

        if v_item_code is not null and v_cartons > 0 then
          update public.warehouse_stock_balance
          set 
            reserved_cartons = reserved_cartons - v_cartons,
            updated_at = now()
          where item_code = v_item_code;
        end if;
      end loop;
    end if;
  end if;

  return jsonb_build_object('success', true, 'movement_id', p_movement_id);
end;
$$;
```

---

## 🖥️ Frontend Changes

### warehouse.js Changes

**Old Flow:**
```javascript
// Create movement locally first
saveWarehouseMovementsLocal([...]);
// Then try to sync
await window.LumodaSupabase.saveWarehouseMovement(payload);
```

**New Flow:**
```javascript
// POST directly to Supabase RPC
const result = await window.LumodaSupabase.postWarehouseMovementDirect(payload);
if (result.success) {
  toast('Movement created. Status: ' + result.status);
  // Refresh UI from Supabase
  await loadWarehouseDataFromServer();
} else {
  toast(result.error, 'error');
}
```

### supabase-client.js New Methods

```javascript
async function postWarehouseMovementDirect(payload) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase not configured');

  const { data, error } = await sb.rpc('post_warehouse_movement_direct', {
    p_type: payload.type,
    p_description: payload.description,
    p_cartons: payload.cartons || 0,
    p_items: payload.items || [],
    p_requisition_no: payload.requisition_no || null,
    p_issue_to: payload.issue_to || null,
    p_storekeeper: payload.storekeeper || null,
    p_supplier: payload.supplier || null,
    p_notes: payload.notes || null,
    p_created_by_name: payload.created_by_name || null
  });

  if (error) throw error;
  return data;
}

async function approveWarehouseMovement(movement_id, approved = true, reason = null) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase not configured');

  const { data, error } = await sb.rpc('approve_warehouse_movement', {
    p_movement_id: movement_id,
    p_approved: approved,
    p_rejection_reason: reason
  });

  if (error) throw error;
  return data;
}

async function loadWarehouseStockBalance() {
  const sb = getClient();
  if (!sb) return [];

  const { data, error } = await sb
    .from('warehouse_stock_balance')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}
```

---

## 🧪 Implementation Steps

### Step 1: Add Database Tables & Functions (SQL)
- [ ] Create `warehouse_stock_balance` table
- [ ] Add `status`, `approved_by`, `approved_at`, `executed_at` columns to `warehouse_movements`
- [ ] Create `warehouse_stock_journal` audit table
- [ ] Create `post_warehouse_movement_direct` RPC
- [ ] Create `approve_warehouse_movement` RPC
- [ ] Enable RLS on new tables

### Step 2: Update supabase-client.js
- [ ] Add `postWarehouseMovementDirect()` method
- [ ] Add `approveWarehouseMovement()` method
- [ ] Add `loadWarehouseStockBalance()` method
- [ ] Update `loadWarehouseMovements()` to include status & approval info

### Step 3: Update warehouse.js
- [ ] Replace local-first save with direct Supabase posting
- [ ] Add stock balance display (total, reserved, available)
- [ ] Add approval UI for pending movements (admin only)
- [ ] Add rejection modal with reason
- [ ] Remove localStorage dependency for movements

### Step 4: Update index.html
- [ ] Add warehouse stock balance UI (summary card)
- [ ] Add pending movements queue (for approval)
- [ ] Add approve/reject buttons
- [ ] Add rejection reason modal

### Step 5: Testing
- [ ] Create warehouse product with 100 cartons
- [ ] Create stock_out for 80 cartons (should show Pending)
- [ ] Admin approves → stock reduced to 20, movement marked Executed
- [ ] Try stock_out for 50 cartons → "Insufficient stock" error
- [ ] View audit trail (warehouse_stock_journal)

---

## 🎯 Expected Outcomes

✅ Real-time stock balance validation  
✅ Approval workflow (pending → approved → executed)  
✅ No overselling possible  
✅ Full audit trail for compliance  
✅ Server-authoritative (no data loss from localStorage)  
✅ Warehouse manager can only create movements, not approve  
✅ Admin approves movements  

---

## 📌 Notes

- `warehouse_manager` can create movements (stock_in/stock_out/adjustment)
- `admin` can approve/reject movements and view audit logs
- `stock_in` and `opening_balance` auto-execute (no approval needed)
- `stock_out` requires admin approval before executing
- Reserved cartons prevent double-booking during approval
- Audit trail in `warehouse_stock_journal` for compliance

