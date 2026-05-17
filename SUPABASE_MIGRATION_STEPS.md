# Supabase Migration: Add Warehouse Manager Role & Schema

**Timeline**: 5-10 minutes per step  
**Risk Level**: Low (adding enum, constraint, new tables, new RLS policies only—no data deletion)  
**Rollback**: If anything fails, steps are idempotent—re-run them.

---

## Prerequisites
- [ ] RLS is already enabled on your Supabase database
- [ ] You have admin access to the Supabase project
- [ ] You have existing `profiles`, `products`, `customers`, and `invoices` tables
- [ ] You have existing `audit_logs` table (created by core schema)

---

## Step 1: Add `warehouse_manager` Role to Enum
**Run this in SQL Editor**

```sql
-- Step 1: Alter the user_role enum to include warehouse_manager
do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'warehouse_manager' 
    and enumtypid = 'public.user_role'::regtype
  ) then
    alter type public.user_role add value 'warehouse_manager';
  end if;
end $$;
```

**Expected Output**: "Query executed successfully" or "Query executed successfully (no rows)" if role already exists.

---

## Step 2: Update Profiles Table Constraint
**Run this in SQL Editor**

```sql
-- Step 2: Drop and recreate the profiles check constraint to allow warehouse_manager with location 'All'
-- Warehouse Manager is ONE account for the entire warehouse (not per-branch)
alter table public.profiles
  drop constraint if exists profiles_role_location_check;

alter table public.profiles
  add constraint profiles_role_location_check check (
    (role in ('admin', 'warehouse_manager') and location = 'All')
    or (role = 'staff' and location in ('Alabar', 'Morocco'))
  );
```

**Expected Output**: "Query executed successfully" for both statements.

**Note**: Warehouse Manager location must be `'All'` (not 'Alabar' or 'Morocco').

---

## Step 3: Create Warehouse Tables
**Run this in SQL Editor**

```sql
-- Step 3a: Create warehouse_products table
create table if not exists public.warehouse_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default 'General',
  reorder_level integer not null default 5 check (reorder_level >= 0),
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Step 3b: Create warehouse_suppliers table
create table if not exists public.warehouse_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  phone text,
  location text,
  notes text,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Step 3c: Create warehouse_movements table
create table if not exists public.warehouse_movements (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('opening_balance', 'stock_in', 'stock_out', 'adjustment')),
  requisition_no text,
  issue_to text,
  storekeeper text,
  supplier text,
  description text not null,
  cartons integer not null default 0 check (cartons >= 0),
  notes text,
  items jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

-- Step 3d: Create warehouse_requisitions table
create table if not exists public.warehouse_requisitions (
  id uuid primary key default gen_random_uuid(),
  requisition_no text not null unique,
  issue_to text not null,
  storekeeper text not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Step 3e: Create warehouse_requisition_items table
create table if not exists public.warehouse_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.warehouse_requisitions(id) on delete cascade,
  item_code text,
  description text not null,
  cartons integer not null default 0 check (cartons >= 0),
  quantity_supplied integer not null default 0 check (quantity_supplied >= 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  created_at timestamptz not null default now()
);

-- Step 3f: Create indexes for performance
create index if not exists warehouse_products_name_idx on public.warehouse_products(name);
create index if not exists warehouse_products_created_at_idx on public.warehouse_products(created_at desc);
create index if not exists warehouse_suppliers_created_at_idx on public.warehouse_suppliers(created_at desc);
create index if not exists warehouse_movements_created_at_idx on public.warehouse_movements(created_at desc);
create index if not exists warehouse_movements_type_idx on public.warehouse_movements(type);
create index if not exists warehouse_requisitions_created_at_idx on public.warehouse_requisitions(created_at desc);
create index if not exists warehouse_requisition_items_requisition_id_idx on public.warehouse_requisition_items(requisition_id);
```

**Expected Output**: "Query executed successfully" for each CREATE TABLE IF NOT EXISTS (will say "exists" if already created).

---

## Step 4: Enable RLS on Warehouse Tables
**Run this in SQL Editor**

```sql
-- Step 4a: Enable RLS on warehouse tables
alter table public.warehouse_products enable row level security;
alter table public.warehouse_suppliers enable row level security;
alter table public.warehouse_movements enable row level security;
alter table public.warehouse_requisitions enable row level security;
alter table public.warehouse_requisition_items enable row level security;
```

**Expected Output**: "Query executed successfully" for each ALTER TABLE.

---

## Step 5: Add RLS Policies for Warehouse Manager Access
**Run this in SQL Editor**

