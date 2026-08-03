// ============================================================
// LUMODA ENTERPRISE - app.js v2.1 (FIXED)
// Fixes:
//  1. Mark as Paid now reflects immediately in modal
//  2. Newly added products appear in invoice line item search
//  3. Share invoice works on all platforms with fallback
//  4. Removed duplicate restoreSession IIFE (race condition)
//  5. Quantity field starts empty — user types it
//  6. Edit invoice products now show correctly after save
// ============================================================

// ---- CONSTANTS ----
const INACTIVITY_MS      = 5 * 60 * 1000;
const WARNING_MS         = 60 * 1000;
const MAX_FAILED_LOGINS  = 5;
const LOCKOUT_MS         = 15 * 60 * 1000;
const TEMP_PW_EXPIRY_MS  = 24 * 60 * 60 * 1000;

// ---- STATE ----
let currentUser       = null;
let currentLocation   = 'All';
let editingProductId  = null;
let viewingInvoiceId  = null;
let lineItemCount     = 0;
let invoiceSaving     = false;
let editInvoiceSaving = false;
// Single source of truth for branch names. Dropdowns/filter tabs are
// re-rendered from this list (see renderLocationSelects()) instead of each
// hardcoding its own <option> set, so adding a branch here is one line —
// though product stock (stockAlabar/stockMorocco) is still fixed-column and
// NOT covered by this: that needs a real schema migration, not a JS change.
const LOCATIONS = ['Alabar', 'Morocco'];
let inactivityTimer   = null;
let warningTimer      = null;
let countdownInterval = null;
let _lastTempPw       = '';

// ---- LOCAL STORAGE ----
const LS = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: k => localStorage.removeItem(k),
};
const SS = {
  get: k => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)),
  del: k => sessionStorage.removeItem(k),
};

// ---- HASH ----
function hashPw(pw) {
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h) ^ pw.charCodeAt(i);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function legacyHashPw(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) - h + pw.charCodeAt(i)) | 0;
  return h.toString(16);
}

function genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('');
}

