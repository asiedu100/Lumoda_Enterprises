// ============================================================
// LUMODA ENTERPRISE - app.js v2.0
// Security: role-based access, session tokens, auto-logout,
//           login lockout, temp passwords, branch enforcement
// ============================================================

// ---- CONSTANTS ----
const INACTIVITY_MS      = 5 * 60 * 1000;
const WARNING_MS         = 60 * 1000;
const MAX_FAILED_LOGINS  = 5;
const LOCKOUT_MS         = 15 * 60 * 1000;
const TEMP_PW_EXPIRY_MS  = 24 * 60 * 60 * 1000;
// Production auth is handled by Supabase only. No hardcoded admin password is kept in this file.

// ---- STATE ----
let currentUser       = null;
let currentLocation   = 'All';
let editingProductId  = null;
let viewingInvoiceId  = null;
let lineItemCount     = 0;
let invoiceSaving     = false;
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
      {id:'p1', name:'Blender', sku:'BLN-001', category:'Appliances', price:250, stockAlabar:15, stockMorocco:10, reorder:5},
      {id:'p2', name:'Cooking Pot (Large)', sku:'CPL-002', category:'Cookware', price:80, stockAlabar:30, stockMorocco:20, reorder:8},
      {id:'p3', name:'Frying Pan', sku:'FPN-003', category:'Cookware', price:45, stockAlabar:25, stockMorocco:12, reorder:5},
      {id:'p4', name:'Kitchen Knife Set', sku:'KKS-004', category:'Cutlery', price:120, stockAlabar:8, stockMorocco:4, reorder:5},
      {id:'p5', name:'Mixing Bowl Set', sku:'MBS-005', category:'Bakeware', price:60, stockAlabar:20, stockMorocco:15, reorder:5},
      {id:'p6', name:'Spatula Set', sku:'SPS-006', category:'Utensils', price:35, stockAlabar:40, stockMorocco:30, reorder:10},
      {id:'p7', name:'Measuring Cups', sku:'MCU-007', category:'Bakeware', price:25, stockAlabar:3, stockMorocco:2, reorder:8},
      {id:'p8', name:'Cutting Board', sku:'CTB-008', category:'Utensils', price:40, stockAlabar:18, stockMorocco:10, reorder:5},
      {id:'p9', name:'Pressure Cooker', sku:'PRC-009', category:'Appliances', price:180, stockAlabar:6, stockMorocco:4, reorder:3},
      {id:'p10', name:'Food Steamer', sku:'FST-010', category:'Appliances', price:95, stockAlabar:2, stockMorocco:1, reorder:5},
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
function getInvoices()     { return (LS.get('lumoda_invoices') || []).filter(i => !i.deleted); }
function getAllInvoices()   { return LS.get('lumoda_invoices') || []; }
function getCustomers()    { return LS.get('lumoda_customers') || []; }
function getProducts()     { return LS.get('lumoda_products') || []; }
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
  const log = LS.get('lumoda_audit') || [];
  log.unshift({ id:'au_'+Date.now(), action, detail, by: currentUser ? currentUser.username : 'system', byName: currentUser ? currentUser.fullName : 'system', createdAt: Date.now() });
  if (log.length > 1000) log.length = 1000;
  LS.set('lumoda_audit', log);
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured() && currentUser) {
    void window.LumodaSupabase.logAudit(action, detail).catch(err => {
      console.warn('Server audit write failed:', err);
    });
  }
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================
function registerSession(user) {
  const token    = genToken();
  const sessions = (SS.get('lumoda_sessions') || []).filter(s => s.username !== user.username);
  sessions.push({ token, username: user.username, fullName: user.fullName, role: user.role, location: user.location, loginAt: Date.now(), lastActivity: Date.now() });
  SS.set('lumoda_sessions', sessions);
  SS.set('lumoda_token', token);
  return token;
}

function getCurrentSession() {
  const token = SS.get('lumoda_token');
  if (!token) return null;
  return getSessions().find(s => s.token === token) || null;
}

function destroySession() {
  const token = SS.get('lumoda_token');
  if (token) {
    const remaining = (SS.get('lumoda_sessions') || []).filter(s => s.token !== token);
    SS.set('lumoda_sessions', remaining);
    try { LS.set('lumoda_sessions', (LS.get('lumoda_sessions')||[]).filter(s=>s.token!==token)); } catch(e) {}
    SS.del('lumoda_token');
  }
}

function updateSessionActivity() {
  const token = SS.get('lumoda_token');
  if (!token) return;
  const sessions = getSessions();
  const idx = sessions.findIndex(s => s.token === token);
  if (idx >= 0) { sessions[idx].lastActivity = Date.now(); LS.set('lumoda_sessions', sessions); }
}

// ============================================================
// INACTIVITY AUTO-LOGOUT
// ============================================================
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);
  clearInterval(countdownInterval);
  document.getElementById('session-warning').style.display = 'none';
  updateSessionActivity();
  warningTimer    = setTimeout(showSessionWarning, INACTIVITY_MS - WARNING_MS);
  inactivityTimer = setTimeout(() => forceLogout('5 minutes of inactivity'), INACTIVITY_MS);
}

function showSessionWarning() {
  let secs = Math.floor(WARNING_MS / 1000);
  document.getElementById('session-warning').style.display = 'flex';
  document.getElementById('session-countdown').textContent = secs;
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    secs--;
    const el = document.getElementById('session-countdown');
    if (el) el.textContent = secs;
    if (secs <= 0) clearInterval(countdownInterval);
  }, 1000);
}

function stayLoggedIn() { resetInactivityTimer(); }

function forceLogout(reason) {
  clearTimeout(inactivityTimer); clearTimeout(warningTimer); clearInterval(countdownInterval);
  if (currentUser) addAudit('Auto Logout', `Session ended — ${reason}`);
  destroySession();
  currentUser = null;
  showAuthScreen();
  toast('You were logged out due to inactivity.', 'error');
}

function startActivityTracking() {
  ['mousemove','keydown','click','touchstart','scroll'].forEach(e => document.addEventListener(e, resetInactivityTimer, { passive:true }));
  resetInactivityTimer();
}
function stopActivityTracking() {
  ['mousemove','keydown','click','touchstart','scroll'].forEach(e => document.removeEventListener(e, resetInactivityTimer));
  clearTimeout(inactivityTimer); clearTimeout(warningTimer); clearInterval(countdownInterval);
}

// ============================================================
// LOGIN
// ============================================================
function supabaseProfileToLocal(profile) {
  return {
    id: profile.id,
    email: profile.email || '',
    username: profile.username,
    fullName: profile.full_name,
    role: profile.role,
    location: profile.location,
    active: profile.active !== false,
    mustChangePassword: !!profile.must_change_password,
    tempPasswordExpiry: null,
    failedLogins: 0,
    lockedUntil: null,
    createdAt: Date.now(),
    createdBy: 'supabase',
    lastLogin: Date.now()
  };
}

async function resolveSupabaseLoginEmail(identifier) {
  if (identifier.includes('@')) return identifier;
  const { data: profile, error } = await window.LumodaSupabase.getProfileByUsername(identifier);
  if (error) throw error;
  if (!profile || !profile.email) {
    throw new Error('This username is not linked to a Supabase account. Ask your administrator to recreate it with an email address.');
  }
  return profile.email;
}

async function syncSupabaseCache() {
  if (!window.LumodaSupabase || !window.LumodaSupabase.isConfigured()) return;
  const [products, customers, invoices] = await Promise.all([
    window.LumodaSupabase.loadProducts(),
    window.LumodaSupabase.loadCustomers().catch(() => []),
    window.LumodaSupabase.loadInvoices().catch(() => [])
  ]);
  LS.set('lumoda_products', products);
  LS.set('lumoda_customers', customers);
  LS.set('lumoda_invoices', invoices);
}

async function doLogin() {
  const username = document.getElementById('auth-user').value.trim().toLowerCase();
  const password = document.getElementById('auth-pass').value;
  const errEl    = document.getElementById('auth-error');
  errEl.style.display = 'none';

  if (!username || !password) { errEl.textContent = 'Please enter your username or email and password.'; errEl.style.display = 'block'; return; }

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const loginEmail = await resolveSupabaseLoginEmail(username);
      const { data, error } = await window.LumodaSupabase.signIn(loginEmail, password);
      if (error) throw error;
      const userId = data?.user?.id;
      if (!userId) throw new Error('Login succeeded, but no Supabase user was returned.');

      const { data: profile, error: profileError } = await window.LumodaSupabase.getProfile(userId);
      if (profileError) throw profileError;
      if (!profile || profile.active === false) throw new Error('Account deactivated or profile missing. Contact your administrator.');

      currentUser = supabaseProfileToLocal(profile);
      currentLocation = currentUser.location;
      currentUser.token = registerSession(currentUser);
  setAutoLoginAllowed(!!document.getElementById('remember-login')?.checked);
      await syncSupabaseCache();
      addAudit('Login', `"${currentUser.fullName}" signed in with Supabase [${currentUser.location}]`);
      showApp();
      return;
    } catch (err) {
      errEl.textContent = err.message || 'Supabase login failed.';
      errEl.style.display = 'block';
      return;
    }
  }

  errEl.textContent = 'Supabase is not configured on this deployment. Please check that supabase-config.js is uploaded and loading correctly.';
  errEl.style.display = 'block';
}

// ============================================================
// FORCED PASSWORD CHANGE (first login)
// ============================================================
function showChangePwScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('change-pw-screen').style.display = 'flex';
  document.getElementById('change-pw-name').textContent = 'Welcome, ' + currentUser.fullName.split(' ')[0] + '!';
  document.getElementById('new-pw').value = ''; document.getElementById('confirm-pw').value = '';
  document.getElementById('change-pw-error').style.display = 'none';
}

function doChangePassword() {
  const np  = document.getElementById('new-pw').value;
  const cp  = document.getElementById('confirm-pw').value;
  const err = document.getElementById('change-pw-error');
  err.style.display = 'none';
  if (np.length < 6) { err.textContent = 'Password must be at least 6 characters.'; err.style.display = 'block'; return; }
  if (np !== cp)     { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    (async () => {
      try {
        const sb = window.LumodaSupabase.getClient();
        const { error: updateError } = await sb.auth.updateUser({ password: np });
        if (updateError) throw updateError;
        const { error: profileError } = await window.LumodaSupabase.completePasswordChange();
        if (profileError) throw profileError;
        currentUser.mustChangePassword = false;
        addAudit('Password Changed', `"${currentUser.fullName}" set new password after first login`);
        document.getElementById('change-pw-screen').style.display = 'none';
        showApp(); toast('Password set. Welcome to LUMODA!');
      } catch (error) {
        err.textContent = error.message || 'Could not update your password.';
        err.style.display = 'block';
      }
    })();
    return;
  }
  err.textContent = 'Supabase is not configured. Password changes must be handled through Supabase Auth.';
  err.style.display = 'block';
}

