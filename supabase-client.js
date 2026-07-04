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
    return sb
      .from('profiles')
      .select('id, email, username, full_name, role, location, active, must_change_password')
      .eq('id', userId)
      .single();
  }

  async function getProfileByUsername(username) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb
      .from('profiles')
      .select('id, email, username, full_name, role, location, active, must_change_password')
      .eq('username', username)
      .maybeSingle();
  }

  function toLocalProduct(row) {
  const retail = Number(row.retail_price ?? row.price ?? 0);
  const wholesale = Number(row.wholesale_price ?? 0);
  const carton = Number(row.carton_price ?? 0);

  return {
    id: row.id,
    name: row.name,
    sku: row.sku || '',
    category: row.category || 'General',

    price: retail,
    retailPrice: retail,
    wholesalePrice: wholesale,
    cartonPrice: carton,

    stockAlabar: Number(row.stock_alabar || 0),
    stockMorocco: Number(row.stock_morocco || 0),
    reorder: Number(row.reorder_level || 0)
  };
}

  function toLocalCustomer(row) {
    return {
      id:        row.id,
      name:      row.name,
      phone:     row.phone    || '',
      address:   row.address  || '',
      location:  row.location,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
    };
  }

  async function loadProducts() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb
      .from('products')
      .select('*')
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
        creator:profiles!invoices_created_by_fkey (full_name, username),
        invoice_items(*),
        invoice_payments(id, amount, method, momo_number, note, created_by, created_at)
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
        name:      it.name,
        priceType: it.sale_type || 'retail',
        qty:       it.qty,
        price:     Number(it.price || 0),
        total:     Number(it.qty || 0) * Number(it.price || 0)
      })),
      subtotal:          Number(row.subtotal || row.total || 0),
      discount:          Number(row.discount || 0),
      total:             Number(row.total || 0),
      status:            row.status,
      payMethod:         row.pay_method         || '',
      momoNumber:        row.momo_number        || '',
      amountPaid:        Number(row.amount_paid || 0),
      balance:           Number(row.balance     || 0),
      partialMethod:     row.partial_method     || '',
      partialMomoNumber: row.partial_momo_number || '',
      payments: (row.invoice_payments || []).map(p => ({
        id:         p.id,
        amount:     Number(p.amount || 0),
        method:     p.method    || '',
        momoNumber: p.momo_number || '',
        note:       p.note      || '',
        by:         p.created_by,
        at:         p.created_at ? new Date(p.created_at).getTime() : Date.now()
      })),
      notes:         row.notes       || '',
      createdBy:     row.created_by,
      createdByName: row.created_by
        ? (row.creator ? row.creator.full_name || row.creator.username || '' : '')
        : '',
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      deleted:   !!row.deleted,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).getTime() : null,
      deletedBy: row.deleted_by || null
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

  async function createInvoiceNoStock(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const rpcItems = (payload.p_items || []).map(it => ({
      product_id: it.product_id || null,
      name:       String(it.name || ''),
      qty:        Number(it.qty  || 0),
      price:      Number(it.price || 0),
      sale_type:  it.sale_type || it.priceType || 'retail'
    }));
    return sb.rpc('create_invoice_no_stock', {
      p_customer_name:    payload.p_customer_name,
      p_location:         payload.p_location,
      p_items:            rpcItems,
      p_customer_phone:   payload.p_customer_phone   || null,
      p_customer_address: payload.p_customer_address || null,
      p_status:           payload.p_status           || 'pending',
      p_pay_method:       payload.p_pay_method       || null,
      p_momo_number:      payload.p_momo_number      || null,
      p_notes:            payload.p_notes            || null,
      p_amount_paid:      payload.p_amount_paid      || 0,
      p_discount:         payload.p_discount         || 0,
      p_partial_method:   payload.p_partial_method   || null,
      p_partial_momo:     payload.p_partial_momo     || null
    });
  }

  async function saveProduct(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    // FIX: Each price is independent — never fall back to retail
    // Use explicit null coalescing so 0 is stored as 0, not overwritten
    const _retail    = Number(payload.retailPrice    ?? payload.price ?? 0);
    const _wholesale = Number(payload.wholesalePrice ?? 0);
    const _carton    = Number(payload.cartonPrice    ?? 0);

    const row = {
      name:            payload.name,
      sku:             payload.sku      || null,
      category:        payload.category || 'General',
      price:           _retail,
      retail_price:    _retail,
      wholesale_price: _wholesale,
      carton_price:    _carton,
      stock_alabar:    Number(payload.stockAlabar  || 0),
      stock_morocco:   Number(payload.stockMorocco || 0),
      reorder_level:   Number(payload.reorder      || 5),
      updated_at:      new Date().toISOString()
    };
    if (payload.id && !String(payload.id).startsWith('p_')) row.id = payload.id;
    const fullRes = await sb.from('products').upsert(row, { onConflict: row.id ? 'id' : 'sku' }).select().single();
    if (!fullRes.error) return fullRes;
    const msg = String(fullRes.error.message || '').toLowerCase();
    if (!msg.includes('retail_price') && !msg.includes('wholesale_price') && !msg.includes('carton_price')) return fullRes;
    const basicRow = { name: row.name, sku: row.sku, category: row.category, price: row.price, stock_alabar: row.stock_alabar, stock_morocco: row.stock_morocco, reorder_level: row.reorder_level, updated_at: row.updated_at };
    if (row.id) basicRow.id = row.id;
    return sb.from('products').upsert(basicRow, { onConflict: basicRow.id ? 'id' : 'sku' }).select().single();
  }

  async function softDeleteInvoiceNoStock(invoiceId) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('soft_delete_invoice_no_stock', { p_invoice_id: invoiceId });
  }

  async function recordPartialPayment(invoiceId, amount, method, momoNumber, note) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('record_partial_payment', {
      p_invoice_id: invoiceId, p_amount: amount, p_method: method || null,
      p_momo_number: momoNumber || null, p_note: note || null
    });
  }

  async function loadSalesBreakdown(period, location) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const colMap = { day: 'sale_day', week: 'sale_week', month: 'sale_month' };
    const col = colMap[period] || 'sale_day';
    const now = new Date();
    let from;
    if (period === 'day') { from = new Date(now); from.setHours(0,0,0,0); }
    else if (period === 'week') { from = new Date(now); from.setDate(now.getDate() - now.getDay()); from.setHours(0,0,0,0); }
    else { from = new Date(now.getFullYear(), now.getMonth(), 1); }
    let q = sb.from('product_sales_summary').select('product_name, qty_sold, unit_price, revenue, location').gte(col, from.toISOString());
    if (location && location !== 'All') q = q.eq('location', location);
    const { data, error } = await q.order('revenue', { ascending: false });
    if (error) throw error;
    const map = {};
    (data || []).forEach(row => {
      const k = row.product_name;
      if (!map[k]) map[k] = { name: k, qty: 0, revenue: 0, price: Number(row.unit_price || 0) };
      map[k].qty     += Number(row.qty_sold || 0);
      map[k].revenue += Number(row.revenue  || 0);
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue);
  }

  async function loadOutstandingBalances(location) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    let q = sb.from('outstanding_balances').select('id, number, customer_name, customer_phone, location, total, amount_paid, balance, created_at');
    if (location && location !== 'All') q = q.eq('location', location);
    const { data, error } = await q.order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id, number: row.number, customerName: row.customer_name,
      customerPhone: row.customer_phone || '', location: row.location,
      total: Number(row.total || 0), amountPaid: Number(row.amount_paid || 0),
      balance: Number(row.balance || 0),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
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
      p_products:         products,
      p_stock_target:     options.stockTarget    || 'both',
      p_default_category: options.defaultCategory || 'General',
      p_default_reorder:  options.defaultReorder  || 5,
      p_replace_stock:    options.replaceStock === true
    });
  }

  // ============================================================
  // FIX BUG 3: logAudit — try RPC first, fallback to direct insert
  // ============================================================
  async function logAudit(action, detail) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');

    // Try the RPC first (in case it exists)
    try {
      const { error } = await sb.rpc('log_audit', { p_action: action, p_detail: detail });
      if (!error) return { error: null };
    } catch (e) {
      // RPC doesn't exist — fall through to direct insert
    }

    // Direct insert into audit_logs table
    // audit_logs columns: id (uuid auto), action, detail, created_by (uuid), created_at
    try {
      const { data: { user } } = await sb.auth.getUser();
      return sb.from('audit_logs').insert({
        action,
        detail,
        created_by: user?.id || null
      });
    } catch (e) {
      console.warn('logAudit direct insert failed:', e);
      return { error: e };
    }
  }

  // ============================================================
  // FIX BUG 3: loadAuditLogs — read from audit_logs table
  // ============================================================
  async function loadAuditLogs() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');

    const { data, error } = await sb
      .from('audit_logs')
      .select('id, action, detail, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    return (data || []).map(row => ({
      id:        row.id,
      action:    row.action    || '',
      detail:    row.detail    || '',
      by:        row.created_by || 'system',
      byName:    row.created_by || 'system',
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
    }));
  }

  // ============================================================
  // FIX BUG 3: logStockHistory — write directly to stock_history table
  // stock_history columns: id, product_id, product_name, location, change, type, created_by, created_at
  // ============================================================
  async function logStockHistory({ productId, productName, location, change, type, note }) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');

    try {
      const { data: { user } } = await sb.auth.getUser();
      return sb.from('stock_history').insert({
        product_id:   productId   || null,
        product_name: productName || '',
        location:     location    || null,
        change:       Number(change || 0),
        type:         type        || 'Manual',
        created_by:   user?.id   || null
      });
    } catch (e) {
      console.warn('logStockHistory failed:', e);
      return { error: e };
    }
  }

  // ============================================================
  // FIX BUG 3: loadStockHistory — read from stock_history table
  // ============================================================
  async function loadStockHistory() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');

    const { data, error } = await sb
      .from('stock_history')
      .select('id, product_id, product_name, location, change, type, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) throw error;

    return (data || []).map(row => ({
      id:          row.id,
      productId:   row.product_id   || '',
      productName: row.product_name || '',
      location:    row.location     || '',
      change:      Number(row.change || 0),
      type:        row.type         || '',
      by:          row.created_by   || '',
      byName:      row.created_by   || '',
      note:        '',
      createdAt:   row.created_at ? new Date(row.created_at).getTime() : Date.now()
    }));
  }

  // ============================================================
  // FIX BUG 1: updateInvoiceNoStock
  // The RPC doesn't exist — use a safe fallback that ONLY touches
  // invoice_items when items are explicitly being changed (not on mark-paid)
  // ============================================================
  async function updateInvoiceNoStock(id, updates) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');

    // Build items ONLY when explicitly editing items (not when marking paid).
    // _itemsChanged=false → pass null → RPC skips invoice_items entirely.
    const rpcItems = updates._itemsChanged
      ? (updates.items || [])
          .filter(it => it.name && Number(it.qty) > 0 && Number(it.price) > 0)
          .map(it => ({
            name:      String(it.name  || ''),
            qty:       Number(it.qty   || 0),
            price:     Number(it.price || 0),
            sale_type: it.priceType || it.sale_type || 'retail'
          }))
      : null;

    const { data, error } = await sb.rpc('update_invoice_no_stock', {
      p_invoice_id:       id,
      p_customer_name:    updates.customerName    || null,
      p_customer_phone:   updates.customerPhone   || null,
      p_customer_address: updates.customerAddress || null,
      p_status:           updates.status          || 'pending',
      p_pay_method:       updates.status === 'paid' ? (updates.payMethod  || null) : null,
      p_momo_number:      updates.status === 'paid' ? (updates.momoNumber || null) : null,
      p_notes:            updates.notes           || null,
      p_subtotal:         updates.subtotal        != null ? Number(updates.subtotal) : null,
      p_total:            updates.total           != null ? Number(updates.total)    : null,
      p_items:            rpcItems
    });

    if (error) {
      console.error('update_invoice_no_stock RPC error:', error);
      return { data: null, error };
    }

    return { data, error: null };
  }

    // ============================================================
  // WAREHOUSE
  // ============================================================
  async function postWarehouseMovementDirect(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.rpc('post_warehouse_movement_direct', {
      p_type:            payload.type,
      p_description:     payload.description     || null,
      p_cartons:         Number(payload.cartons  || 0),
      p_items:           Array.isArray(payload.items) ? payload.items : [],
      p_requisition_no:  payload.requisition_no  || null,
      p_issue_to:        payload.issue_to        || null,
      p_storekeeper:     payload.storekeeper     || null,
      p_supplier:        payload.supplier        || null,
      p_notes:           payload.notes           || null,
      p_created_by_name: payload.created_by_name || null
    });
    if (error) throw error;
    return data;
  }

  async function approveWarehouseMovement(movementId, approved = true, reason = null) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.rpc('approve_warehouse_movement', {
      p_movement_id: movementId, p_approved: approved, p_rejection_reason: reason
    });
    if (error) throw error;
    return data;
  }

  async function loadWarehouseStockBalance() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.from('warehouse_stock_balance').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function saveWarehouseStockOut(payload) { return postWarehouseMovementDirect({ ...payload, type: 'stock_out' }); }
  async function saveWarehouseMovement(payload)  { return postWarehouseMovementDirect(payload); }

  async function saveWarehouseProduct(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.from('warehouse_products').upsert({
      code:              payload.code,
      name:              payload.name,
      category:          payload.category     || 'General',
      reorder_level:     Number(payload.reorder || payload.reorder_level || 0),
      created_by:        payload.created_by   || null,
      created_by_name:   payload.created_by_name || null,
      updated_at:        new Date().toISOString()
    }, { onConflict: 'code' }).select().single();
    if (error) throw error;
    return data;
  }

  async function saveWarehouseSupplier(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.from('warehouse_suppliers').upsert({
      name:            payload.name,
      phone:           payload.phone    || null,
      location:        payload.location || null,
      notes:           payload.notes    || null,
      created_by:      payload.created_by || null,
      created_by_name: payload.created_by_name || null,
      updated_at:      new Date().toISOString()
    }, { onConflict: 'name' }).select().single();
    if (error) throw error;
    return data;
  }

  async function loadWarehouseMovements() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.from('warehouse_movements').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadWarehouseProducts() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.from('warehouse_products').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadWarehouseSuppliers() {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    const { data, error } = await sb.from('warehouse_suppliers').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // ============================================================
  // EXPORT
  // ============================================================
  window.LumodaSupabase = {
    init,
    getClient,
    isConfigured,

    getSession,
    getProfile,
    getProfileByUsername,

    signIn,
    signOut,

    loadProducts,
    loadCustomers,
    loadInvoices,
    loadProfiles,

    createInvoiceNoStock,
    updateInvoiceNoStock,
    softDeleteInvoiceNoStock,
    recordPartialPayment,

    loadSalesBreakdown,
    loadOutstandingBalances,

    importProducts,
    saveProduct,

    // FIX BUG 3: audit + stock history
    logAudit,
    loadAuditLogs,
    logStockHistory,
    loadStockHistory,

    createStaffAccount,
    completePasswordChange,

    // Warehouse
    saveWarehouseStockOut,
    saveWarehouseMovement,
    saveWarehouseProduct,
    saveWarehouseSupplier,
    loadWarehouseMovements,
    loadWarehouseProducts,
    loadWarehouseSuppliers,
    postWarehouseMovementDirect,
    approveWarehouseMovement,
    loadWarehouseStockBalance
  };
})();