```sql
-- Step 5a: Warehouse Products RLS
-- Policy: Admin and warehouse manager can view
drop policy if exists "warehouse_products_view" on public.warehouse_products;
create policy "warehouse_products_view" on public.warehouse_products
  for select using (
    current_user_id() is not null
    and exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

-- Policy: Admin and warehouse manager can insert/update
drop policy if exists "warehouse_products_manage" on public.warehouse_products;
create policy "warehouse_products_manage" on public.warehouse_products
  for insert with check (
    exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

-- Step 5b: Warehouse Suppliers RLS
drop policy if exists "warehouse_suppliers_view" on public.warehouse_suppliers;
create policy "warehouse_suppliers_view" on public.warehouse_suppliers
  for select using (
    current_user_id() is not null
    and exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

drop policy if exists "warehouse_suppliers_manage" on public.warehouse_suppliers;
create policy "warehouse_suppliers_manage" on public.warehouse_suppliers
  for insert with check (
    exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

-- Step 5c: Warehouse Movements RLS
drop policy if exists "warehouse_movements_view" on public.warehouse_movements;
create policy "warehouse_movements_view" on public.warehouse_movements
  for select using (
    current_user_id() is not null
    and exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

drop policy if exists "warehouse_movements_manage" on public.warehouse_movements;
create policy "warehouse_movements_manage" on public.warehouse_movements
  for insert with check (
    exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

-- Step 5d: Warehouse Requisitions RLS
drop policy if exists "warehouse_requisitions_view" on public.warehouse_requisitions;
create policy "warehouse_requisitions_view" on public.warehouse_requisitions
  for select using (
    current_user_id() is not null
    and exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

drop policy if exists "warehouse_requisitions_manage" on public.warehouse_requisitions;
create policy "warehouse_requisitions_manage" on public.warehouse_requisitions
  for insert with check (
    exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

-- Step 5e: Warehouse Requisition Items RLS
drop policy if exists "warehouse_requisition_items_view" on public.warehouse_requisition_items;
create policy "warehouse_requisition_items_view" on public.warehouse_requisition_items
  for select using (
    current_user_id() is not null
    and exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );

drop policy if exists "warehouse_requisition_items_manage" on public.warehouse_requisition_items;
create policy "warehouse_requisition_items_manage" on public.warehouse_requisition_items
  for insert with check (
    exists (
      select 1 from public.profiles
      where profiles.id = current_user_id()
      and (profiles.role = 'admin' or profiles.role = 'warehouse_manager')
    )
  );
```

**Expected Output**: "Query executed successfully" for each DROP POLICY (even if no policy exists) and CREATE POLICY.

---

## Frontend Access Control for Warehouse Manager

**Updated in app.js** to ensure warehouse_manager can ONLY see warehouse activities:

✅ **Navigation (`buildNavForRole`)**: Warehouse manager sees only "Warehouse" nav item
- Hides: Dashboard, Invoices, Customers, Products, Stock History, Reports, Audit, Users
- Shows: Warehouse page only
- Location filter hidden (warehouse_manager has 'All' location)

✅ **Page Access (`navigate`)**: Warehouse manager blocked from non-warehouse pages
- Can access: 'warehouse' and 'settings' (for password change only)
- Blocked pages: All admin/staff pages show "Access denied" toast

✅ **Initial Page (`showApp`)**: After login, warehouse_manager lands on Warehouse page
- Admin/Staff: Dashboard (existing behavior)
- Warehouse Manager: **Warehouse** page

---

## Post-Migration Validation Checklist

After running all steps, verify in Supabase Dashboard:

### In **SQL Editor**, run this validation query:

```sql
-- Validate enum values
select enum_range(null::public.user_role)::text;

-- Expected: {"admin","staff","warehouse_manager"}
```

### In **Table Editor**, check:
- [ ] `profiles` table exists with `role` column showing enum dropdown with admin/staff/**warehouse_manager**
- [ ] `warehouse_products` table exists and is listed in Auth > Policies
- [ ] `warehouse_suppliers` table exists and is listed in Auth > Policies
- [ ] `warehouse_movements` table exists and is listed in Auth > Policies
- [ ] `warehouse_requisitions` table exists and is listed in Auth > Policies
- [ ] `warehouse_requisition_items` table exists and is listed in Auth > Policies

### In **Auth > Policies**, verify RLS is enabled and these policies exist:
- `warehouse_products_view`, `warehouse_products_manage`
- `warehouse_suppliers_view`, `warehouse_suppliers_manage`
- `warehouse_movements_view`, `warehouse_movements_manage`
- `warehouse_requisitions_view`, `warehouse_requisitions_manage`
- `warehouse_requisition_items_view`, `warehouse_requisition_items_manage`

---

## Frontend Testing

After migration completes:

1. **Log in as admin** → Go to **Settings > Create Staff Account**
2. **Select Role**: dropdown should now show: `Staff`, `Warehouse Manager`, `Admin`
3. **Create Warehouse Manager**: Fill in details, set role to "Warehouse Manager", location to **"All"** (this is warehouse-wide access), click **Save**
4. **Important**: Only ONE warehouse manager should be created (location must be "All")
5. **Verify**: New warehouse manager should appear in the users list
6. **Log in as warehouse manager** → Should see **Warehouse** nav item (not Reports, Audit, or Users)
7. **Warehouse page** should load warehouse tables from Supabase for all branches

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `type ... already exists` | Enum already has warehouse_manager | Skip Step 1; run validation query |
| `duplicate key value violates unique constraint "profiles_role_location_check"` | Existing profile violates new constraint | Manually update profile locations in Table Editor |
| `relation "warehouse_products" does not exist` | Tables not created | Run Step 3 again |
| `permission denied for schema public` | User lacks superuser role | Use Supabase project's service_role key |
| Warehouse Manager still can't see warehouse page | Frontend not reloaded | Hard refresh browser (Ctrl+Shift+R) |

---

## Next Steps After Migration

1. **Convert warehouse to server-authoritative** (currently local-first):
   - Modify `warehouse.js` to save movements directly to Supabase, not localStorage first
   - Add transaction logic to deduct stock from warehouse_products

2. **Add warehouse-specific RLS policies**:
   - Restrict warehouse manager to their location only (currently allows all)
   - Add delete policies for adjustment/correction movements

3. **Add approval workflow**:
   - Stock out movements should require warehouse_manager approval
   - Add workflow state (pending, approved, rejected) to warehouse_movements

4. **Link warehouse to product master**:
   - Align warehouse_products with public.products SKU
   - Add stock synchronization

