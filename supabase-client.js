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

  function getClient() {
    return client || init();
  }

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
    return {
      id: row.id,
      name: row.name,
      sku: row.sku || '',
      category: row.category || 'General',
      price: Number(row.price || 0),
      stockAlabar: Number(row.stock_alabar || 0),
      stockMorocco: Number(row.stock_morocco || 0),
      reorder: Number(row.reorder_level || 0)
    };
  }

  function toLocalCustomer(row) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone || '',
      address: row.address || '',
      location: row.location,
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
      .select('id, number, customer_name, customer_phone, customer_address, location, total, status, pay_method, momo_number, notes, created_by, created_at, deleted, deleted_at, deleted_by, invoice_items(id, name, qty, price)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return (data || []).map(row => ({
      id: row.id,
      number: row.number,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerAddress: row.customer_address,
      location: row.location,
      items: (row.invoice_items || []).map(it => ({
        name: it.name,
        qty: it.qty,
        price: Number(it.price || 0),
        total: Number(it.qty || 0) * Number(it.price || 0)
      })),
      total: Number(row.total || 0),
      status: row.status,
      payMethod: row.pay_method,
      momoNumber: row.momo_number,
      notes: row.notes || '',
      createdBy: row.created_by,
      createdByName: row.created_by,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      deleted: !!row.deleted,
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
      p_products: products,
      p_stock_target: options.stockTarget || 'both',
      p_default_category: options.defaultCategory || 'General',
      p_default_reorder: options.defaultReorder || 5,
      p_replace_stock: options.replaceStock === true
    });
  }

  async function logAudit(action, detail) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('log_audit', {
      p_action: action,
      p_detail: detail
    });
  }

  async function createInvoice(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('create_invoice_no_stock', payload);
  }

  async function createInvoiceNoStock(payload) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('create_invoice_no_stock', payload);
  }

  async function softDeleteInvoiceNoStock(invoiceId) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase is not configured.');
    return sb.rpc('soft_delete_invoice_no_stock', { p_invoice_id: invoiceId });
  }

  window.LumodaSupabase = {
    init,
    getClient,
    getSession,
    getProfile,
    getProfileByUsername,
    signIn,
    signOut,
    loadProducts,
    loadCustomers,
    loadInvoices,
    loadProfiles,
    importProducts,
    logAudit,
    createInvoice,
    createInvoiceNoStock,
    softDeleteInvoiceNoStock,
    createStaffAccount,
    completePasswordChange,
    isConfigured
  };
})();