// ============================================================
// LOGOUT
// ============================================================
async function doLogout() {
  if (!confirm('Sign out of LUMODA ENTERPRISE?')) return;
  addAudit('Logout', `"${currentUser.fullName}" signed out`);
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try { await window.LumodaSupabase.signOut(); } catch (e) {}
  }
  destroySession(); stopActivityTracking(); currentUser = null; showAuthScreen();
}

function showAuthScreen(clear = true) {
  document.getElementById('app').style.display = 'none';
  document.getElementById('change-pw-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('session-warning').style.display = 'none';
  if (clear) { document.getElementById('auth-user').value = ''; document.getElementById('auth-pass').value = ''; document.getElementById('auth-error').style.display = 'none'; }
}

function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('change-pw-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  updateUserUI(); buildNavForRole(); 
  const startPage = (currentUser && currentUser.role === 'warehouse_manager') ? 'warehouse' : 'dashboard';
  navigate(startPage, null); 
  startActivityTracking();
}

// ============================================================
// ROLE-BASED ACCESS
// ============================================================
function isAdmin() {
  if (!currentUser || currentUser.role !== 'admin') return false;
  const session = getCurrentSession();
  return !!session && session.username === currentUser.username && session.role === 'admin';
}
function requireAdmin(action) {
  if (!isAdmin()) {
    toast('Only admin can ' + action, 'error');
    return false;
  }
  return true;
}

function buildNavForRole() {
  const admin = isAdmin();
  const warehouseManager = currentUser && currentUser.role === 'warehouse_manager';

  if (warehouseManager) {
    // Warehouse manager sees ONLY warehouse page
    ['dashboard','invoices','customers','products','stockhistory','reports','audit','users'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'none';
    });
    const warehouseNav = document.getElementById('nav-warehouse');
    if (warehouseNav) warehouseNav.style.display = 'flex';
    document.getElementById('loc-filter').style.display = 'none';
    currentLocation = currentUser.location; // warehouse_manager has 'All' location
  } else if (admin) {
    // Admin sees all business pages, including warehouse
    ['reports','audit','users'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'flex';
    });
    ['dashboard','invoices','customers','products','stockhistory'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'flex';
    });
    const warehouseNav = document.getElementById('nav-warehouse');
    if (warehouseNav) warehouseNav.style.display = 'flex';
    document.getElementById('loc-filter').style.display = 'flex';
  } else {
    // Staff sees core pages only (no admin, warehouse, or reports)
    ['reports','audit','users','warehouse'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'none';
    });
    ['dashboard','invoices','customers','products','stockhistory'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'flex';
    });
    document.getElementById('loc-filter').style.display = 'none';
    currentLocation = currentUser.location;
  }
}

function filterByLoc(arr) {
  const loc = isAdmin() ? currentLocation : currentUser.location;
  if (loc === 'All') return arr;
  return arr.filter(i => i.location === loc);
}

// ============================================================
// USER UI
// ============================================================
function updateUserUI() {
  if (!currentUser) return;
  const u          = currentUser;
  const firstName  = u.fullName.split(' ')[0];
  const initials   = u.fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('topbar-username').textContent = u.fullName;
  document.getElementById('topbar-avatar').textContent   = initials;
  document.getElementById('sidebar-user-info').textContent = '@' + u.username + ' · ' + u.location;
  document.getElementById('loc-name').textContent = u.location;
  const hr    = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const el    = document.getElementById('dash-greeting');
  if (el) el.textContent = greet + ', ' + firstName + ' 👋';
  const dateEl = document.getElementById('dash-date');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) + ' · ' + u.location;
  }
  const roleEl = document.getElementById('topbar-role');
  if (roleEl) { roleEl.textContent = u.role === 'admin' ? 'Admin' : u.location; roleEl.style.background = u.role === 'admin' ? 'var(--brand-red)' : 'var(--brand-brown)'; }
}

// ============================================================
// NAVIGATION
// ============================================================
function navigate(page, el) {
  if (!isAdmin() && ['reports','audit','users'].includes(page)) { toast('Access denied', 'error'); return; }
  if (currentUser && currentUser.role === 'warehouse_manager' && page !== 'warehouse' && page !== 'settings') { toast('Access denied', 'error'); return; }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.classList.add('active');
  if (el) el.classList.add('active');
  else document.querySelector('.nav-item[data-page="' + page + '"]')?.classList.add('active');
  const titles = { dashboard:'Dashboard', invoices:'Invoices', customers:'Customers', products:'Products', warehouse:'Warehouse', stockhistory:'Stock History', reports:'Reports', audit:'Audit Log', users:'User Management' };
  document.getElementById('page-title').textContent = titles[page] || page;
  renderPage(page);
}

function renderPage(page) {
  ({
    dashboard: renderDashboard,
    invoices: renderInvoices,
    customers: renderCustomers,
    products: renderProducts,
    warehouse: renderWarehouse,
    stockhistory: renderStockHistory,
    reports: renderReports,
    audit: renderAuditLog,
    users: renderUsers
  })[page]?.();
}

function switchLocFilter(loc, el) {
  if (!isAdmin()) return;
  document.querySelectorAll('.loc-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active'); currentLocation = loc; refreshAll();
}

function refreshAll() {
  const ap = document.querySelector('.page.active');
  if (ap) renderPage(ap.id.replace('page-', ''));
}