function normalizeUser(user, index) {
  const username = String(user.username || '').trim().toLowerCase();
  const role = ['admin', 'warehouse_manager'].includes(user.role) ? user.role : 'staff';
  return {
    id: user.id || (username === 'admin' ? 'u_admin' : 'u_' + (username || index)),
    username,
    fullName: user.fullName || (username === 'admin' ? 'System Administrator' : username.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
    passwordHash: user.passwordHash || null,
    role,
    location: role === 'admin' ? 'All' : (user.location || (username === 'mary' ? 'Morocco' : 'Alabar')),
    active: user.active !== false,
    mustChangePassword: !!user.mustChangePassword,
    tempPasswordExpiry: user.tempPasswordExpiry || null,
    failedLogins: user.failedLogins || 0,
    lockedUntil: user.lockedUntil || null,
    createdAt: user.createdAt || Date.now(),
    createdBy: user.createdBy || 'system',
    lastLogin: user.lastLogin || null,
  };
}

function ensureUsers() {
  let users = LS.get('lumoda_users');
  if (!Array.isArray(users)) {
    users = [];
  } else {
    users = users.map(normalizeUser).filter(u => u.username);
  }
  LS.set('lumoda_users', users);
}

// ============================================================
// DATA INIT
// ============================================================
function initData() {
  if (!LS.get('lumoda_products')) {
    LS.set('lumoda_products', [
      {id:'p1', name:'Blender', sku:'BLN-001', category:'Appliances', price:250, wholesalePrice:220, cartonPrice:200, stockAlabar:15, stockMorocco:10, reorder:5},
      {id:'p2', name:'Cooking Pot (Large)', sku:'CPL-002', category:'Cookware', price:80, wholesalePrice:70, cartonPrice:65, stockAlabar:30, stockMorocco:20, reorder:8},
      {id:'p3', name:'Frying Pan', sku:'FPN-003', category:'Cookware', price:45, wholesalePrice:40, cartonPrice:36, stockAlabar:25, stockMorocco:12, reorder:5},
      {id:'p4', name:'Kitchen Knife Set', sku:'KKS-004', category:'Cutlery', price:120, wholesalePrice:105, cartonPrice:95, stockAlabar:8, stockMorocco:4, reorder:5},
      {id:'p5', name:'Mixing Bowl Set', sku:'MBS-005', category:'Bakeware', price:60, wholesalePrice:52, cartonPrice:48, stockAlabar:20, stockMorocco:15, reorder:5},
      {id:'p6', name:'Spatula Set', sku:'SPS-006', category:'Utensils', price:35, wholesalePrice:30, cartonPrice:27, stockAlabar:40, stockMorocco:30, reorder:10},
      {id:'p7', name:'Measuring Cups', sku:'MCU-007', category:'Bakeware', price:25, wholesalePrice:22, cartonPrice:19, stockAlabar:3, stockMorocco:2, reorder:8},
      {id:'p8', name:'Cutting Board', sku:'CTB-008', category:'Utensils', price:40, wholesalePrice:35, cartonPrice:31, stockAlabar:18, stockMorocco:10, reorder:5},
      {id:'p9', name:'Pressure Cooker', sku:'PRC-009', category:'Appliances', price:180, wholesalePrice:158, cartonPrice:145, stockAlabar:6, stockMorocco:4, reorder:3},
      {id:'p10', name:'Food Steamer', sku:'FST-010', category:'Appliances', price:95, wholesalePrice:83, cartonPrice:76, stockAlabar:2, stockMorocco:1, reorder:5},
    ]);
  }
  if (!LS.get('lumoda_invoices'))      LS.set('lumoda_invoices', []);
  if (!LS.get('lumoda_customers'))     LS.set('lumoda_customers', []);
  if (!LS.get('lumoda_stockhistory'))  LS.set('lumoda_stockhistory', []);
  if (!LS.get('lumoda_audit'))         LS.set('lumoda_audit', []);
  if (!LS.get('lumoda_invoice_seq'))   LS.set('lumoda_invoice_seq', 2388);
  if (!LS.get('lumoda_sessions'))      LS.set('lumoda_sessions', []);
  ensureUsers();
}

function getUsers()        { return LS.get('lumoda_users') || []; }
function getInvoices()     { return (LS.get('lumoda_invoices') || []).filter(i => !i.deleted && !i.isCashSale); }
function getAllInvoices()   { return LS.get('lumoda_invoices') || []; }
function getCashSales()     { return (LS.get('lumoda_invoices') || []).filter(i => !i.deleted && i.isCashSale); }
function getCustomers()    { return LS.get('lumoda_customers') || []; }
function getProducts()     { return normalizeProducts(LS.get('lumoda_products') || []); }
function getStockHistory() { return LS.get('lumoda_stockhistory') || []; }
function getSessions()     { return SS.get('lumoda_sessions') || LS.get('lumoda_sessions') || []; }

// ============================================================
// TOAST
// ============================================================
let toastTimer;
function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ============================================================
// AUDIT
// ============================================================
function addAudit(action, detail) {
  // Always write to localStorage immediately for instant feedback
  const log = LS.get('lumoda_audit') || [];
  log.unshift({
    id: 'au_'+Date.now(),
    action,
    detail,
    by: currentUser ? currentUser.username : 'system',
    byName: currentUser ? currentUser.fullName : 'system',
    createdAt: Date.now()
  });
  if (log.length > 1000) log.length = 1000;
  LS.set('lumoda_audit', log);

  // FIX BUG 3: Write to Supabase audit_logs table directly (not just RPC)
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured() && currentUser) {
    void window.LumodaSupabase.logAudit(action, detail).catch(err => {
      console.warn('Server audit write failed:', err);
    });
  }
}

