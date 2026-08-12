-- Offline cash sales: a queued sale may be retried (connection drops again
-- mid-sync, tab closes before the response arrives, etc.). Without a
-- server-side dedupe key, a retry could create a second, duplicate invoice
-- for the same sale. client_ref is a client-generated id sent once per
-- sale attempt; retrying with the same client_ref returns the original
-- invoice instead of creating another one.

alter table public.invoices add column if not exists client_ref text;
create unique index if not exists invoices_client_ref_uidx
  on public.invoices(client_ref) where client_ref is not null;

-- create_invoice_no_stock gains one new trailing parameter (p_client_ref).
-- Adding a parameter via a bare "create or replace" would leave the old
-- 15-arg signature callable as a second, un-idempotent overload (the same
-- dangling-overload trap fixed earlier this project) — so the old signature
-- is dropped explicitly first.
drop function if exists public.create_invoice_no_stock(
  text, public.branch_location, jsonb, text, text, public.invoice_status,
  public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric
);

create or replace function public.create_invoice_no_stock(
  p_customer_name text,
  p_location public.branch_location,
  p_items jsonb,
  p_customer_phone text default null,
  p_customer_address text default null,
  p_status public.invoice_status default 'pending',
  p_pay_method public.payment_method default null,
  p_momo_number text default null,
  p_notes text default null,
  p_amount_paid numeric default 0,
  p_discount numeric default 0,
  p_partial_method text default null,
  p_partial_momo text default null,
  p_is_cash_sale boolean default false,
  p_cash_tendered numeric default null,
  p_client_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role public.user_role;
  v_user_location public.branch_location;
  v_invoice_id uuid;
  v_number text;
  v_customer_id uuid;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_effective_paid numeric(12,2) := 0;
  v_item jsonb;
  v_product_id uuid;
  v_item_name text;
  v_item_qty integer;
  v_item_price numeric(12,2);
  v_sale_type text;
  v_existing public.invoices%rowtype;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;

  -- Idempotent replay: if this exact client_ref already produced an
  -- invoice, hand back that invoice instead of creating a second one.
  if p_client_ref is not null then
    select * into v_existing from public.invoices where client_ref = p_client_ref;
    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'number', v_existing.number,
        'subtotal', v_existing.subtotal,
        'discount', v_existing.discount,
        'total', v_existing.total,
        'paid', v_existing.amount_paid,
        'balance', v_existing.balance,
        'idempotent_replay', true
      );
    end if;
  end if;

  select role, location into v_role, v_user_location
  from public.profiles
  where id = v_user and active = true;

  if not found then raise exception 'Active profile not found'; end if;
  if p_location not in ('Alabar', 'Morocco') then raise exception 'Invalid invoice location'; end if;
  if v_role <> 'admin' and p_location <> v_user_location then raise exception 'You cannot create invoices for this branch'; end if;
  if length(trim(coalesce(p_customer_name, ''))) = 0 then raise exception 'Customer name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Invoice requires at least one item'; end if;
  if p_status = 'paid' and p_pay_method is null then raise exception 'Payment method is required for paid invoices'; end if;

  -- Any discount from a non-admin is held for approval instead of applied.
  -- Nothing is created yet — the customer record, invoice, and items are
  -- only produced once an admin approves the request (approve_invoice_request).
  -- This branch doesn't create an invoice row, so the client_ref check above
  -- can't catch a retry here — checked separately against any still-pending
  -- request carrying the same client_ref, so a retried offline sale with a
  -- discount doesn't queue a second approval request for the same sale.
  if v_role <> 'admin' and coalesce(p_discount, 0) > 0 then
    if p_client_ref is not null and exists (
      select 1 from public.invoice_edit_requests
      where status = 'pending' and payload->>'p_client_ref' = p_client_ref
    ) then
      return jsonb_build_object('success', true, 'discount_pending_approval', true, 'idempotent_replay', true);
    end if;

    insert into public.invoice_edit_requests (invoice_id, request_type, requested_by, payload)
    values (
      null,
      'discount',
      v_user,
      jsonb_build_object(
        'p_customer_name', p_customer_name,
        'p_location', p_location,
        'p_items', p_items,
        'p_customer_phone', p_customer_phone,
        'p_customer_address', p_customer_address,
        'p_status', p_status,
        'p_pay_method', p_pay_method,
        'p_momo_number', p_momo_number,
        'p_notes', p_notes,
        'p_amount_paid', p_amount_paid,
        'p_discount', p_discount,
        'p_partial_method', p_partial_method,
        'p_partial_momo', p_partial_momo,
        'p_is_cash_sale', p_is_cash_sale,
        'p_cash_tendered', p_cash_tendered,
        'p_client_ref', p_client_ref
      )
    );
    return jsonb_build_object('success', true, 'discount_pending_approval', true);
  end if;

  if p_status <> 'paid' then
    p_pay_method := null;
    p_momo_number := null;
  end if;

  select id into v_customer_id
  from public.customers
  where lower(name) = lower(trim(p_customer_name))
    and location = p_location
  order by created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.customers (name, phone, address, location, created_by)
    values (
      trim(p_customer_name),
      nullif(trim(coalesce(p_customer_phone, '')), ''),
      nullif(trim(coalesce(p_customer_address, '')), ''),
      p_location,
      v_user
    ) returning id into v_customer_id;
  else
    update public.customers
    set phone = coalesce(nullif(trim(coalesce(p_customer_phone, '')), ''), phone),
        address = coalesce(nullif(trim(coalesce(p_customer_address, '')), ''), address)
    where id = v_customer_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);

    if v_item_name = '' then raise exception 'Item name is required'; end if;
    if v_item_qty < 1 then raise exception 'Quantity must be greater than zero'; end if;
    if v_item_price < 0 then raise exception 'Price cannot be negative'; end if;

    v_subtotal := v_subtotal + (v_item_qty * v_item_price);
  end loop;

  if v_subtotal <= 0 then raise exception 'Invoice total must be greater than zero'; end if;

  v_total := greatest(v_subtotal - coalesce(p_discount, 0), 0);

  v_effective_paid := case
    when p_status = 'paid' then v_total
    when p_status = 'partial' then least(greatest(coalesce(p_amount_paid, 0), 0), v_total)
    else 0
  end;

  insert into public.invoices (
    customer_id, customer_name, customer_phone, customer_address,
    location, subtotal, discount, total, status, pay_method, momo_number, notes,
    amount_paid, balance, partial_method, partial_momo_number, is_cash_sale, cash_tendered, created_by,
    client_ref
  ) values (
    v_customer_id,
    trim(p_customer_name),
    nullif(trim(coalesce(p_customer_phone, '')), ''),
    nullif(trim(coalesce(p_customer_address, '')), ''),
    p_location,
    v_subtotal,
    coalesce(p_discount, 0),
    v_total,
    p_status,
    p_pay_method,
    nullif(trim(coalesce(p_momo_number, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_effective_paid,
    greatest(v_total - v_effective_paid, 0),
    p_partial_method,
    nullif(trim(coalesce(p_partial_momo, '')), ''),
    coalesce(p_is_cash_sale, false),
    p_cash_tendered,
    v_user,
    p_client_ref
  ) returning id, number into v_invoice_id, v_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_name := trim(coalesce(v_item->>'name', ''));
    v_item_qty := coalesce(nullif(v_item->>'qty', '')::integer, 0);
    v_item_price := coalesce(nullif(v_item->>'price', '')::numeric, 0);
    v_sale_type := coalesce(nullif(v_item->>'sale_type', ''), nullif(v_item->>'priceType', ''), 'retail');
    v_product_id := null;

    if nullif(v_item->>'product_id', '') is not null and v_item->>'product_id' <> 'null' then
      select id into v_product_id
      from public.products
      where id = (v_item->>'product_id')::uuid
      limit 1;
    end if;

    if v_product_id is null then
      select id into v_product_id
      from public.products
      where lower(name) = lower(v_item_name)
      limit 1;
    end if;

    insert into public.invoice_items (invoice_id, product_id, name, sale_type, qty, price)
    values (v_invoice_id, v_product_id, v_item_name, v_sale_type, v_item_qty, v_item_price);
  end loop;

  if v_effective_paid > 0 then
    insert into public.invoice_payments (invoice_id, amount, method, momo_number, note, created_by)
    values (
      v_invoice_id,
      v_effective_paid,
      coalesce(p_pay_method::text, p_partial_method),
      coalesce(p_momo_number, p_partial_momo),
      'Initial payment',
      v_user
    );
  end if;

  insert into public.audit_logs (action, detail, created_by)
  values ('Invoice Created', 'Invoice ' || v_number || ' created for ' || trim(p_customer_name), v_user);

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'number', v_number,
    'subtotal', v_subtotal,
    'discount', coalesce(p_discount, 0),
    'total', v_total,
    'paid', v_effective_paid,
    'balance', greatest(v_total - v_effective_paid, 0)
  );
end;
$$;

-- Matches the anon+authenticated grant the original 15-arg signature had —
-- harmless for anon since the function itself rejects a null auth.uid().
grant execute on function public.create_invoice_no_stock(
  text, public.branch_location, jsonb, text, text, public.invoice_status,
  public.payment_method, text, text, numeric, numeric, text, text, boolean, numeric, text
) to anon, authenticated;