// ============================================================
// FORMAT
// ============================================================
function fmtGHS(n)    { return 'GH₵ ' + Number(n).toLocaleString('en', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
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
// Simple HTML escape for user-supplied strings to reduce XSS risk
function escapeHtml(v){
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function autoLoginAllowed() {
  return LS.get('lumoda_allow_auto_login') === '1';
}
function setAutoLoginAllowed(enabled) {
  if (enabled) LS.set('lumoda_allow_auto_login', '1');
  else LS.del('lumoda_allow_auto_login');
}
function sumInvoiceTotal(invoices) {
  return invoices.reduce((sum, invoice) => sum + invoice.total, 0);
}
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
// DASHBOARD
// ============================================================
function renderDashboard() {
  updateUserUI();
  const invoices   = filterByLoc(getInvoices());
  const now        = new Date();
  const today      = startOfLocalDay(now);
  const weekStart  = startOfWeek(now);
  const nextWeek   = new Date(weekStart); nextWeek.setDate(nextWeek.getDate() + 7);
  const prevWeek   = new Date(weekStart); prevWeek.setDate(prevWeek.getDate() - 7);
  const todayInvs  = invoices.filter(i => asTimestamp(i.createdAt) >= today);
  const weekInvs   = invoices.filter(i => {
    const createdAt = asTimestamp(i.createdAt);
    return createdAt >= weekStart && createdAt < nextWeek;
  });
  const lastWeekInvs = invoices.filter(i => {
    const createdAt = asTimestamp(i.createdAt);
    return createdAt >= prevWeek && createdAt < weekStart;
  });
  const pendingInvs = invoices.filter(i => i.status==='pending'||i.status==='partial');
  const weekTotal = sumInvoiceTotal(weekInvs);
  const lastWeekTotal = sumInvoiceTotal(lastWeekInvs);

  document.getElementById('stat-today').textContent     = fmtGHS(sumInvoiceTotal(todayInvs));
  document.getElementById('stat-today-d').textContent   = todayInvs.length + ' invoice' + (todayInvs.length!==1?'s':'');
  document.getElementById('stat-week').textContent      = fmtGHS(weekTotal);
  document.getElementById('stat-week-d').innerHTML      = weekInvs.length + ' invoices ' + weekComparisonLabel(weekTotal, lastWeekTotal);
  document.getElementById('stat-pending').textContent   = fmtGHS(sumInvoiceTotal(pendingInvs));
  document.getElementById('stat-pending-d').textContent = pendingInvs.length + ' outstanding';
  document.getElementById('stat-customers').textContent = filterByLoc(getCustomers()).length;

  // Recent invoices
  const recent = [...invoices].sort((a,b)=>asTimestamp(b.createdAt)-asTimestamp(a.createdAt)).slice(0,6);
  document.getElementById('dash-recent-body').innerHTML = recent.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:32px">No invoices yet</td></tr>'
    : recent.map(i => '<tr style="cursor:pointer" onclick="viewInvoice(\''+i.id+'\')"><td class="mono">'+i.number+'</td><td>'+i.customerName+'</td><td class="mono">'+fmtGHS(i.total)+'</td><td>'+statusBadge(i.status)+'</td></tr>').join('');

  // Low stock
  const effLoc  = isAdmin() ? currentLocation : currentUser.location;
  const lowStock = getProducts().filter(p => { const s = effLoc==='Morocco'?p.stockMorocco:effLoc==='Alabar'?p.stockAlabar:Math.min(p.stockAlabar,p.stockMorocco); return s <= p.reorder; }).slice(0,6);
  document.getElementById('low-stock-list').innerHTML = lowStock.length === 0
    ? '<div style="padding:32px;text-align:center;color:var(--gray-400);font-size:13px">All products well-stocked ✓</div>'
    : lowStock.map(p => {
        const stock = effLoc==='Morocco'?p.stockMorocco:effLoc==='Alabar'?p.stockAlabar:Math.min(p.stockAlabar,p.stockMorocco);
        const pct   = Math.min(100, Math.round(stock/Math.max(p.reorder*2,1)*100));
        const cls   = stock===0?'critical':'low';
        const adjBtn = isAdmin()?'<button class="btn btn-secondary btn-sm" onclick="openStockAdjust(\''+p.id+'\')">Adjust</button>':'';
        return '<div class="low-stock-item"><div style="flex:1"><div style="font-size:13px;font-weight:500">'+p.name+'</div><div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">Stock: '+stock+' · Reorder: '+p.reorder+'</div><div class="stock-bar-wrap" style="margin-top:6px"><div class="stock-bar '+cls+'" style="width:'+pct+'%"></div></div></div>'+adjBtn+'</div>';
      }).join('');

  // Cash vs MoMo today
  const todayCash = todayInvs.filter(i=>i.payMethod==='cash').reduce((s,i)=>s+i.total,0);
  const todayMomo = todayInvs.filter(i=>i.payMethod==='momo').reduce((s,i)=>s+i.total,0);
  const todayUnspecified = todayInvs.filter(i=>i.status==='paid'&&!i.payMethod).reduce((s,i)=>s+i.total,0);
  const hasPaid = todayCash>0||todayMomo>0||todayUnspecified>0;
  const pmPanel = document.getElementById('dash-pm-panel');
  if (pmPanel) {
    pmPanel.style.display = hasPaid ? 'grid' : 'none';
    const cashEl = document.getElementById('stat-cash');
    const momoEl = document.getElementById('stat-momo');
    if (cashEl) cashEl.textContent = fmtGHS(todayCash);
    if (momoEl) momoEl.textContent = fmtGHS(todayMomo);
  }

  // Active sessions (admin only)
  renderSessionsPanel();
  renderWeeklyChart(invoices);
}

function renderWeeklyChart(invoices) {
  const days = [];
  const { start } = weekRange();
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const total = invoices.filter(inv => {
      const createdAt = asTimestamp(inv.createdAt);
      return createdAt >= day && createdAt < next;
    }).reduce((sum, inv) => sum + inv.total, 0);
    days.push({label:day.toLocaleDateString('en',{weekday:'short'}),total});
  }
  const max = Math.max(...days.map(d=>d.total),1);
  document.getElementById('weekly-chart').innerHTML = days.map(d => { const h=Math.round(d.total/max*100); return '<div class="chart-bar-wrap"><div style="font-size:9px;color:var(--gray-400);font-family:var(--font-mono)">'+(d.total>0?'GH₵'+Math.round(d.total):'')+'</div><div class="chart-bar" style="height:'+h+'px"></div><div class="chart-bar-label">'+d.label+'</div></div>'; }).join('');
}

// ============================================================
// INVOICES
// ============================================================
let invoiceFilter = { text:'', status:'' };

function renderInvoices() {
  let invoices = filterByLoc(getInvoices());
  if (invoiceFilter.text) { const q=invoiceFilter.text.toLowerCase(); invoices=invoices.filter(i=>i.customerName.toLowerCase().includes(q)||i.number.toLowerCase().includes(q)); }
  if (invoiceFilter.status) invoices = invoices.filter(i=>i.status===invoiceFilter.status);
  invoices.sort((a,b)=>asTimestamp(b.createdAt)-asTimestamp(a.createdAt));
  const tbody = document.getElementById('invoices-body');
  tbody.innerHTML = invoices.length===0
  ? '<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:40px">No invoices found</td></tr>'
  : invoices.map(i=>'<tr><td class="mono" style="cursor:pointer" onclick="viewInvoice(\''+i.id+'\')">'+i.number+'</td><td class="mono">'+fmtDate(i.createdAt)+'</td><td>'+i.customerName+'</td><td><span class="badge badge-neutral">'+i.location+'</span></td><td style="color:var(--gray-600)">'+i.items.length+' item'+(i.items.length!==1?'s':'')+'</td><td class="mono" style="font-weight:500">'+fmtGHS(i.total)+'</td><td>'+statusBadge(i.status)+'</td><td>'+(i.payMethod==='cash'?'💵 Cash':i.payMethod==='momo'?'📱 MoMo':'—')+'</td><td style="color:var(--gray-400);font-size:12px">'+(i.createdByName || 'Unknown')+'</td><td><button class="btn btn-secondary btn-sm" onclick="viewInvoice(\''+i.id+'\')">View</button></td></tr>').join('');
}
function filterInvoices(val)      { invoiceFilter.text=val;   renderInvoices(); }
function filterInvoiceStatus(val) { invoiceFilter.status=val; renderInvoices(); }

function openInvoiceModal() {
  lineItemCount = 0;
  document.getElementById('line-items-body').innerHTML = '';
  ['inv-cust-name','inv-cust-phone','inv-cust-addr','inv-notes','inv-momo-number'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('inv-status').value = 'pending';
  document.getElementById('invoice-total-display').textContent = 'Total: GH₵ 0.00';
  const _pmRow  = document.getElementById('payment-method-row');
  const _momoRow = document.getElementById('momo-number-row');
  const _pmCash = document.getElementById('pm-cash');
  const _pmMomo = document.getElementById('pm-momo');
  if (_pmRow)   _pmRow.style.display   = 'none';
  if (_momoRow) _momoRow.style.display = 'none';
  if (_pmCash)  _pmCash.style.cssText  = 'border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;text-align:center';
  if (_pmMomo)  _pmMomo.style.cssText  = 'border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;text-align:center';
  window._selectedPayMethod = '';
  const locSel = document.getElementById('inv-location');
  if (!isAdmin()) { locSel.value = currentUser.location; locSel.disabled = true; } else locSel.disabled = false;
  addLineItem(); openModal('invoice-modal');
}

function onStatusChange() {
  const status  = document.getElementById('inv-status').value;
  const pmRow   = document.getElementById('payment-method-row');
  const momoRow = document.getElementById('momo-number-row');
  if (pmRow)   pmRow.style.display = (status==='paid') ? 'block' : 'none';
  if (status !== 'paid') {
    window._selectedPayMethod = '';
    if (momoRow) momoRow.style.display = 'none';
  }
}

function selectPayMethod(method) {
  window._selectedPayMethod = method;
  const on  = 'border:2px solid var(--brand-brown);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:600;text-align:center;background:var(--gray-50)';
  const off = 'border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;text-align:center';
  document.getElementById('pm-cash').style.cssText = method==='cash' ? on : off;
  document.getElementById('pm-momo').style.cssText = method==='momo' ? on : off;
  document.getElementById('momo-number-row').style.display = method==='momo' ? 'block' : 'none';
}

function addLineItem() {
  const id   = lineItemCount++;
  const opts = getProducts().map(p=>'<option value="'+p.name+'" data-price="'+p.price+'">'+p.name+'</option>').join('');
  const priceLocked = true;
  const priceExtra  = priceLocked ? ' readonly title="Only admin can change prices"' : '';
  const priceBg     = priceLocked ? 'background:var(--gray-50);color:var(--gray-400);cursor:not-allowed;' : '';
  const row  = document.createElement('div');
  row.className = 'line-item-row'; row.id = 'li-'+id;
  row.innerHTML =
    '<input type="text" list="pl-'+id+'" placeholder="Product name" oninput="onLineItemInput('+id+')" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">'+
    '<datalist id="pl-'+id+'">'+opts+'</datalist>'+
    '<input type="number" placeholder="1" min="1" value="1" oninput="calcTotal()" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">'+
    '<input type="number" placeholder="0.00" min="0" step="0.01" oninput="calcTotal()"'+priceExtra+' style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none;'+priceBg+'">'+
    '<button class="remove-item" onclick="removeLineItem('+id+')">×</button>';
  document.getElementById('line-items-body').appendChild(row);
}

function onLineItemInput(id) {
  const row = document.getElementById('li-'+id);
  const ni  = row.querySelector('input[type=text]');
  const pi  = row.querySelectorAll('input')[2];
  const m   = getProducts().find(p=>p.name.toLowerCase()===ni.value.toLowerCase());
  if (m) {
    // Always auto-fill price; staff can't override (field is readonly)
    pi.value = m.price;
  }
  calcTotal();
}

function removeLineItem(id) { const r=document.getElementById('li-'+id); if(r) r.remove(); calcTotal(); }

function calcTotal() {
  let subtotal = 0;

  document.querySelectorAll('#line-items-body .line-item-row').forEach(row => {
    const inp = row.querySelectorAll('input');
    subtotal += (parseFloat(inp[1].value) || 0) * (parseFloat(inp[2].value) || 0);
  });

  const discount = parseFloat(document.getElementById('inv-discount')?.value) || 0;
  const total = Math.max(0, subtotal - discount);

  document.getElementById('invoice-total-display').textContent =
    'Subtotal: ' + fmtGHS(subtotal) +
    ' | Discount: ' + fmtGHS(discount) +
    ' | Total: ' + fmtGHS(total);
}

async function createInvoice()  {
  if (invoiceSaving) return;
  invoiceSaving = true;

  const name   = document.getElementById('inv-cust-name').value.trim();
  const phone  = document.getElementById('inv-cust-phone').value.trim();
  const addr   = document.getElementById('inv-cust-addr').value.trim();
  const loc    = document.getElementById('inv-location').value;
  const status     = document.getElementById('inv-status').value;
  const notes      = document.getElementById('inv-notes').value.trim();
  const discount   = parseFloat(document.getElementById('inv-discount')?.value) || 0;
  const momoEl     = document.getElementById('inv-momo-number');
  const momoNumber = momoEl ? momoEl.value.trim() : '';

  // Validate payment method when paid
if (status === 'paid' && !window._selectedPayMethod) {
  invoiceSaving = false;
  toast('Please select Cash or Mobile Money','error');
  return;
}

const payMethod = status === 'paid' ? (window._selectedPayMethod || '') : '';

if (!name) {
  invoiceSaving = false;
  toast('Customer name is required','error');
  return;
}

const rows = document.querySelectorAll('#line-items-body .line-item-row');

if (rows.length === 0) {
  invoiceSaving = false;
  toast('Add at least one item','error');
  return;
}

const items = [];
let valid = true;

rows.forEach(row => {
  const inp = row.querySelectorAll('input');
  const pn = inp[0].value.trim();
  const qty = parseInt(inp[1].value) || 0;
  const price = parseFloat(inp[2].value) || 0;

  if (!pn || qty < 1 || price <= 0) {
    valid = false;
    return;
  }

  items.push({ name: pn, qty, price, total: qty * price });
});

if (!valid) {
  invoiceSaving = false;
  return;
}
  const subtotal = items.reduce((s,i)=>s+i.total,0);
const total = Math.max(0, subtotal - discount);
const seq   = LS.get('lumoda_invoice_seq')||2388;
const number = String(seq).padStart(6,'0');
LS.set('lumoda_invoice_seq', seq+1);

const invoice = {
  id:'inv_'+Date.now(),
  number,
  customerName:name,
  customerPhone:phone,
  customerAddress:addr,
  location:loc,
  items,
  subtotal,
  discount,
  total,
  status,
  payMethod,
  momoNumber,
  notes,
  createdBy:currentUser.id,
  createdByName:currentUser.fullName,
  createdAt:Date.now(),
  deleted:false
};

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const cachedProducts = getProducts();
      // Build items — product_id is optional, server looks up by name if null
      const p_items = items.map(it => {
        const prod = cachedProducts.find(p => p.name.toLowerCase() === it.name.toLowerCase());
        return {
          product_id: prod ? prod.id : null,
          name:       it.name,
          qty:        it.qty,
          price:      it.price
        };
      });
      const res = await window.LumodaSupabase.createInvoiceNoStock({
        p_customer_name:    name,
        p_location:         loc,
        p_items:            p_items,
        p_customer_phone:   phone    || null,
        p_customer_address: addr     || null,
        p_status:           status,
        p_pay_method:       payMethod || null,
        p_momo_number:      momoNumber || null,
        p_notes:            notes    || null,
        p_discount:         discount || 0
      });
      if (res.error) throw res.error;
await syncSupabaseCache();
addAudit('Invoice Created', currentUser.fullName+' created '+number+' for '+name+' — '+fmtGHS(total)+' ['+loc+']');

invoiceSaving = false;
closeModal('invoice-modal');
toast('Invoice '+number+' created!');

currentLocation = 'All';
renderDashboard();

if (document.getElementById('page-invoices').classList.contains('active')) renderInvoices();

try { navigator.clipboard.writeText(generateInvoiceText(invoice)); } catch(e) {}



return;

} catch (err) {
  console.error('Invoice creation error:', err);

  invoiceSaving = false;
  toast((err.message||'Could not create invoice'), 'error');

  return;
}
}

const invoices = LS.get('lumoda_invoices')||[];
invoices.push(invoice);
LS.set('lumoda_invoices', invoices);

saveCustomerIfNew(name,phone,addr,loc);
addAudit('Invoice Created', currentUser.fullName+' created '+number+' for '+name+' — '+fmtGHS(total)+' ['+loc+']');

invoiceSaving = false;
closeModal('invoice-modal');
toast('Invoice '+number+' created!');

currentLocation = 'All';
renderDashboard();

if (document.getElementById('page-invoices').classList.contains('active')) renderInvoices();

try { navigator.clipboard.writeText(generateInvoiceText(invoice)); } catch(e) {}
}
function viewInvoice(id) {
  viewingInvoiceId = id;
  const inv = getAllInvoices().find(i=>i.id===id);
  if (!inv) return;
  document.getElementById('view-inv-title').textContent = 'Nr: '+inv.number;
  document.getElementById('view-inv-body').innerHTML = buildInvoiceHTML(inv);
  const delBtn = document.getElementById('view-inv-delete');
  delBtn.style.display = isAdmin()&&!inv.deleted ? 'inline-flex':'none';
  delBtn.onclick = () => deleteInvoice(id);
  openModal('view-invoice-modal');
}

function buildInvoiceHTML(inv) {
  const blanks = Array(Math.max(0,6-inv.items.length))
    .fill('<tr><td style="padding:9px 10px">&nbsp;</td><td></td><td></td><td></td></tr>')
    .join('');

  return '<div style="border:2px solid var(--brand-brown);border-radius:var(--radius);overflow:hidden;margin-bottom:14px">' +

    '<div style="background:var(--brand-brown);color:white;padding:8px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
      '<div>' +
        '<div style="font-family:var(--font-serif);font-size:16px;font-weight:600;letter-spacing:.04em">LUMODA ENTERPRISE</div>' +
        '<div style="font-family:var(--font-serif);font-style:italic;font-size:11px;opacity:.8">The cook\\\'s helper</div>' +
        '<div style="font-size:10px;opacity:.7;margin-top:2px">Dealers in All Kinds of Kitchen Accessories</div>' +
      '</div>' +

      '<div style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;white-space:nowrap;align-self:center">MAA LUCY\\\'S PLACE</div>' +

      '<div style="text-align:right;font-size:9px;opacity:.75;font-family:var(--font-mono)">' +
        '<div>LOC 1: Alabar, Ghana Region</div>' +
        '<div>Shop No. OCL/ZR/GF/A20 &amp; A21</div>' +
        '<div>LOC 2: Morocco (K.O) Old Barbers Bldg GF 26</div>' +
        '<div>TEL: 0244369357 / 0546014044 / 0243563481</div>' +
      '</div>' +
    '</div>' +

    '<div style="background:var(--brand-red);color:white;padding:5px 14px;display:flex;justify-content:space-between;align-items:center">' +
      '<div style="font-weight:700;font-size:13px;letter-spacing:.08em">INVOICE</div>' +
      '<div style="font-family:var(--font-mono);font-size:12px">Nr: <strong>'+escapeHtml(inv.number)+'</strong></div>' +
      '<div style="font-family:var(--font-mono);font-size:11px">'+fmtDate(inv.createdAt)+'</div>' +
    '</div>' +

    '<div style="padding:10px 14px;background:var(--white)">' +
      '<div style="display:flex;gap:16px;font-size:13px;flex-wrap:wrap">' +
        '<span style="color:var(--gray-400)">Name:</span><strong>'+escapeHtml(inv.customerName)+'</strong>' +
        (inv.customerPhone
          ? '<span style="color:var(--gray-400)">Tel:</span><span>'+escapeHtml(inv.customerPhone)+'</span>'
          : '') +
      '</div>' +

      (inv.customerAddress
        ? '<div style="font-size:13px;margin-top:4px"><span style="color:var(--gray-400)">Address:</span> '+escapeHtml(inv.customerAddress)+'</div>'
        : '') +
    '</div>' +

    '<table style="margin:0">' +
      '<thead>' +
        '<tr style="background:var(--brand-red)">' +
          '<th style="color:white;padding:8px 10px;font-size:11px;width:56px;text-align:center">QTY</th>' +
          '<th style="color:white;padding:8px 10px;font-size:11px">DESCRIPTION</th>' +
          '<th style="color:white;padding:8px 10px;font-size:11px;text-align:right;width:100px">@ (Unit)</th>' +
          '<th style="color:white;padding:8px 10px;font-size:11px;text-align:right;width:110px">AMOUNT GH₵</th>' +
        '</tr>' +
      '</thead>' +

      '<tbody>' +
        inv.items.map(item =>
          '<tr>' +
            '<td style="text-align:center;padding:9px 10px;font-weight:500">'+escapeHtml(item.qty)+'</td>' +
            '<td style="padding:9px 10px">'+escapeHtml(item.name)+'</td>' +
            '<td style="text-align:right;padding:9px 10px;font-family:var(--font-mono)">'+fmtGHS(item.price)+'</td>' +
            '<td style="text-align:right;padding:9px 10px;font-family:var(--font-mono);font-weight:600">'+fmtGHS(item.total)+'</td>' +
          '</tr>'
        ).join('') +
        blanks +
      '</tbody>' +
    '</table>' +

    // TOTALS SECTION (updated)
    '<div style="display:flex;flex-direction:column;align-items:flex-end;border-top:2px solid var(--brand-brown);padding:10px 14px;gap:6px">' +
      '<div><span style="font-size:13px;color:var(--gray-400)">Subtotal:</span> <span style="font-family:var(--font-mono)">'+fmtGHS(inv.subtotal || inv.total)+'</span></div>' +
      '<div><span style="font-size:13px;color:var(--gray-400)">Discount:</span> <span style="font-family:var(--font-mono)">-'+fmtGHS(inv.discount || 0)+'</span></div>' +
      '<div><span style="font-size:13px;font-weight:500">Total GH₵</span> <span style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--brand-brown)">'+fmtGHS(inv.total)+'</span></div>' +
    '</div>' +

    '<div style="padding:8px 14px;border-top:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;background:var(--gray-50)">' +
      '<span style="font-size:11px;color:var(--gray-400);font-style:italic">Goods sold out are not returnable</span>' +
      statusBadge(inv.status) +
      (inv.payMethod
        ? '&nbsp;&nbsp;<span class="badge badge-neutral">'+(inv.payMethod==='momo'?'📱 Mobile Money':'💵 Cash')+'</span>'
        : '') +
      (inv.momoNumber
        ? '&nbsp;<span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">'+escapeHtml(inv.momoNumber)+'</span>'
        : '') +
    '</div>' +

    '<div style="padding:10px 14px;display:flex;justify-content:space-between;font-size:11px;color:var(--gray-400)">' +
      '<span>Customer\\\'s Signature: _______________</span>' +
      '<span>Manager\\\'s Signature: _______________</span>' +
    '</div>' +

    '<div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">' +
      'Location: '+escapeHtml(inv.location)+' · By: '+escapeHtml(inv.createdByName || 'Unknown')+' · '+fmtDateTime(inv.createdAt) +
    '</div>' +

    (inv.notes
      ? '<div style="margin-top:10px;padding:10px;background:var(--gray-50);border-radius:var(--radius);font-size:13px;color:var(--gray-600)">'+escapeHtml(inv.notes)+'</div>'
      : '') +

    (inv.deleted
      ? '<div style="margin-top:10px;padding:8px 12px;background:#fee2e2;border-radius:var(--radius);font-size:12px;color:#991b1b">⚠ Deleted by '+escapeHtml(inv.deletedBy)+' on '+fmtDateTime(inv.deletedAt)+'</div>'
      : '') +

  '</div>';
}

async function deleteInvoice(id) {
  if (!requireAdmin('delete invoices')) return;
  if (!confirm('Soft-delete this invoice? It remains in the audit trail.')) return;

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const res = await window.LumodaSupabase.softDeleteInvoiceNoStock(id);
      if (res.error) throw res.error;
      await syncSupabaseCache();
      addAudit('Invoice Deleted', currentUser.fullName+' deleted invoice '+id+' [server]');
      closeModal('view-invoice-modal'); toast('Invoice deleted.'); renderPage('invoices');
      return;
    } catch (err) {
      toast(err.message || 'Could not delete invoice', 'error');
      return;
    }
  }

  const invoices = LS.get('lumoda_invoices')||[];
  const idx = invoices.findIndex(i=>i.id===id); if(idx<0) return;
  const inv = invoices[idx];
  invoices[idx]={...inv,deleted:true,deletedAt:Date.now(),deletedBy:currentUser.username};
  LS.set('lumoda_invoices', invoices);
  addAudit('Invoice Deleted', currentUser.fullName+' deleted '+inv.number+' ['+inv.location+']');
  closeModal('view-invoice-modal'); toast('Invoice deleted.'); renderPage('invoices');
}