// NAVIGATION
// ============================================================
function navigate(page, el) {
  if (!isAdmin() && ['reports','audit','users','approvals','warehouses'].includes(page)) { toast('Access denied', 'error'); return; }
  if (currentUser && currentUser.role === 'warehouse_manager' && page !== 'warehouse' && page !== 'settings') { toast('Access denied', 'error'); return; }
  // Warehouse is only for admins and warehouse managers — nav hides it for everyone
  // else, but that alone doesn't stop navigate('warehouse') being called directly.
  if (page === 'warehouse' && !isAdmin() && (!currentUser || currentUser.role !== 'warehouse_manager')) { toast('Access denied', 'error'); return; }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.classList.add('active');
  if (el) el.classList.add('active');
  else document.querySelector('.nav-item[data-page="' + page + '"]')?.classList.add('active');
  const titles = { dashboard:'Dashboard', cashsales:'Cash Sales', invoices:'Invoices', customers:'Customers', products:'Products', warehouse:'Warehouse', warehouses:'Warehouse Locations', stockhistory:'Stock History', reports:'Reports', audit:'Audit Log', users:'User Management', approvals:'Pending Approvals', settings:'Settings' };
  document.getElementById('page-title').textContent = titles[page] || page;
  renderPage(page);
  closeSidebar();
}

function renderPage(page) {
  ({
    dashboard: renderDashboard,
    cashsales: renderCashSales,
    invoices: renderInvoices,
    customers: renderCustomers,
    products: renderProducts,
    warehouse: renderWarehouse,
    warehouses: renderWarehousesPage,
    stockhistory: renderStockHistory,
    reports: renderReports,
    audit: renderAuditLog,
    users: renderUsers,
    approvals: renderApprovals,
    settings: renderSettings
  })[page]?.();
}

function switchLocFilter(loc, el) {
  if (!isAdmin()) return;
  document.querySelectorAll('.loc-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active'); currentLocation = loc; refreshAll();
}

// Keeps the plain location <select>s and the loc-filter tabs in sync with
// LOCATIONS. The HTML ships with matching static <option>s as a sane
// fallback, this just makes them derive from one array going forward.
function renderLocationSelects() {
  const opts = LOCATIONS.map(l => '<option value="'+escAttr(l)+'">'+escapeHtml(l)+'</option>').join('');
  ['inv-location','cust-location','stock-location','new-user-location'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = opts;
    if (LOCATIONS.includes(prev)) el.value = prev;
  });

  const filterEl = document.getElementById('loc-filter');
  if (!filterEl) return;
  const activeLoc = filterEl.querySelector('.loc-tab.active')?.dataset.loc || 'All';
  filterEl.innerHTML = '<div class="loc-tab" data-loc="All" onclick="switchLocFilter(\'All\',this)">All</div>' +
    LOCATIONS.map(l => '<div class="loc-tab" data-loc="'+escAttr(l)+'" onclick="switchLocFilter(\''+l+'\',this)">'+escapeHtml(l)+'</div>').join('');
  const tabs  = Array.from(filterEl.querySelectorAll('.loc-tab'));
  const match = tabs.find(t => t.dataset.loc === activeLoc) || tabs[0];
  if (match) match.classList.add('active');
}

function refreshAll() {
  const ap = document.querySelector('.page.active');
  if (ap) renderPage(ap.id.replace('page-', ''));
}

// ============================================================
// BUSINESS SETTINGS (cached at login by syncSupabaseCache — see auth.js)
// ============================================================
function getBusinessSettings()      { return LS.get('lumoda_business_settings') || null; }
function getCurrencySymbol()        { return getBusinessSettings()?.currency_symbol || 'GH₵'; }
function getDefaultReorderLevel()   { return Number(getBusinessSettings()?.default_reorder_level) || 10; }

