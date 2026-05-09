// supabase-client.js — LUMODA ENTERPRISE
(function () {
  const cfg = window.LUMODA_SUPABASE || {};
  let client = null;

  function isConfigured() {
    return Boolean(cfg.url && cfg.anonKey && !cfg.url.includes('YOUR_PROJECT_REF'));
  }

  function init() {
    if (!isConfigured()) return null;
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('Supabase SDK was not loaded.');
      return null;
    }
    if (!client) {
      client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage: window.localStorage
        }
      });
    }
    return client;
  }

  function getClient() { return client || init(); }

  async function signIn(email, password) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.auth.signInWithPassword({ email, password });
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    return sb.auth.signOut();
  }

  async function getSession() {
    const sb = getClient();
    if (!sb) return { data: { session: null }, error: null };
    return sb.auth.getSession();
  }

  async function getProfile(userId) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.from('profiles')
      .select('id, email, username, full_name, role, location, active, must_change_password')
      .eq('id', userId)
      .single();
  }

  async function getProfileByUsername(username) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.from('profiles')
      .select('id, email, username, full_name, role, location, active, must_change_password')
      .eq('username', username)
      .maybeSingle();
  }

  function toLocalProduct(row) {
    return {
      id:           row.id,
      name:         row.name,
      sku:          row.sku || '',
      category:     row.category || 'General',
      price:        Number(row.price || 0),
      stockAlabar:  Number(row.stock_alabar || 0),
      stockMorocco: Number(row.stock_morocco || 0),
      reorder:      Number(row.reorder_level || 0)
    };
  }

  function toLocalCustomer(row) {
    return {
      id:        row.id,
      name:      row.name,
      phone:     row.phone || '',
      address:   row.address || '',
      location:  row.location,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
    };
  }

  async function loadProducts() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb
      .from('products')
      .select('id, name, sku, category, price, stock_alabar, stock_morocco, reorder_level')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(toLocalProduct);
  }

  async function loadCustomers() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb
      .from('customers')
      .select('id, name, phone, address, location, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(toLocalCustomer);
  }

  async function loadInvoices() {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');
  const { data, error } = await sb
    .from('invoices')
    .select(`
  id, number, customer_name, customer_phone, customer_address,
  location, subtotal, discount, total, status, pay_method, momo_number, notes,
  amount_paid, balance, partial_method, partial_momo_number,
  created_by, created_at, deleted, deleted_at, deleted_by,

  creator:profiles!invoices_created_by_fkey (
    full_name,
    username
  ),

  invoice_items(id, name, qty, price),

  invoice_payments(
    id, amount, method, momo_number, note, created_by, created_at
  )
`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
      id:              row.id,
      number:          row.number,
      customerName:    row.customer_name,
      customerPhone:   row.customer_phone,
      customerAddress: row.customer_address,
      location:        row.location,
      items: (row.invoice_items || []).map(it => ({
        name:  it.name,
        qty:   it.qty,
        price: Number(it.price || 0),
        total: Number(it.qty || 0) * Number(it.price || 0)
      })),
      subtotal: Number(row.subtotal || row.total || 0),
      discount: Number(row.discount || 0),
      total:           Number(row.total || 0),
      status:          row.status,
      payMethod:       row.pay_method   || '',
      momoNumber:      row.momo_number  || '',
      amountPaid:      Number(row.amount_paid || 0),
      balance:         Number(row.balance     || 0),
      partialMethod:   row.partial_method     || '',
      partialMomoNumber: row.partial_momo_number || '',
      payments: (row.invoice_payments || []).map(p => ({
        id:         p.id,
        amount:     Number(p.amount || 0),
        method:     p.method || '',
        momoNumber: p.momo_number || '',
        note:       p.note || '',
        by:         p.created_by,
        at:         p.created_at ? new Date(p.created_at).getTime() : Date.now()
      })),
      notes:           row.notes || '',
      createdBy:       row.created_by,
      createdByName:   row.created_by ? (row.creator ? row.creator.full_name || row.creator.username || '' : '') : '',
      createdAt:       row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      deleted:         !!row.deleted,
      deletedAt:       row.deleted_at  ? new Date(row.deleted_at).getTime()  : null,
      deletedBy:       row.deleted_by  || null
    }));
  }

  async function loadProfiles() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb
      .from('profiles')
      .select('id, email, username, full_name, role, location, active, must_change_password, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // ── CREATE INVOICE (no stock deduction — pure record keeping) ──
  // Items: [{ product_id, name, qty, price }]
  // product_id is OPTIONAL — server looks up by name if null
  async function createInvoiceNoStock(payload) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not configured.');

  const rpcItems = (payload.p_items || []).map(it => ({
    product_id: it.product_id || null,
    name: String(it.name || ''),
    qty: Number(it.qty || 0),
    price: Number(it.price || 0)
  }));

  return sb.rpc('create_invoice_no_stock', {
    p_customer_name: payload.p_customer_name,
    p_location: payload.p_location,
    p_items: rpcItems,
    p_customer_phone: payload.p_customer_phone || null,
    p_customer_address: payload.p_customer_address || null,
    p_status: payload.p_status || 'pending',
    p_pay_method: payload.p_pay_method || null,
    p_momo_number: payload.p_momo_number || null,
    p_notes: payload.p_notes || null,
    p_amount_paid: payload.p_amount_paid || 0,
    p_discount: payload.p_discount || 0,
    p_partial_method: payload.p_partial_method || null,
    p_partial_momo: payload.p_partial_momo || null
  });
  
  }

  async function softDeleteInvoiceNoStock(invoiceId) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('soft_delete_invoice_no_stock', { p_invoice_id: invoiceId });
  }

  // ── RECORD PARTIAL PAYMENT ──
  async function recordPartialPayment(invoiceId, amount, method, momoNumber, note) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('record_partial_payment', {
      p_invoice_id:  invoiceId,
      p_amount:      amount,
      p_method:      method      || null,
      p_momo_number: momoNumber  || null,
      p_note:        note        || null
    });
  }

  // ── PRODUCT SALES BREAKDOWN ──
  async function loadSalesBreakdown(period, location) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const colMap = { day: 'sale_day', week: 'sale_week', month: 'sale_month' };
    const col = colMap[period] || 'sale_day';
    const now = new Date();
    let from;
    if (period === 'day') {
      from = new Date(now); from.setHours(0,0,0,0);
    } else if (period === 'week') {
      from = new Date(now); from.setDate(now.getDate() - now.getDay());  from.setHours(0,0,0,0);
    } else {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    let q = sb.from('product_sales_summary')
      .select('product_name, qty_sold, unit_price, revenue, location')
      .gte(col, from.toISOString());

    if (location && location !== 'All') q = q.eq('location', location);

    const { data, error } = await q.order('revenue', { ascending: false });
    if (error) throw error;

    // Aggregate by product name (multiple price points possible)
    const map = {};
    (data || []).forEach(row => {
      const k = row.product_name;
      if (!map[k]) map[k] = { name: k, qty: 0, revenue: 0, price: Number(row.unit_price||0) };
      map[k].qty     += Number(row.qty_sold || 0);
      map[k].revenue += Number(row.revenue  || 0);
    });
    return Object.values(map).sort((a,b) => b.revenue - a.revenue);
  }

  // ── OUTSTANDING BALANCES ──
  async function loadOutstandingBalances(location) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    let q = sb.from('outstanding_balances')
      .select('id, number, customer_name, customer_phone, location, total, amount_paid, balance, created_at');
    if (location && location !== 'All') q = q.eq('location', location);
    const { data, error } = await q.order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(row => ({
      id:           row.id,
      number:       row.number,
      customerName: row.customer_name,
      customerPhone:row.customer_phone || '',
      location:     row.location,
      total:        Number(row.total       || 0),
      amountPaid:   Number(row.amount_paid || 0),
      balance:      Number(row.balance     || 0),
      createdAt:    row.created_at ? new Date(row.created_at).getTime() : Date.now()
    }));
  }

  async function createStaffAccount(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.functions.invoke('create-staff-account', { body: payload });
    if (error) throw error;
    return data;
  }

  async function completePasswordChange() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('complete_password_change');
  }

  async function importProducts(products, options = {}) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('import_products', {
      p_products:        products,
      p_stock_target:    options.stockTarget    || 'both',
      p_default_category:options.defaultCategory|| 'General',
      p_default_reorder: options.defaultReorder || 5,
      p_replace_stock:   options.replaceStock   === true
    });
  }

  async function logAudit(action, detail) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('log_audit', { p_action: action, p_detail: detail });
  }

  window.LumodaSupabase = {
    init, getClient, isConfigured,
    getSession, getProfile, getProfileByUsername,
    signIn, signOut,
    loadProducts, loadCustomers, loadInvoices, loadProfiles,
    createInvoiceNoStock, softDeleteInvoiceNoStock,
    recordPartialPayment,
    loadSalesBreakdown, loadOutstandingBalances,
    importProducts, logAudit,
    createStaffAccount, completePasswordChange
  };
})();