function copyInvoiceText() {
  const inv = getAllInvoices().find(i=>i.id===viewingInvoiceId); if(!inv) return;
  try { navigator.clipboard.writeText(generateInvoiceText(inv)); toast('Invoice copied!'); } catch(e){ toast('Could not copy','error'); }
}

function generateInvoiceText(inv) {
  const sep = '─'.repeat(52);
  const lines = inv.items.map(item=>String(item.qty).padEnd(5)+' '+item.name.substring(0,24).padEnd(24)+' '+fmtGHS(item.price).padStart(10)+'  '+fmtGHS(item.total).padStart(11)).join('\n');
  return '━'.repeat(52)+'\n  LUMODA ENTERPRISE            MAA LUCY\'S PLACE\n  "The cook\'s helper"\n  Dealers in All Kinds of Kitchen Accessories\n'+'━'.repeat(52)+'\n  LOCATION 1: Alabar, Ghana Region\n             Shop No. OCL/ZR/GF/A20 and A21\n  LOCATION 2: Morocco (K.O) OLD Barbers Building\n             Shop No. GF 26\n  TEL: 0244369357 / 0546014044 / 0243563481\n'+'━'.repeat(52)+'\n\nINVOICE                              Nr: '+inv.number+'\nDate: '+fmtDate(inv.createdAt)+'\n\nName:    '+inv.customerName+(inv.customerPhone?'\nPhone:   '+inv.customerPhone:'')+(inv.customerAddress?'\nAddress: '+inv.customerAddress:'')+'\n\n'+sep+'\nQTY   DESCRIPTION               @ UNIT        AMOUNT GH₵\n'+sep+'\n'+lines+'\n'+sep+'\n                               Total GH₵:  '+fmtGHS(inv.total)+'\n\nStatus: '+inv.status.toUpperCase()+(inv.payMethod?'\\nPayment: '+(inv.payMethod==='momo'?'Mobile Money'+(inv.momoNumber?' ('+inv.momoNumber+')':''):'Cash'):'')+(inv.notes?'\nNotes: '+inv.notes:'')+'\n\nGoods sold out are not returnable.\n\nCustomer\'s Signature: ___________  Manager\'s Signature: ___________';
}