// ============================================================
// FORMAT
// ============================================================
function fmtGHS(n)    { return getCurrencySymbol() + ' ' + Number(n).toLocaleString('en', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function fmtDate(ts)  { return new Date(ts).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); }
function fmtDateTime(ts) { return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
function fmtAgo(ts)   { const d = Date.now()-ts, m = Math.floor(d/60000); if (m<1) return 'just now'; if (m<60) return m+'m ago'; const h=Math.floor(m/60); if(h<24) return h+'h ago'; return fmtDate(ts); }
function asTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (value.trim() !== '' && Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
function startOfLocalDay(value = new Date()) {
  const day = new Date(value);
  day.setHours(0,0,0,0);
  return day;
}
function startOfWeek(value = new Date()) {
  const weekStart = startOfLocalDay(value);
  const mondayOffset = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - mondayOffset);
  return weekStart;
}
function weekRange(value = new Date()) {
  const start = startOfWeek(value);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}
function escapeHtml(v){
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function escAttr(v) { return escapeHtml(v); }

function normalizeProduct(p) {
  // FIX: Each price is fully independent — never copy one into another.
  // Read from all possible field names (camelCase from JS, snake_case from Supabase).
  // Only fall back to 0 if genuinely absent — never fall back to retail.
  const retail    = Number(p.retailPrice    ?? p.retail_price    ?? p.price ?? 0);
  const wholesale = Number(p.wholesalePrice ?? p.wholesale_price ?? 0);
  const carton    = Number(p.cartonPrice    ?? p.carton_price    ?? 0);

  return {
    ...p,
    price:          retail,
    retailPrice:    retail,
    wholesalePrice: wholesale,
    cartonPrice:    carton
  };
}
function normalizeProducts(products) { return (products || []).map(normalizeProduct); }

function productPriceForType(product, priceType) {
  // FIX: Return the exact stored price — no fallback to retail.
  // If a price is 0, show 0 so staff know it needs to be set.
  const p = normalizeProduct(product || {});
  if (priceType === 'wholesale') return Number(p.wholesalePrice ?? 0);
  if (priceType === 'carton')    return Number(p.cartonPrice    ?? 0);
  return Number(p.retailPrice ?? p.price ?? 0);
}
function priceTypeLabel(priceType) {
  return priceType === 'wholesale' ? 'Wholesale' : priceType === 'carton' ? 'Carton' : 'Retail';
}
function autoLoginAllowed() { return LS.get('lumoda_allow_auto_login') === '1'; }
function setAutoLoginAllowed(enabled) {
  if (enabled) LS.set('lumoda_allow_auto_login', '1');
  else LS.del('lumoda_allow_auto_login');
}
function sumInvoiceTotal(invoices) { return invoices.reduce((sum, invoice) => sum + invoice.total, 0); }
function weekComparisonLabel(currentTotal, previousTotal) {
  const delta = currentTotal - previousTotal;
  const direction = delta >= 0 ? 'up' : 'down';
  const sign = delta >= 0 ? '+' : '-';
  return '<span class="stat-delta ' + direction + '">' + sign + fmtGHS(Math.abs(delta)) + ' vs last week</span>';
}
function statusBadge(s) {
  const m = { paid:'badge-success', pending:'badge-warning', partial:'badge-info', refunded:'badge-neutral', cancelled:'badge-danger' };
  return '<span class="badge ' + (m[s]||'badge-neutral') + '">' + s + '</span>';
}
function stockBadge(stock, reorder) {
  if (stock === 0) return '<span class="badge badge-danger">Out of Stock</span>';
  if (stock <= reorder) return '<span class="badge badge-warning">Low Stock</span>';
  return '<span class="badge badge-success">In Stock</span>';
}

// ============================================================
// MODALS
// ============================================================
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// ============================================================
// PASSWORD VISIBILITY TOGGLE
// ============================================================
const EYE_ICON     = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_OFF_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/><line x1="1.5" y1="1.5" x2="14.5" y2="14.5"/></svg>';
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type === 'password';
  input.type = showing ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = showing ? EYE_OFF_ICON : EYE_ICON;
    btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
  }
}

// ============================================================
// MOBILE
// ============================================================
function openSidebar()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebar-overlay').classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('open'); }