// ============================================================
// CUSTOMERS
// ============================================================
let customerSearchFilter = '';
function renderCustomers() {
  let customers = filterByLoc(getCustomers());
  if (customerSearchFilter) { const q=customerSearchFilter.toLowerCase(); customers=customers.filter(c=>c.name.toLowerCase().includes(q)||(c.phone||'').includes(q)); }
  customers.sort((a,b)=>asTimestamp(b.createdAt)-asTimestamp(a.createdAt));
  const invoices = getInvoices();
  const tbody    = document.getElementById('customers-body');
  tbody.innerHTML = customers.length===0
    ? '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:40px">No customers yet</td></tr>'
    : customers.map(c=>{ const ci=invoices.filter(i=>i.customerName.toLowerCase()===c.name.toLowerCase()&&i.location===c.location); const spent=ci.reduce((s,i)=>s+i.total,0); return '<tr><td style="font-weight:500">'+escapeHtml(c.name)+'</td><td class="mono">'+escapeHtml(c.phone||'—')+'</td><td><span class="badge badge-neutral">'+escapeHtml(c.location)+'</span></td><td class="mono">'+ci.length+'</td><td class="mono">'+fmtGHS(spent)+'</td><td class="mono" style="color:var(--gray-400)">'+fmtDate(c.createdAt)+'</td></tr>'; }).join('');
}
function filterCustomers(val) { customerSearchFilter=val; renderCustomers(); }

function saveCustomerIfNew(name,phone,addr,loc) {
  const customers = getCustomers();
  if (!customers.find(c=>c.name.toLowerCase()===name.toLowerCase()&&c.location===loc)) {
    customers.push({id:'cust_'+Date.now(),name,phone,address:addr,location:loc,createdAt:Date.now()});
    LS.set('lumoda_customers',customers);
    addAudit('Customer Added', currentUser.fullName+' auto-saved "'+name+'" ['+loc+']');
  }
}

function openCustomerModal() {
  document.getElementById('cust-name').value=''; document.getElementById('cust-phone').value=''; document.getElementById('cust-address').value='';
  const ls=document.getElementById('cust-location'); if(!isAdmin()){ls.value=currentUser.location;ls.disabled=true;}else ls.disabled=false;
  openModal('customer-modal');
}
function saveCustomer() {
  const name=document.getElementById('cust-name').value.trim(); const phone=document.getElementById('cust-phone').value.trim(); const addr=document.getElementById('cust-address').value.trim(); const loc=document.getElementById('cust-location').value;
  if (!name){toast('Name required','error');return;}
  const customers=getCustomers();
  if (customers.find(c=>c.name.toLowerCase()===name.toLowerCase()&&c.location===loc)){toast('Customer already exists at this location','error');return;}
  customers.push({id:'cust_'+Date.now(),name,phone,address:addr,location:loc,createdAt:Date.now()});
  LS.set('lumoda_customers',customers);
  addAudit('Customer Added', currentUser.fullName+' added "'+name+'" ['+loc+']');
  closeModal('customer-modal'); toast('Customer saved'); renderCustomers();
}

function suggestCustomers(val) {
  const box = document.getElementById('cust-suggestions');
  if(!val||val.length<2){box.style.display='none';return;}
  const loc=isAdmin()?document.getElementById('inv-location').value:currentUser.location;
  const matches=getCustomers().filter(c=>c.name.toLowerCase().includes(val.toLowerCase())&&c.location===loc).slice(0,5);
  if(matches.length===0){box.style.display='none';return;}
  box.style.display='block';
  box.innerHTML=matches.map(c=>'<div style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--gray-50)" onmousedown="selectCustomerSuggestion(\''+c.name.replace(/'/g,"\\'")+'\'  ,\''+  (c.phone||'').replace(/'/g,"\\'")  +'\',\''+  (c.address||'').replace(/'/g,"\\'")  +'\')" onmouseover="this.style.background=\'var(--gray-50)\'" onmouseout="this.style.background=\'\'"><strong>'+escapeHtml(c.name)+'</strong>'+(c.phone?'<span style="color:var(--gray-400);font-size:11px;margin-left:6px">'+escapeHtml(c.phone)+'</span>':'')+'</div>').join('');
}
function selectCustomerSuggestion(name,phone,addr) { document.getElementById('inv-cust-name').value=name; document.getElementById('inv-cust-phone').value=phone; document.getElementById('inv-cust-addr').value=addr; document.getElementById('cust-suggestions').style.display='none'; }

// ============================================================
// PRODUCTS
// ============================================================
let productSearch = '';
function renderProducts() {
  // Show admin-only buttons
  const csvBtn   = document.getElementById('btn-import-csv');
  const addBtn   = document.getElementById('btn-add-product');
  const orderBtn = document.getElementById('btn-order-stock');
  if (csvBtn)   csvBtn.style.display   = isAdmin() ? 'inline-flex' : 'none';
  if (addBtn)   addBtn.style.display   = isAdmin() ? 'inline-flex' : 'none';
  if (orderBtn) orderBtn.style.display = isAdmin() ? 'inline-flex' : 'none';
  let products = getProducts();
  if(productSearch){const q=productSearch.toLowerCase();products=products.filter(p=>p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q));}
  const effLoc=isAdmin()?currentLocation:currentUser.location;
  document.getElementById('products-body').innerHTML = products.map(p=>{
    const sA=p.stockAlabar,sM=p.stockMorocco,comb=effLoc==='Morocco'?sM:effLoc==='Alabar'?sA:Math.min(sA,sM);
    const adjBtn=isAdmin()?'<button class="btn btn-secondary btn-sm" onclick="openStockAdjust(\''+p.id+'\')">Adjust</button>':'';
    const editBtn=isAdmin()?'<button class="btn btn-secondary btn-sm" onclick="editProduct(\''+p.id+'\')">Edit</button>':'';
    return '<tr><td style="font-weight:500">'+escapeHtml(p.name)+'</td><td class="mono">'+escapeHtml(p.sku)+'</td><td style="color:var(--gray-400)">'+escapeHtml(p.category)+'</td><td class="mono">'+fmtGHS(p.price)+'</td><td class="mono" style="text-align:center;color:'+(sA<=p.reorder?'#dc2626':'inherit')+'">'+sA+'</td><td class="mono" style="text-align:center;color:'+(sM<=p.reorder?'#dc2626':'inherit')+'">'+sM+'</td><td>'+stockBadge(comb,p.reorder)+'</td><td class="mono" style="color:var(--gray-400)">'+p.reorder+'</td><td style="display:flex;gap:6px">'+adjBtn+editBtn+'</td></tr>';
  }).join('');
}
function filterProducts(val){productSearch=val;renderProducts();}
function openProductModal(){if(!requireAdmin('add products'))return;editingProductId=null;document.getElementById('prod-modal-title').textContent='New Product';['prod-name','prod-sku','prod-category','prod-price','prod-stock-alabar','prod-stock-morocco','prod-reorder'].forEach(id=>document.getElementById(id).value='');openModal('product-modal');}
function editProduct(id){if(!requireAdmin('edit products'))return;const prod=getProducts().find(p=>p.id===id);if(!prod)return;editingProductId=id;document.getElementById('prod-modal-title').textContent='Edit Product';document.getElementById('prod-name').value=prod.name;document.getElementById('prod-sku').value=prod.sku;document.getElementById('prod-category').value=prod.category;document.getElementById('prod-price').value=prod.price;document.getElementById('prod-stock-alabar').value=prod.stockAlabar;document.getElementById('prod-stock-morocco').value=prod.stockMorocco;document.getElementById('prod-reorder').value=prod.reorder;openModal('product-modal');}
function saveProduct(){if(!requireAdmin('save products'))return;const name=document.getElementById('prod-name').value.trim();const price=parseFloat(document.getElementById('prod-price').value);if(!name||isNaN(price)){toast('Name and price required','error');return;}const products=getProducts();const sA=parseInt(document.getElementById('prod-stock-alabar').value)||0;const sM=parseInt(document.getElementById('prod-stock-morocco').value)||0;const reorder=parseInt(document.getElementById('prod-reorder').value)||5;const sku=document.getElementById('prod-sku').value.trim()||'SKU-'+Date.now();const cat=document.getElementById('prod-category').value.trim()||'General';if(editingProductId){const idx=products.findIndex(p=>p.id===editingProductId);if(idx>=0){products[idx]={...products[idx],name,sku,category:cat,price,stockAlabar:sA,stockMorocco:sM,reorder};addAudit('Product Updated',currentUser.fullName+' updated "'+name+'" price: '+fmtGHS(price));}}else{products.push({id:'p_'+Date.now(),name,sku,category:cat,price,stockAlabar:sA,stockMorocco:sM,reorder});addAudit('Product Added',currentUser.fullName+' added "'+name+'" @ '+fmtGHS(price));}LS.set('lumoda_products',products);closeModal('product-modal');toast('Product saved');renderProducts();}
function orderStock(){if(!requireAdmin('order stock'))return;const low=getProducts().filter(p=>p.stockAlabar<=p.reorder||p.stockMorocco<=p.reorder);if(low.length===0){toast('No restocking needed');return;}const text='LUMODA ENTERPRISE — Restock Order\n\n'+low.map(p=>'• '+p.name+' ('+p.sku+')\n  Alabar: '+p.stockAlabar+' | Morocco: '+p.stockMorocco+' | Reorder at: '+p.reorder).join('\n');try{navigator.clipboard.writeText(text);toast('Restock list copied');}catch{alert(text);}}

// ============================================================
// STOCK ADJUSTMENT
// ============================================================
let adjustingProductId=null;
function openStockAdjust(pid){if(!requireAdmin('adjust stock'))return;adjustingProductId=pid;const prod=getProducts().find(p=>p.id===pid);if(!prod)return;document.getElementById('stock-prod-name').value=prod.name;document.getElementById('stock-qty').value='';document.getElementById('stock-note').value='';document.getElementById('stock-type').value='Purchase';openModal('stock-modal');}
function applyStockAdjustment(){if(!requireAdmin('adjust stock'))return;const loc=document.getElementById('stock-location').value;const type=document.getElementById('stock-type').value;const qty=parseInt(document.getElementById('stock-qty').value);const note=document.getElementById('stock-note').value.trim();if(isNaN(qty)||qty===0){toast('Enter a valid quantity','error');return;}const products=getProducts();const idx=products.findIndex(p=>p.id===adjustingProductId);if(idx<0)return;const prod=products[idx];const isAdd=['Purchase','Return'].includes(type);const absQty=Math.abs(qty);const change=isAdd?absQty:-absQty;if(loc==='Alabar'){if(!isAdd&&prod.stockAlabar<absQty){toast('Insufficient stock','error');return;}products[idx].stockAlabar=Math.max(0,prod.stockAlabar+change);}else{if(!isAdd&&prod.stockMorocco<absQty){toast('Insufficient stock','error');return;}products[idx].stockMorocco=Math.max(0,prod.stockMorocco+change);}LS.set('lumoda_products',products);addStockHistory(prod.id,prod.name,loc,change,type,note||'Manual '+type);addAudit('Stock Adjusted',currentUser.fullName+' adjusted "'+prod.name+'" '+(change>0?'+':'')+change+' at '+loc+' ('+type+')');closeModal('stock-modal');toast('Stock updated');renderProducts();renderDashboard();}
function addStockHistory(productId,productName,location,change,type,note){const h=getStockHistory();h.unshift({id:'sh_'+Date.now(),productId,productName,location,change,type,note,by:currentUser.username,byName:currentUser.fullName,createdAt:Date.now()});LS.set('lumoda_stockhistory',h);}
function renderStockHistory(){let h=filterByLoc(getStockHistory());h.sort((a,b)=>asTimestamp(b.createdAt)-asTimestamp(a.createdAt));document.getElementById('stockhistory-body').innerHTML=h.length===0?'<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:40px">No stock history yet</td></tr>':h.map(x=>'<tr><td class="mono">'+fmtDateTime(x.createdAt)+'</td><td><span class="badge badge-neutral">'+escapeHtml(x.type)+'</span></td><td>'+escapeHtml(x.productName)+'</td><td>'+escapeHtml(x.location)+'</td><td class="mono" style="color:'+(x.change>0?'#16a34a':'#dc2626')+'">'+(x.change>0?'+':'')+x.change+'</td><td>'+escapeHtml(x.note||'—')+'</td><td>'+escapeHtml(x.byName||x.by)+'</td></tr>').join('');}
function filterStockHistory(val){const q=val.toLowerCase();document.querySelectorAll('#stockhistory-body tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');}

// ============================================================
// REPORTS
// ============================================================
function renderReports(){if(!isAdmin())return;const invoices=filterByLoc(getInvoices());const now=new Date();const today=startOfLocalDay(now);const weekStart=startOfWeek(now);const nextWeek=new Date(weekStart);nextWeek.setDate(nextWeek.getDate()+7);const prevWeek=new Date(weekStart);prevWeek.setDate(prevWeek.getDate()-7);const monthStart=new Date(now.getFullYear(),now.getMonth(),1);const todayTotal=sumInvoiceTotal(invoices.filter(i=>asTimestamp(i.createdAt)>=today));const weekTotal=sumInvoiceTotal(invoices.filter(i=>{const t=asTimestamp(i.createdAt);return t>=weekStart&&t<nextWeek;}));const lastWeekTotal=sumInvoiceTotal(invoices.filter(i=>{const t=asTimestamp(i.createdAt);return t>=prevWeek&&t<weekStart;}));const monthTotal=sumInvoiceTotal(invoices.filter(i=>asTimestamp(i.createdAt)>=monthStart));const allTotal=sumInvoiceTotal(invoices);document.getElementById('rep-today').textContent=fmtGHS(todayTotal);document.getElementById('rep-week').textContent=fmtGHS(weekTotal);document.getElementById('rep-last-week').textContent=fmtGHS(lastWeekTotal);document.getElementById('rep-week-delta').innerHTML=weekComparisonLabel(weekTotal,lastWeekTotal);document.getElementById('rep-month').textContent=fmtGHS(monthTotal);document.getElementById('rep-alltime').textContent=fmtGHS(allTotal);renderPaymentBreakdown(invoices);renderLocationBreakdown(invoices);renderTopProducts(invoices);renderMonthlyChart(invoices);}
function renderPaymentBreakdown(invoices){const paid=invoices.filter(i=>i.status==='paid');const cash=paid.filter(i=>i.payMethod==='cash').reduce((s,i)=>s+i.total,0);const momo=paid.filter(i=>i.payMethod==='momo').reduce((s,i)=>s+i.total,0);const uns=paid.filter(i=>!i.payMethod).reduce((s,i)=>s+i.total,0);document.getElementById('payment-breakdown').innerHTML='<div style="display:grid;gap:8px"><div class="stat-card" style="padding:10px"><div class="stat-label">Cash</div><div class="stat-value" style="font-size:18px">'+fmtGHS(cash)+'</div></div><div class="stat-card" style="padding:10px"><div class="stat-label">Mobile Money</div><div class="stat-value" style="font-size:18px">'+fmtGHS(momo)+'</div></div><div class="stat-card" style="padding:10px"><div class="stat-label">Unspecified Paid</div><div class="stat-value" style="font-size:18px">'+fmtGHS(uns)+'</div></div></div>';}
function renderLocationBreakdown(invoices){const locs=['Alabar','Morocco'];document.getElementById('location-breakdown').innerHTML=locs.map(l=>{const arr=invoices.filter(i=>i.location===l);return '<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-100)"><span>'+l+'</span><strong>'+fmtGHS(sumInvoiceTotal(arr))+'</strong><span class="mono" style="color:var(--gray-400)">'+arr.length+' inv</span></div>';}).join('');}
function renderTopProducts(invoices){const map={};invoices.forEach(inv=>inv.items.forEach(it=>{map[it.name]=(map[it.name]||0)+it.total;}));const top=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);document.getElementById('top-products').innerHTML=top.length?top.map(([n,t],i)=>'<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--gray-100)"><span>'+(i+1)+'. '+escapeHtml(n)+'</span><strong>'+fmtGHS(t)+'</strong></div>').join(''):'<div style="color:var(--gray-400);font-size:13px">No product sales yet</div>';}
function renderMonthlyChart(invoices){const months=[];const now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const next=new Date(d.getFullYear(),d.getMonth()+1,1);const total=invoices.filter(inv=>{const t=asTimestamp(inv.createdAt);return t>=d&&t<next;}).reduce((s,inv)=>s+inv.total,0);months.push({label:d.toLocaleDateString('en',{month:'short'}),total});}const max=Math.max(...months.map(m=>m.total),1);document.getElementById('monthly-chart').innerHTML=months.map(m=>{const h=Math.round(m.total/max*120);return '<div class="chart-bar-wrap"><div style="font-size:9px;color:var(--gray-400);font-family:var(--font-mono)">'+(m.total>0?'GH₵'+Math.round(m.total):'')+'</div><div class="chart-bar" style="height:'+h+'px"></div><div class="chart-bar-label">'+m.label+'</div></div>';}).join('');}



// ============================================================
// SESSIONS PANEL
// ============================================================
function buildSessionsHtml(sessions) {
  return sessions.length
    ? sessions.map(s =>
        '<div style="display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--gray-50)">' +
        '<span><span class="session-dot"></span>' +
        escapeHtml(s.fullName || '') +
        ' <span class="mono">@' +
        escapeHtml(s.username || '') +
        '</span></span>' +
        '<span class="mono" style="color:var(--gray-400)">' +
        escapeHtml(s.location || '') +
        ' · ' +
        fmtAgo(s.lastActivity) +
        '</span></div>'
      ).join('')
    : '<div style="padding:16px;color:var(--gray-400);font-size:13px">No active sessions</div>';
}

function renderSessionsPanel(){
  const panel = document.getElementById('active-sessions-panel');

  if (panel && !isAdmin()) {
    panel.style.display = 'none';
    return;
  }

  if (panel) panel.style.display = 'block';

  const sessions = getSessions();

  const countEl = document.getElementById('active-sessions-count');
  if (countEl) countEl.textContent = sessions.length + ' active';

  const listEl = document.getElementById('active-sessions-list');

  if (listEl) {
    listEl.innerHTML = buildSessionsHtml(sessions);
  }

  const usersCountEl = document.getElementById('sessions-count-users');
  if (usersCountEl) usersCountEl.textContent = sessions.length + ' active';

  const usersListEl = document.getElementById('sessions-list-users');
  if (usersListEl) usersListEl.innerHTML = buildSessionsHtml(sessions);
}

// ============================================================
// USER MANAGEMENT (admin only)
// ============================================================
async function renderUsers() {
  if(!isAdmin()){navigate('dashboard',null);return;}
  renderSessionsPanel();
  const sessions=getSessions();
  let users=getUsers();
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const profiles = await window.LumodaSupabase.loadProfiles();
      users = profiles.map(profile => ({
        id: profile.id,
        email: profile.email || '',
        username: profile.username,
        fullName: profile.full_name,
        role: profile.role,
        location: profile.location,
        active: profile.active !== false,
        mustChangePassword: !!profile.must_change_password,
        lockedUntil: null,
        lastLogin: null
      }));
    } catch (error) {
      console.warn('Could not load Supabase profiles for the users page.', error);
    }
  }

  document.getElementById('users-body').innerHTML = users.map(u => {
  const online = sessions.some(s => s.username === u.username);
  const locked = u.lockedUntil && Date.now() < u.lockedUntil;
  const status = !u.active
    ? '<span class="badge badge-danger">Inactive</span>'
    : locked
    ? '<span class="badge badge-warning">Locked</span>'
    : u.mustChangePassword
    ? '<span class="badge badge-info">Temp PW</span>'
    : online
    ? '<span class="badge badge-success">● Online</span>'
    : '<span class="badge badge-neutral">Offline</span>';

  let actions = '';

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    if (u.role !== 'admin') {
      actions =
        '<button class="btn btn-secondary btn-sm" onclick="toggleSupabaseUserActive(\'' + u.id + '\', ' + u.active + ')">' +
        (u.active ? 'Deactivate' : 'Activate') +
        '</button>';
    } else {
      actions = '<span style="font-size:11px;color:var(--gray-400)">System admin</span>';
    }
  } else if (u.id === 'u_admin') {
    actions = '<span style="font-size:11px;color:var(--gray-400)">System admin</span>';
  } else {
    actions =
      '<button class="btn btn-secondary btn-sm" onclick="resetUserPassword(\'' + u.id + '\')">Reset PW</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="toggleUserActive(\'' + u.id + '\')">' +
      (u.active ? 'Deactivate' : 'Activate') +
      '</button>' +
      (locked ? '<button class="btn btn-secondary btn-sm" onclick="unlockUser(\'' + u.id + '\')">Unlock</button>' : '');
  }

  return '<tr>' +
    '<td><div style="font-weight:500">' + escapeHtml(u.fullName) + '</div></td>' +
    '<td><span class="mono">@' + escapeHtml(u.username) + '</span></td>' +
    '<td><span class="badge ' + (u.role === 'admin' ? 'badge-neutral' : 'badge-info') + '">' + escapeHtml(u.role) + '</span></td>' +
    '<td>' + escapeHtml(u.location) + '</td>' +
    '<td>' + status + '</td>' +
    '<td class="mono" style="color:var(--gray-400);font-size:12px">' + (u.lastLogin ? fmtDateTime(u.lastLogin) : 'Never') + '</td>' +
    '<td style="display:flex;gap:6px;flex-wrap:wrap">' + actions + '</td>' +
  '</tr>';
}).join('');
}
async function toggleSupabaseUserActive(userId, isActive){
  if(!requireAdmin('manage users')) return;

  const sb = window.LumodaSupabase.getClient();

  const { error } = await sb
    .from('profiles')
    .update({ active: !isActive })
    .eq('id', userId);

  if (error) {
    console.error(error);
    toast('Could not update user status', 'error');
    return;
  }

  toast(isActive ? 'User deactivated' : 'User activated');
  renderUsers();
}

function openCreateUserModal(){
  if(!requireAdmin('create users'))return;
  ['new-user-fullname','new-user-username','new-user-email'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('new-user-role').value='staff'; document.getElementById('new-user-location').value='Alabar';
  document.getElementById('create-user-error').style.display='none';
  document.getElementById('new-user-location-row').style.display='flex';
  openModal('create-user-modal');
}

function onNewUserRoleChange(){
  const role = document.getElementById('new-user-role').value;

  document.getElementById('new-user-location-row').style.display =
    (role === 'admin' || role === 'warehouse_manager') ? 'none' : 'flex';
}

function saveNewUser(){
  const fullName=document.getElementById('new-user-fullname').value.trim();
  const username=document.getElementById('new-user-username').value.trim().toLowerCase();
  const email=document.getElementById('new-user-email').value.trim().toLowerCase();
  const role=document.getElementById('new-user-role').value;
  const location =
  (role === 'admin' || role === 'warehouse_manager')
    ? 'All'
    : document.getElementById('new-user-location').value;
  const errEl=document.getElementById('create-user-error'); errEl.style.display='none';
  if(!fullName||!username||!email){errEl.textContent='Full name, username, and email are required.';errEl.style.display='block';return;}
  if(!/^[a-z0-9_]{3,20}$/.test(username)){errEl.textContent='Username: 3–20 chars, letters/numbers/underscore only.';errEl.style.display='block';return;}
  if(!/^\S+@\S+\.\S+$/.test(email)){errEl.textContent='Please enter a valid email address.';errEl.style.display='block';return;}

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    (async () => {
      const actionButton = document.querySelector('#create-user-modal .btn.btn-primary');
      if (actionButton) { actionButton.disabled = true; actionButton.textContent = 'Creating...'; }
      try {
        console.log('Creating user payload:', {
  email,
  username,
  fullName,
  role,
  location
});

const result = await window.LumodaSupabase.createStaffAccount({
  email,
  username,
  fullName,
  role,
  location
});
        addAudit('User Created', currentUser.fullName+' created Supabase account for "'+fullName+'" (@'+username+') ['+location+']');
        closeModal('create-user-modal');
        renderUsers();
        showTempPasswordModal(fullName, username, result.tempPassword, location);
        const emailEl = document.getElementById('temp-email-display');
        if (emailEl) emailEl.textContent = result.profile?.email || email;
      } catch (error) {
        errEl.textContent = error.message || 'Could not create Supabase user.';
        errEl.style.display = 'block';
      } finally {
        if (actionButton) { actionButton.disabled = false; actionButton.textContent = 'Create Account'; }
      }
    })();
    return;
  }
  const users=getUsers();
  if(users.find(u=>u.username===username)){errEl.textContent='Username already taken.';errEl.style.display='block';return;}
  const tempPw='LM'+Math.random().toString(36).substring(2,8).toUpperCase();
  users.push({id:'u_'+Date.now(),email,username,fullName,role,location,passwordHash:hashPw(tempPw),active:true,mustChangePassword:true,tempPasswordExpiry:Date.now()+TEMP_PW_EXPIRY_MS,failedLogins:0,lockedUntil:null,createdAt:Date.now(),createdBy:currentUser.username,lastLogin:null});
  LS.set('lumoda_users',users);
  addAudit('User Created',currentUser.fullName+' created account for "'+fullName+'" (@'+username+') ['+location+']');
  closeModal('create-user-modal'); renderUsers();
  showTempPasswordModal(fullName,username,tempPw,location);
  const emailEl = document.getElementById('temp-email-display');
  if (emailEl) emailEl.textContent = email;
}

function showTempPasswordModal(fullName,username,tempPw,location){
  _lastTempPw = tempPw;
  document.getElementById('temp-pw-display').innerHTML =
    '<div style="margin-bottom:14px;font-size:14px">Account created for <strong>'+escapeHtml(fullName)+'</strong></div>' +
    '<div style="display:grid;grid-template-columns:auto 1fr;gap:9px 16px;font-size:13px;align-items:center;margin-bottom:16px">' +
    '<span style="color:var(--gray-400)">Username</span><strong style="font-family:var(--font-mono)">'+escapeHtml(username)+'</strong>' +
    '<span style="color:var(--gray-400)">Email</span><span id="temp-email-display">—</span>' +
    '<span style="color:var(--gray-400)">Branch</span><span>'+escapeHtml(location)+'</span>' +
    '<span style="color:var(--gray-400)">Temp Password</span>' +
    '<div style="font-family:var(--font-mono);font-size:20px;font-weight:600;color:var(--brand-red);background:var(--gray-50);padding:8px 14px;border-radius:var(--radius);letter-spacing:.1em;border:1px dashed var(--gray-200)">'+escapeHtml(tempPw)+'</div>' +
    '<span style="color:var(--gray-400)">Expires</span><span style="color:#f59e0b;font-size:12px">Within 24 hours</span>' +
    '</div>' +
    '<div style="background:#fef9c3;border:1px solid #fde047;border-radius:var(--radius);padding:10px 12px;font-size:12px;color:#854d0e">⚠ Share this directly with the staff member. They must change it on first login. This is the only time it is shown.</div>';
  openModal('temp-pw-modal');
}

function copyTempPw() {
  if (!_lastTempPw) {
    toast('No temporary password to copy', 'error');
    return;
  }

  try {
    navigator.clipboard.writeText(_lastTempPw);
    toast('Temporary password copied');
  } catch (e) {
    toast('Could not copy password', 'error');
  }
}

function resetUserPassword(userId){
  if(!requireAdmin('reset passwords'))return;
  const users=getUsers(); const idx=users.findIndex(u=>u.id===userId); if(idx<0)return;
  const tempPw='LM'+Math.random().toString(36).substring(2,8).toUpperCase();
  users[idx].passwordHash=hashPw(tempPw); users[idx].mustChangePassword=true; users[idx].tempPasswordExpiry=Date.now()+TEMP_PW_EXPIRY_MS; users[idx].failedLogins=0; users[idx].lockedUntil=null;
  LS.set('lumoda_users',users);
  addAudit('Password Reset',currentUser.fullName+' reset password for "'+users[idx].fullName+'"');
  renderUsers(); showTempPasswordModal(users[idx].fullName,users[idx].username,tempPw,users[idx].location);
}

function toggleUserActive(userId){
  if(!requireAdmin('manage users'))return;
  const users=getUsers(); const idx=users.findIndex(u=>u.id===userId); if(idx<0)return;
  users[idx].active=!users[idx].active;
  LS.set('lumoda_users',users);
  if(!users[idx].active){ LS.set('lumoda_sessions',getSessions().filter(s=>s.username!==users[idx].username)); }
  addAudit(users[idx].active?'User Activated':'User Deactivated',currentUser.fullName+' '+(users[idx].active?'activated':'deactivated')+' "'+users[idx].fullName+'"');
  toast(users[idx].fullName+' '+(users[idx].active?'activated':'deactivated'));
  renderUsers();
}

function unlockUser(userId){
  if(!requireAdmin('unlock accounts'))return;
  const users=getUsers(); const idx=users.findIndex(u=>u.id===userId); if(idx<0)return;
  users[idx].lockedUntil=null; users[idx].failedLogins=0;
  LS.set('lumoda_users',users);
  addAudit('Account Unlocked',currentUser.fullName+' unlocked "'+users[idx].fullName+'"');
  toast(users[idx].fullName+' unlocked'); renderUsers();
}

function openChangeMyPassword(){
  document.getElementById('my-new-pw').value=''; document.getElementById('my-confirm-pw').value='';
  document.getElementById('my-pw-error').style.display='none';
  openModal('my-password-modal');
}
function saveMyPassword(){
  const np=document.getElementById('my-new-pw').value; const cp=document.getElementById('my-confirm-pw').value; const err=document.getElementById('my-pw-error'); err.style.display='none';
  if(np.length<6){err.textContent='Minimum 6 characters.';err.style.display='block';return;}
  if(np!==cp){err.textContent='Passwords do not match.';err.style.display='block';return;}
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    (async () => {
      try {
        const sb = window.LumodaSupabase.getClient();
        const { error: updateError } = await sb.auth.updateUser({ password: np });
        if (updateError) throw updateError;
        addAudit('Password Changed', currentUser.fullName+' changed their password');
        closeModal('my-password-modal'); toast('Password updated');
      } catch (error) {
        err.textContent = error.message || 'Could not update your password.';
        err.style.display = 'block';
      }
    })();
    return;
  }
  const users=getUsers(); const idx=users.findIndex(u=>u.id===currentUser.id);
  users[idx].passwordHash=hashPw(np); users[idx].mustChangePassword=false; users[idx].tempPasswordExpiry=null;
  LS.set('lumoda_users',users); currentUser={...users[idx]};
  addAudit('Password Changed',currentUser.fullName+' changed their password');
  closeModal('my-password-modal'); toast('Password updated');
}
// ============================================================
// AUDIT LOG
// ============================================================
function renderAuditLog(){if(!isAdmin())return;const log=LS.get('lumoda_audit')||[];document.getElementById('audit-list').innerHTML=log.length?log.map(a=>'<div class="audit-item"><div class="audit-dot"></div><div><div style="font-size:13px"><strong>'+escapeHtml(a.action)+'</strong> — '+escapeHtml(a.detail)+'</div><div class="audit-meta">'+escapeHtml(a.byName||a.by)+' · '+fmtDateTime(a.createdAt)+'</div></div></div>').join(''):'<div style="padding:40px;text-align:center;color:var(--gray-400)">No audit logs yet</div>';}
function filterAudit(val){const q=val.toLowerCase();document.querySelectorAll('#audit-list .audit-item').forEach(el=>el.style.display=el.textContent.toLowerCase().includes(q)?'':'none');}

// ============================================================
// MODALS
// ============================================================
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// ============================================================
// CSV IMPORT
// ============================================================
let csvRows=[];
function openCsvModal(){if(!requireAdmin('import CSV'))return;csvRows=[];document.getElementById('csv-file-input').value='';document.getElementById('csv-preview').style.display='none';document.getElementById('csv-import-btn').style.display='none';showCsvError('');openModal('csv-modal');}
function showCsvError(msg){const e=document.getElementById('csv-error');if(!e)return;e.textContent=msg;e.style.display=msg?'block':'none';}
function parseCsvLine(line){const out=[];let cur='',inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}else if(ch===','&&!inQ){out.push(cur.trim());cur='';}else cur+=ch;}out.push(cur.trim());return out;}
function parseCsvFile(input){const file=input.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const text=String(reader.result||'');const lines=text.split(/\r?\n/).filter(l=>l.trim());if(lines.length<2)throw new Error('CSV must include headers and at least one product row.');const headers=parseCsvLine(lines[0]).map(h=>h.toLowerCase().replace(/\s+/g,''));const idx={name:headers.indexOf('name'),price:headers.indexOf('price'),sku:headers.indexOf('sku'),category:headers.indexOf('category'),alabar:headers.indexOf('alabarstock'),morocco:headers.indexOf('moroccostock'),reorder:headers.indexOf('reorderlevel')};if(idx.name<0||idx.price<0)throw new Error('Missing required columns: Name and Price.');csvRows=lines.slice(1).map((line,i)=>{const c=parseCsvLine(line);return{name:c[idx.name]||'',price:parseFloat(c[idx.price]||'0'),sku:idx.sku>=0?c[idx.sku]:'',category:idx.category>=0?c[idx.category]:'General',stockAlabar:idx.alabar>=0?parseInt(c[idx.alabar]||'0'):0,stockMorocco:idx.morocco>=0?parseInt(c[idx.morocco]||'0'):0,reorder:idx.reorder>=0?parseInt(c[idx.reorder]||'5'):5,row:i+2};}).filter(r=>r.name);renderCsvPreview();}catch(err){showCsvError(err.message);}};reader.readAsText(file);}
function renderCsvPreview(){document.getElementById('csv-preview').style.display='block';document.getElementById('csv-import-btn').style.display=csvRows.length?'inline-flex':'none';document.getElementById('csv-preview-title').textContent=csvRows.length+' product(s) ready to import';document.getElementById('csv-preview-body').innerHTML=csvRows.map((r,i)=>'<tr><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.sku||'—')+'</td><td>'+escapeHtml(r.category||'General')+'</td><td class="mono">'+fmtGHS(r.price||0)+'</td><td class="mono">'+(r.stockAlabar||0)+'</td><td class="mono">'+(r.stockMorocco||0)+'</td><td class="mono">'+(r.reorder||5)+'</td><td><button class="btn btn-danger btn-sm" onclick="removeCsvRow('+i+')">Remove</button></td></tr>').join('');}
function removeCsvRow(i){csvRows.splice(i,1);renderCsvPreview();}
async function importCsvProducts(){if(!requireAdmin('import products'))return;if(!csvRows.length)return;if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {try {const res = await window.LumodaSupabase.importProducts(csvRows.map(r => ({name: r.name, sku: r.sku, category: r.category || 'General', price: r.price || 0, stock_alabar: r.stockAlabar || 0, stock_morocco: r.stockMorocco || 0, reorder_level: r.reorder || 5})));if (res.error) throw res.error;await syncSupabaseCache();addAudit('CSV Imported', currentUser.fullName+' imported '+csvRows.length+' products [server]');closeModal('csv-modal');toast(csvRows.length+' products imported');renderProducts();return;} catch (err) {showCsvError(err.message || 'Could not import products to Supabase.');return;}}showCsvError('Supabase is not configured. CSV imports are disabled until supabase-config.js loads correctly.');}
function downloadCsvTemplate(){const csv='Name,Price,SKU,Category,AlabarStock,MoroccoStock,ReorderLevel\nExample Product,100,EX-001,General,10,5,3';const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lumoda-products-template.csv';a.click();URL.revokeObjectURL(a.href);}
function exportCSV(){const h=getStockHistory();const csv='Date,Type,Product,Location,Change,Note,By\n'+h.map(x=>[fmtDateTime(x.createdAt),x.type,x.productName,x.location,x.change,x.note,x.byName||x.by].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lumoda-stock-history.csv';a.click();URL.revokeObjectURL(a.href);}

// ============================================================
// MOBILE
// ============================================================
function openSidebar()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebar-overlay').classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('open'); }

// ============================================================
// OFFLINE
// ============================================================
window.addEventListener('offline',()=>document.getElementById('offline-badge').style.display='block');
window.addEventListener('online', ()=>document.getElementById('offline-badge').style.display='none');
if (!navigator.onLine) document.getElementById('offline-badge').style.display = 'block';

// ============================================================
// GLOBAL SEARCH
// ============================================================
function globalSearch(val){ if(val&&/^\d{4,}$/.test(val)){navigate('invoices',null);filterInvoices(val);} }
document.getElementById('global-search')?.addEventListener('input', e => globalSearch(e.target.value.trim()));

// ============================================================
// INIT
// ============================================================
initData();

// ============================================================
// PRINT INVOICE
// ============================================================
function printInvoice() {
  const inv = getAllInvoices().find(i=>i.id===viewingInvoiceId);
  if (!inv) return;
  const pmLine = inv.payMethod ? '<div style="margin-top:6px;font-size:12px"><strong>Payment:</strong> '+(inv.payMethod==='momo'?'Mobile Money'+(inv.momoNumber?' — '+inv.momoNumber:''):'Cash')+'</div>' : '';
  const noteLine = inv.notes ? '<div style="margin-top:6px;font-size:12px"><strong>Notes:</strong> '+inv.notes+'</div>' : '';
  const blanks = Array(Math.max(0,8-inv.items.length)).fill('<tr><td style="padding:8px 6px;border-bottom:1px solid #eee">&nbsp;</td><td style="border-bottom:1px solid #eee"></td><td style="border-bottom:1px solid #eee"></td><td style="border-bottom:1px solid #eee"></td></tr>').join('');
  const rows = inv.items.map(item=>'<tr><td style="text-align:center;padding:8px 6px;border-bottom:1px solid #eee">'+item.qty+'</td><td style="padding:8px 6px;border-bottom:1px solid #eee">'+item.name+'</td><td style="text-align:right;padding:8px 6px;border-bottom:1px solid #eee;font-family:monospace">'+fmtGHS(item.price)+'</td><td style="text-align:right;padding:8px 6px;border-bottom:1px solid #eee;font-family:monospace;font-weight:700">'+fmtGHS(item.total)+'</td></tr>').join('');
  const html = `
    <div style="font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:#000;max-width:600px;margin:0 auto">
      <!-- HEADER -->
      <table width="100%" style="background:#5C2D0A;color:white;padding:10px 14px;margin-bottom:0" cellpadding="0" cellspacing="0"><tr>
        <td><div style="font-size:18px;font-weight:700;letter-spacing:1px">LUMODA ENTERPRISE</div><div style="font-style:italic;font-size:11px;opacity:.85">The cook's helper</div><div style="font-size:10px;opacity:.7">Dealers in All Kinds of Kitchen Accessories</div></td>
        <td align="right"><div style="border:1px solid rgba(255,255,255,.4);padding:3px 10px;font-size:11px;font-weight:700">MAA LUCY'S PLACE</div></td>
      </tr></table>
      <div style="background:#C8291C;color:white;padding:6px 14px;display:flex;justify-content:space-between;font-weight:700;letter-spacing:.08em"><span>INVOICE</span><span>Nr: ${escapeHtml(inv.number)}</span><span>${fmtDate(inv.createdAt)}</span></div>
      <div style="padding:10px 14px;border-left:2px solid #5C2D0A;border-right:2px solid #5C2D0A">
        <div><strong>Name:</strong> ${escapeHtml(inv.customerName)}</div>
        ${inv.customerPhone?'<div><strong>Tel:</strong> '+escapeHtml(inv.customerPhone)+'</div>':''}
        ${inv.customerAddress?'<div><strong>Address:</strong> '+escapeHtml(inv.customerAddress)+'</div>':''}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-left:2px solid #5C2D0A;border-right:2px solid #5C2D0A">
        <thead><tr style="background:#C8291C;color:white"><th style="padding:8px 6px;width:56px">QTY</th><th style="padding:8px 6px;text-align:left">DESCRIPTION</th><th style="padding:8px 6px;text-align:right">@ UNIT</th><th style="padding:8px 6px;text-align:right">AMOUNT GH₵</th></tr></thead>
        <tbody>${rows}${blanks}</tbody>
      </table>
      <div style="border:2px solid #5C2D0A;border-top:0;padding:10px 14px;text-align:right;font-size:16px"><strong>Total GH₵: ${fmtGHS(inv.total)}</strong></div>
      <div style="padding:8px 0;font-size:11px;color:#555">Status: ${escapeHtml(inv.status.toUpperCase())}${pmLine}${noteLine}</div>
      <div style="display:flex;justify-content:space-between;margin-top:30px;font-size:11px"><span>Customer's Signature: _______________</span><span>Manager's Signature: _______________</span></div>
      <div style="margin-top:14px;text-align:center;font-size:10px;color:#666">Goods sold out are not returnable</div>
    </div>`;
  const printArea=document.getElementById('print-area');
  printArea.innerHTML=html;
  window.print();
}

// ============================================================
// INITIAL SESSION RESTORE
// ============================================================
(async function restoreSession(){
  try{
    if(window.LumodaSupabase&&window.LumodaSupabase.isConfigured()&&autoLoginAllowed()){
      const sb=window.LumodaSupabase.getClient();
      const {data}=await sb.auth.getUser();
      const user=data?.user;
      if(user){const {data:profile}=await window.LumodaSupabase.getProfile(user.id);if(profile&&profile.active!==false){currentUser=supabaseProfileToLocal(profile);currentLocation=currentUser.location;currentUser.token=registerSession(currentUser);await syncSupabaseCache();showApp();return;}}
    }
  }catch(e){console.warn('Session restore failed',e);} 
  showAuthScreen();
})();
