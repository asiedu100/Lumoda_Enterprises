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
const DEFAULT_ADMIN_PASSWORD = 'Lumoda@2026';

// ---- STATE ----
let currentUser      = null;
let currentLocation  = 'All';
let editingProductId = null;
let viewingInvoiceId = null;
let lineItemCount    = 0;
let inactivityTimer  = null;
let warningTimer     = null;
let countdownInterval = null;

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
  const role = user.role === 'admin' ? 'admin' : 'staff';
  return {
    id: user.id || (username === 'admin' ? 'u_admin' : 'u_' + (username || index)),
    username,
    fullName: user.fullName || (username === 'admin' ? 'System Administrator' : username.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())),
    passwordHash: user.passwordHash || hashPw(DEFAULT_ADMIN_PASSWORD),
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
  if (!Array.isArray(users) || !users.length) {
    users = [{
      id: 'u_admin',
      username: 'admin',
      fullName: 'System Administrator',
      passwordHash: hashPw(DEFAULT_ADMIN_PASSWORD),
      role: 'admin',
      location: 'All',
      active: true,
      mustChangePassword: false,
      tempPasswordExpiry: null,
      failedLogins: 0,
      lockedUntil: null,
      createdAt: Date.now(),
      createdBy: 'system',
      lastLogin: null,
    }];
  } else {
    users = users.map(normalizeUser).filter(u => u.username);
    if (!users.some(u => u.username === 'admin')) {
      users.unshift(normalizeUser({
        id: 'u_admin',
        username: 'admin',
        fullName: 'System Administrator',
        passwordHash: hashPw(DEFAULT_ADMIN_PASSWORD),
        role: 'admin',
        location: 'All',
        active: true,
      }, 0));
    }
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

  const users = getUsers();
  const user  = users.find(u => u.username.toLowerCase() === username);

  if (!user) { errEl.textContent = 'Account not found. Contact your administrator.'; errEl.style.display = 'block'; return; }
  if (!user.active) { errEl.textContent = 'Account deactivated. Contact your administrator.'; errEl.style.display = 'block'; return; }

  if (user.lockedUntil && Date.now() < user.lockedUntil) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    errEl.textContent = `Account locked for ${mins} more minute${mins !== 1 ? 's' : ''}. Try again later.`;
    errEl.style.display = 'block'; return;
  }
  if (user.tempPasswordExpiry && Date.now() > user.tempPasswordExpiry) {
    errEl.textContent = 'Temporary password expired. Ask your admin to reset your account.';
    errEl.style.display = 'block'; return;
  }
  const passwordHash = hashPw(password);
  const legacyPasswordHash = legacyHashPw(password);
  const validPassword = passwordHash === user.passwordHash || legacyPasswordHash === user.passwordHash;

  if (!validPassword) {
    const idx   = users.findIndex(u => u.id === user.id);
    const fails = (user.failedLogins || 0) + 1;
    users[idx].failedLogins = fails;
    if (fails >= MAX_FAILED_LOGINS) {
      users[idx].lockedUntil  = Date.now() + LOCKOUT_MS;
      users[idx].failedLogins = 0;
      LS.set('lumoda_users', users);
      addAudit('Account Locked', `"${username}" locked after ${MAX_FAILED_LOGINS} failed attempts`);
      errEl.textContent = 'Too many failed attempts. Account locked for 15 minutes.';
    } else {
      LS.set('lumoda_users', users);
      const left = MAX_FAILED_LOGINS - fails;
      errEl.textContent = `Wrong password. ${left} attempt${left !== 1 ? 's' : ''} remaining.`;
    }
    errEl.style.display = 'block'; return;
  }

  // Success
  const idx = users.findIndex(u => u.id === user.id);
  users[idx].failedLogins = 0; users[idx].lockedUntil = null; users[idx].lastLogin = Date.now();
  if (users[idx].passwordHash === legacyPasswordHash) users[idx].passwordHash = passwordHash;
  LS.set('lumoda_users', users);
  currentUser = { ...users[idx] };
  currentLocation = currentUser.location;
  currentUser.token = registerSession(currentUser);
  setAutoLoginAllowed(!!document.getElementById('remember-login')?.checked);
  addAudit('Login', `"${currentUser.fullName}" signed in [${currentUser.location}]`);

  if (currentUser.mustChangePassword) { showAuthScreen(false); showChangePwScreen(); return; }
  showApp();
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
  const users = getUsers();
  const idx   = users.findIndex(u => u.id === currentUser.id);
  users[idx].passwordHash = hashPw(np); users[idx].mustChangePassword = false; users[idx].tempPasswordExpiry = null;
  LS.set('lumoda_users', users);
  currentUser = { ...users[idx] };
  addAudit('Password Changed', `"${currentUser.fullName}" set new password after first login`);
  document.getElementById('change-pw-screen').style.display = 'none';
  showApp(); toast('Password set. Welcome to LUMODA!');
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
  updateUserUI(); buildNavForRole(); navigate('dashboard', null); startActivityTracking();
}

// ============================================================
// ROLE-BASED ACCESS
// ============================================================
function isAdmin() {
  if (!currentUser || currentUser.role !== 'admin') return false;
  const session = getCurrentSession();
  return !!session && session.username === currentUser.username && session.role === 'admin';
}
function requireAdmin(action) { if (!isAdmin()) { toast('Only admin can ' + action, 'error'); return false; } return true; }

function buildNavForRole() {
  const admin = isAdmin();
  ['reports','audit','users'].forEach(page => {
    const el = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (el) el.style.display = admin ? 'flex' : 'none';
  });
  document.getElementById('loc-filter').style.display = admin ? 'flex' : 'none';
  if (!admin) currentLocation = currentUser.location;
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
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.classList.add('active');
  if (el) el.classList.add('active');
  else document.querySelector('.nav-item[data-page="' + page + '"]')?.classList.add('active');
  const titles = { dashboard:'Dashboard', invoices:'Invoices', customers:'Customers', products:'Products', stockhistory:'Stock History', reports:'Reports', audit:'Audit Log', users:'User Management' };
  document.getElementById('page-title').textContent = titles[page] || page;
  renderPage(page);
}

function renderPage(page) {
  ({ dashboard:renderDashboard, invoices:renderInvoices, customers:renderCustomers, products:renderProducts, stockhistory:renderStockHistory, reports:renderReports, audit:renderAuditLog, users:renderUsers })[page]?.();
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
    : invoices.map(i=>'<tr><td class="mono" style="cursor:pointer" onclick="viewInvoice(\''+i.id+'\')">'+i.number+'</td><td class="mono">'+fmtDate(i.createdAt)+'</td><td>'+i.customerName+'</td><td><span class="badge badge-neutral">'+i.location+'</span></td><td style="color:var(--gray-600)">'+i.items.length+' item'+(i.items.length!==1?'s':'')+'</td><td class="mono" style="font-weight:500">'+fmtGHS(i.total)+'</td><td>'+statusBadge(i.status)+'</td><td>'+(i.payMethod==='cash'?'💵 Cash':i.payMethod==='momo'?'📱 MoMo':'—')+'</td><td style="color:var(--gray-400);font-size:12px">'+(i.createdByName||i.createdBy)+'</td><td><button class="btn btn-secondary btn-sm" onclick="viewInvoice(\''+i.id+'\')">View</button></td></tr>').join('');
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
  const priceLocked = !isAdmin();
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
  let total = 0;
  document.querySelectorAll('#line-items-body .line-item-row').forEach(row=>{ const inp=row.querySelectorAll('input'); total+=(parseFloat(inp[1].value)||0)*(parseFloat(inp[2].value)||0); });
  document.getElementById('invoice-total-display').textContent = 'Total: '+fmtGHS(total);
}

async function createInvoice() {
  const name   = document.getElementById('inv-cust-name').value.trim();
  const phone  = document.getElementById('inv-cust-phone').value.trim();
  const addr   = document.getElementById('inv-cust-addr').value.trim();
  const loc    = document.getElementById('inv-location').value;
  const status     = document.getElementById('inv-status').value;
  const notes      = document.getElementById('inv-notes').value.trim();
  const momoEl     = document.getElementById('inv-momo-number');
  const momoNumber = momoEl ? momoEl.value.trim() : '';
  // Validate payment method when paid
  if (status === 'paid' && !window._selectedPayMethod) { toast('Please select Cash or Mobile Money','error'); return; }
  const payMethod = status === 'paid' ? (window._selectedPayMethod || '') : '';
  if (!name) { toast('Customer name is required','error'); return; }
  const rows = document.querySelectorAll('#line-items-body .line-item-row');
  if (rows.length===0) { toast('Add at least one item','error'); return; }
  const items=[]; let valid=true;
  rows.forEach(row=>{ const inp=row.querySelectorAll('input'); const pn=inp[0].value.trim(); const qty=parseInt(inp[1].value)||0; const price=parseFloat(inp[2].value)||0; if(!pn||qty<1||price<=0){valid=false;return;} items.push({name:pn,qty,price,total:qty*price}); });
  if (!valid) return;
  const total = items.reduce((s,i)=>s+i.total,0);
  const seq   = LS.get('lumoda_invoice_seq')||2388;
  const number = String(seq).padStart(6,'0');
  LS.set('lumoda_invoice_seq', seq+1);
  const invoice = { id:'inv_'+Date.now(), number, customerName:name, customerPhone:phone, customerAddress:addr, location:loc, items, total, status, payMethod, momoNumber, notes, createdBy:currentUser.username, createdByName:currentUser.fullName, createdAt:Date.now(), deleted:false };

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const products = getProducts();
      const p_items = items.map(it => {
        const prod = products.find(p => p.name.toLowerCase() === it.name.toLowerCase());
        if (!prod) throw new Error('Product not found: ' + it.name);
        return { product_id: prod.id, qty: it.qty };
      });
      const res = await window.LumodaSupabase.createInvoiceNoStock({
        p_customer_name: name,
        p_location: loc,
        p_items: p_items,
        p_customer_phone: phone || null,
        p_customer_address: addr || null,
        p_status: status,
        p_pay_method: payMethod || null,
        p_momo_number: momoNumber || null,
        p_notes: notes || null
      });
      if (res.error) throw res.error;
      await syncSupabaseCache();
      addAudit('Invoice Created', currentUser.fullName+' created '+number+' for '+name+' — '+fmtGHS(total)+' ['+loc+']');
      closeModal('invoice-modal'); toast('Invoice '+number+' created!');
      currentLocation = 'All'; renderDashboard();
      if (document.getElementById('page-invoices').classList.contains('active')) renderInvoices();
      try { navigator.clipboard.writeText(generateInvoiceText(invoice)); } catch(e) {}
      return;
    } catch (err) {
      toast(err.message || 'Could not create invoice', 'error');
      return;
    }
  }

  const invoices = LS.get('lumoda_invoices')||[]; invoices.push(invoice); LS.set('lumoda_invoices', invoices);
  saveCustomerIfNew(name,phone,addr,loc);
  addAudit('Invoice Created', currentUser.fullName+' created '+number+' for '+name+' — '+fmtGHS(total)+' ['+loc+']');
  closeModal('invoice-modal'); toast('Invoice '+number+' created!');
  currentLocation = 'All'; renderDashboard();
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
  const blanks = Array(Math.max(0,6-inv.items.length)).fill('<tr><td style="padding:9px 10px">&nbsp;</td><td></td><td></td><td></td></tr>').join('');
  return '<div style="border:2px solid var(--brand-brown);border-radius:var(--radius);overflow:hidden;margin-bottom:14px"><div style="background:var(--brand-brown);color:white;padding:8px 14px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px"><div><div style="font-family:var(--font-serif);font-size:16px;font-weight:600;letter-spacing:.04em">LUMODA ENTERPRISE</div><div style="font-family:var(--font-serif);font-style:italic;font-size:11px;opacity:.8">The cook\'s helper</div><div style="font-size:10px;opacity:.7;margin-top:2px">Dealers in All Kinds of Kitchen Accessories</div></div><div style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;white-space:nowrap;align-self:center">MAA LUCY\'S PLACE</div><div style="text-align:right;font-size:9px;opacity:.75;font-family:var(--font-mono)"><div>LOC 1: Alabar, Ghana Region</div><div>Shop No. OCL/ZR/GF/A20 &amp; A21</div><div>LOC 2: Morocco (K.O) Old Barbers Bldg GF 26</div><div>TEL: 0244369357 / 0546014044 / 0243563481</div></div></div><div style="background:var(--brand-red);color:white;padding:5px 14px;display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700;font-size:13px;letter-spacing:.08em">INVOICE</div><div style="font-family:var(--font-mono);font-size:12px">Nr: <strong>'+escapeHtml(inv.number)+'</strong></div><div style="font-family:var(--font-mono);font-size:11px">'+fmtDate(inv.createdAt)+'</div></div><div style="padding:10px 14px;background:var(--white)"><div style="display:flex;gap:16px;font-size:13px;flex-wrap:wrap"><span style="color:var(--gray-400)">Name:</span><strong>'+escapeHtml(inv.customerName)+'</strong>'+(inv.customerPhone?'<span style="color:var(--gray-400)">Tel:</span><span>'+escapeHtml(inv.customerPhone)+'</span>':'')+'</div>'+(inv.customerAddress?'<div style="font-size:13px;margin-top:4px"><span style="color:var(--gray-400)">Address:</span> '+escapeHtml(inv.customerAddress)+'</div>':'')+'</div><table style="margin:0"><thead><tr style="background:var(--brand-red)"><th style="color:white;padding:8px 10px;font-size:11px;width:56px;text-align:center">QTY</th><th style="color:white;padding:8px 10px;font-size:11px">DESCRIPTION</th><th style="color:white;padding:8px 10px;font-size:11px;text-align:right;width:100px">@ (Unit)</th><th style="color:white;padding:8px 10px;font-size:11px;text-align:right;width:110px">AMOUNT GH₵</th></tr></thead><tbody>'+inv.items.map(item=>'<tr><td style="text-align:center;padding:9px 10px;font-weight:500">'+escapeHtml(item.qty)+'</td><td style="padding:9px 10px">'+escapeHtml(item.name)+'</td><td style="text-align:right;padding:9px 10px;font-family:var(--font-mono)">'+fmtGHS(item.price)+'</td><td style="text-align:right;padding:9px 10px;font-family:var(--font-mono);font-weight:600">'+fmtGHS(item.total)+'</td></tr>').join('')+blanks+'</tbody></table><div style="display:flex;justify-content:flex-end;border-top:2px solid var(--brand-brown);padding:10px 14px;gap:12px;align-items:center"><span style="font-size:13px;font-weight:500">Total GH₵</span><span style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--brand-brown)">'+fmtGHS(inv.total)+'</span></div><div style="padding:8px 14px;border-top:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;background:var(--gray-50)"><span style="font-size:11px;color:var(--gray-400);font-style:italic">Goods sold out are not returnable</span>'+statusBadge(inv.status)+(inv.payMethod?'&nbsp;&nbsp;<span class="badge badge-neutral">'+(inv.payMethod==='momo'?'📱 Mobile Money':'💵 Cash')+'</span>':'')+(inv.momoNumber?'&nbsp;<span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">'+escapeHtml(inv.momoNumber)+'</span>':'')+'</div><div style="padding:10px 14px;display:flex;justify-content:space-between;font-size:11px;color:var(--gray-400)"><span>Customer\'s Signature: _______________</span><span>Manager\'s Signature: _______________</span></div></div><div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">Location: '+escapeHtml(inv.location)+' · By: '+escapeHtml(inv.createdByName||inv.createdBy)+' · '+fmtDateTime(inv.createdAt)+'</div>'+(inv.notes?'<div style="margin-top:10px;padding:10px;background:var(--gray-50);border-radius:var(--radius);font-size:13px;color:var(--gray-600)">'+escapeHtml(inv.notes)+'</div>':'')+(inv.deleted?'<div style="margin-top:10px;padding:8px 12px;background:#fee2e2;border-radius:var(--radius);font-size:12px;color:#991b1b">⚠ Deleted by '+escapeHtml(inv.deletedBy)+' on '+fmtDateTime(inv.deletedAt)+'</div>':'');
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
function applyStockAdjustment(){if(!requireAdmin('adjust stock'))return;const loc=document.getElementById('stock-location').value;const type=document.getElementById('stock-type').value;const qty=parseInt(document.getElementById('stock-qty').value);const note=document.getElementById('stock-note').value.trim();if(isNaN(qty)||qty===0){toast('Enter a valid quantity','error');return;}const products=getProducts();const idx=products.findIndex(p=>p.id===adjustingProductId);if(idx<0)return;const prod=products[idx];const isAdd=['Purchase','Return'].includes(type);const absQty=Math.abs(qty);const change=isAdd?absQty:-absQty;if(loc==='Alabar'){if(!isAdd&&prod.stockAlabar<absQty){toast('Insufficient stock','error');return;}products[idx].stockAlabar=Math.max(0,prod.stockAlabar+change);}else{if(!isAdd&&prod.stockMorocco<absQty){toast('Insufficient stock','error');return;}products[idx].stockMorocco=Math.max(0,prod.stockMorocco+change);}LS.set('lumoda_products',products);addStockHistory(prod.id,prod.name,loc,change,type,note||'Manual '+type);addAudit('Stock Adjusted',currentUser.fullName+' adjusted "'+prod.name+'" ['+loc+']: '+(change>0?'+':'')+change+' ('+type+')'+(note?' — '+note:''));closeModal('stock-modal');toast('Stock updated');renderProducts();}
function addStockHistory(productId,productName,location,change,type,note){const h=LS.get('lumoda_stockhistory')||[];h.unshift({id:'sh_'+Date.now(),productId,productName,location,change,type,note,by:currentUser?currentUser.username:'system',byName:currentUser?currentUser.fullName:'system',createdAt:Date.now()});LS.set('lumoda_stockhistory',h);}

// ============================================================
// STOCK HISTORY
// ============================================================
let stockHistorySearch='';
function renderStockHistory(){
  let h=LS.get('lumoda_stockhistory')||[];
  const effLoc=isAdmin()?currentLocation:currentUser.location;
  if(effLoc!=='All') h=h.filter(x=>x.location===effLoc);
  if(stockHistorySearch){const q=stockHistorySearch.toLowerCase();h=h.filter(x=>x.productName.toLowerCase().includes(q)||x.type.toLowerCase().includes(q));}
  const tbody=document.getElementById('stockhistory-body');
  tbody.innerHTML=h.length===0?'<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:40px">No stock history yet</td></tr>':h.slice(0,150).map(x=>{const tb=x.type==='Sale'?'<span class="badge badge-danger">Sale</span>':x.type==='Purchase'?'<span class="badge badge-success">Purchase</span>':x.type==='Return'?'<span class="badge badge-info">Return</span>':'<span class="badge badge-neutral">'+x.type+'</span>';return '<tr><td class="mono">'+fmtDate(x.createdAt)+'</td><td>'+tb+'</td><td style="font-weight:500">'+x.productName+'</td><td><span class="badge badge-neutral">'+x.location+'</span></td><td class="mono" style="font-weight:600;color:'+(x.change>=0?'#16a34a':'#dc2626')+'">'+(x.change>=0?'+':'')+x.change+'</td><td class="mono" style="color:var(--gray-400)">—</td><td class="mono" style="color:var(--gray-400)">—</td><td style="color:var(--gray-400);font-size:12px">'+x.note+'</td><td style="color:var(--gray-400);font-size:12px">'+(x.byName||x.by)+'</td></tr>';}).join('');
}
function filterStockHistory(val){stockHistorySearch=val;renderStockHistory();}
function exportCSV(){if(!requireAdmin('export data'))return;const h=LS.get('lumoda_stockhistory')||[];const rows=[['Date','Type','Product','Location','Change','Note','By']];h.forEach(x=>rows.push([fmtDate(x.createdAt),x.type,x.productName,x.location,x.change,x.note,x.byName||x.by]));const csv=rows.map(r=>r.map(c=>'"'+c+'"').join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='lumoda_stock_history.csv';a.click();URL.revokeObjectURL(url);}

// ============================================================
// REPORTS (admin only)
// ============================================================
function renderReports(){
  if(!isAdmin()){navigate('dashboard',null);return;}
  const invoices=filterByLoc(getInvoices()); const now=new Date(); const today=startOfLocalDay(now); const weekStart=startOfWeek(now); const nextWeek=new Date(weekStart); nextWeek.setDate(nextWeek.getDate()+7); const prevWeek=new Date(weekStart); prevWeek.setDate(prevWeek.getDate()-7); const monthStart=new Date(now.getFullYear(),now.getMonth(),1); const sum=arr=>arr.reduce((s,i)=>s+i.total,0);
  const todaySales = sum(invoices.filter(i=>asTimestamp(i.createdAt)>=today));
  const thisWeekSales = sum(invoices.filter(i=>{const createdAt=asTimestamp(i.createdAt); return createdAt>=weekStart&&createdAt<nextWeek;}));
  const lastWeekSales = sum(invoices.filter(i=>{const createdAt=asTimestamp(i.createdAt); return createdAt>=prevWeek&&createdAt<weekStart;}));
  document.getElementById('rep-today').textContent=fmtGHS(todaySales);
  document.getElementById('rep-week').textContent=fmtGHS(thisWeekSales);
  const repWeekDelta = document.getElementById('rep-week-delta');
  if (repWeekDelta) repWeekDelta.innerHTML = weekComparisonLabel(thisWeekSales, lastWeekSales);
  const repLastWeek = document.getElementById('rep-last-week');
  if (repLastWeek) repLastWeek.textContent=fmtGHS(lastWeekSales);
  document.getElementById('rep-month').textContent=fmtGHS(sum(invoices.filter(i=>asTimestamp(i.createdAt)>=monthStart)));
  document.getElementById('rep-alltime').textContent=fmtGHS(sum(invoices));
  const byStatus={};invoices.forEach(i=>{byStatus[i.status]=(byStatus[i.status]||0)+i.total;});
  document.getElementById('payment-breakdown').innerHTML = (()=>{
    const byStatus = {};
    invoices.forEach(i=>{ byStatus[i.status]=(byStatus[i.status]||0)+i.total; });
    const cashT = invoices.filter(i=>i.payMethod==='cash').reduce((s,i)=>s+i.total,0);
    const momoT = invoices.filter(i=>i.payMethod==='momo').reduce((s,i)=>s+i.total,0);
    let html = Object.entries(byStatus).length
      ? Object.entries(byStatus).map(([s,t])=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--gray-50)">'+statusBadge(s)+'<span style="font-weight:500;font-family:var(--font-mono)">'+fmtGHS(t)+'</span></div>').join('')
      : '<div style="color:var(--gray-400);font-size:13px">No data yet</div>';
    if (cashT>0||momoT>0) {
      html += '<div style="border-top:1px solid var(--gray-200);margin-top:10px;padding-top:10px">';
      html += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--gray-400);font-family:var(--font-mono);margin-bottom:8px">By Payment Method</div>';
      if (cashT>0) html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-50);font-size:13px"><span>💵 Cash</span><span class=\'mono\'>'+fmtGHS(cashT)+'</span></div>';
      if (momoT>0) html += '<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>📱 Mobile Money</span><span class=\'mono\'>'+fmtGHS(momoT)+'</span></div>';
      html += '</div>';
    }
    return html;
  })();
  const allInv=getInvoices();const aT=sum(allInv.filter(i=>i.location==='Alabar'));const mT=sum(allInv.filter(i=>i.location==='Morocco'));const aC=allInv.filter(i=>i.location==='Alabar').length;const mC=allInv.filter(i=>i.location==='Morocco').length;
  document.getElementById('location-breakdown').innerHTML='<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-50)"><div><div style="font-weight:500">Alabar</div><div style="font-size:11px;color:var(--gray-400)">'+aC+' invoices</div></div><div class="mono" style="font-weight:600">'+fmtGHS(aT)+'</div></div><div style="display:flex;justify-content:space-between;padding:10px 0"><div><div style="font-weight:500">Morocco</div><div style="font-size:11px;color:var(--gray-400)">'+mC+' invoices</div></div><div class="mono" style="font-weight:600">'+fmtGHS(mT)+'</div></div>';
  const ps={};invoices.forEach(inv=>inv.items.forEach(item=>{ps[item.name]=(ps[item.name]||0)+item.total;}));const top=Object.entries(ps).sort((a,b)=>b[1]-a[1]).slice(0,5);
  document.getElementById('top-products').innerHTML=top.map(([name,total],i)=>'<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--gray-50)"><div style="width:20px;font-family:var(--font-mono);font-size:11px;color:var(--gray-400)">'+(i+1)+'</div><div style="flex:1;font-size:13px">'+escapeHtml(name)+'</div><div style="font-family:var(--font-mono);font-size:12px;font-weight:500">'+fmtGHS(total)+'</div></div>').join('')||'<div style="color:var(--gray-400);font-size:13px">No data yet</div>';
  const months=[];for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const end=new Date(now.getFullYear(),now.getMonth()-i+1,1);months.push({label:d.toLocaleDateString('en',{month:'short'}),total:sum(invoices.filter(inv=>asTimestamp(inv.createdAt)>=d&&asTimestamp(inv.createdAt)<end))});}
  const maxM=Math.max(...months.map(m=>m.total),1);document.getElementById('monthly-chart').innerHTML=months.map(m=>{const h=Math.round(m.total/maxM*140);return '<div class="chart-bar-wrap"><div style="font-size:9px;color:var(--gray-400);font-family:var(--font-mono)">'+(m.total>0?'GH₵'+Math.round(m.total/1000)+'k':'')+'</div><div class="chart-bar" style="height:'+h+'px"></div><div class="chart-bar-label">'+m.label+'</div></div>';}).join('');
  const staffPerf={};allInv.forEach(i=>{if(!staffPerf[i.createdBy]) staffPerf[i.createdBy]={name:i.createdByName||i.createdBy,count:0,total:0};staffPerf[i.createdBy].count++;staffPerf[i.createdBy].total+=i.total;});
  const perfEl=document.getElementById('staff-performance');if(perfEl){const rows=Object.entries(staffPerf).sort((a,b)=>b[1].total-a[1].total);perfEl.innerHTML=rows.length===0?'<div style="color:var(--gray-400);font-size:13px">No data yet</div>':rows.map(([,d])=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--gray-50)"><div><div style="font-size:13px;font-weight:500">'+escapeHtml(d.name)+'</div><div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">'+d.count+' invoice'+(d.count!==1?'s':'')+'</div></div><div class="mono" style="font-weight:600">'+fmtGHS(d.total)+'</div></div>').join('');}
}

// ============================================================
// AUDIT LOG (admin only)
// ============================================================
let auditSearch='';
function renderAuditLog(){
  if(!isAdmin()){navigate('dashboard',null);return;}
  let logs=LS.get('lumoda_audit')||[];
  if(auditSearch){const q=auditSearch.toLowerCase();logs=logs.filter(l=>l.action.toLowerCase().includes(q)||l.detail.toLowerCase().includes(q));}
  const el=document.getElementById('audit-list');
  el.innerHTML=logs.length===0?'<div style="padding:40px;text-align:center;color:var(--gray-400)">No audit entries yet</div>':logs.slice(0,300).map(l=>{const c=l.action.includes('Delete')?'#dc2626':l.action.includes('Login')?'#16a34a':l.action.includes('Lock')?'#f59e0b':'var(--gray-800)';return '<div class="audit-item"><div style="width:8px;height:8px;border-radius:50%;background:'+c+';flex-shrink:0;margin-top:5px"></div><div><div style="font-size:13px;font-weight:500;color:'+c+'">'+escapeHtml(l.action)+'</div><div style="font-size:13px;color:var(--gray-600)">'+escapeHtml(l.detail)+'</div><div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono);margin-top:2px">'+fmtDateTime(l.createdAt)+' · '+escapeHtml(l.byName||l.by)+'</div></div></div>';}).join('');
}
function filterAudit(val){auditSearch=val;renderAuditLog();}

// ============================================================
// USER MANAGEMENT (admin only)
// ============================================================
async function renderUsers(){
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
  document.getElementById('users-body').innerHTML=users.map(u=>{
    const online=sessions.some(s=>s.username===u.username);
    const locked=u.lockedUntil&&Date.now()<u.lockedUntil;
    const status=!u.active?'<span class="badge badge-danger">Inactive</span>':locked?'<span class="badge badge-warning">Locked</span>':u.mustChangePassword?'<span class="badge badge-info">Temp PW</span>':online?'<span class="badge badge-success">● Online</span>':'<span class="badge badge-neutral">Offline</span>';
    let actions;
    if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
      actions = '<span style="font-size:11px;color:var(--gray-400)">Managed in Supabase</span>';
    } else if (u.id === 'u_admin') {
      actions = '<span style="font-size:11px;color:var(--gray-400)">System admin</span>';
    } else {
      actions = '<button class="btn btn-secondary btn-sm" onclick="resetUserPassword(\''+u.id+'\')">Reset PW</button><button class="btn btn-secondary btn-sm" onclick="toggleUserActive(\''+u.id+'\')">'+(u.active?'Deactivate':'Activate')+'</button>'+(locked?'<button class="btn btn-secondary btn-sm" onclick="unlockUser(\''+u.id+'\')">Unlock</button>':'');
    }
    return '<tr><td><div style="font-weight:500">'+escapeHtml(u.fullName)+'</div></td><td><span class="mono">@'+escapeHtml(u.username)+'</span></td><td><span class="badge '+(u.role==='admin'?'badge-neutral':'badge-info')+'">'+escapeHtml(u.role)+'</span></td><td>'+escapeHtml(u.location)+'</td><td>'+status+'</td><td class="mono" style="color:var(--gray-400);font-size:12px">'+(u.lastLogin?fmtDateTime(u.lastLogin):'Never')+'</td><td style="display:flex;gap:6px;flex-wrap:wrap">'+actions+'</td></tr>';
  }).join('');
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
  const role=document.getElementById('new-user-role').value;
  document.getElementById('new-user-location-row').style.display=role==='admin'?'none':'flex';
}

function saveNewUser(){
  const fullName=document.getElementById('new-user-fullname').value.trim();
  const username=document.getElementById('new-user-username').value.trim().toLowerCase();
  const email=document.getElementById('new-user-email').value.trim().toLowerCase();
  const role=document.getElementById('new-user-role').value;
  const location=role==='admin'?'All':document.getElementById('new-user-location').value;
  const errEl=document.getElementById('create-user-error'); errEl.style.display='none';
  if(!fullName||!username||!email){errEl.textContent='Full name, username, and email are required.';errEl.style.display='block';return;}
  if(!/^[a-z0-9_]{3,20}$/.test(username)){errEl.textContent='Username: 3–20 chars, letters/numbers/underscore only.';errEl.style.display='block';return;}
  if(!/^\S+@\S+\.\S+$/.test(email)){errEl.textContent='Please enter a valid email address.';errEl.style.display='block';return;}

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    (async () => {
      const actionButton = document.querySelector('#create-user-modal .btn.btn-primary');
      if (actionButton) { actionButton.disabled = true; actionButton.textContent = 'Creating...'; }
      try {
        const result = await window.LumodaSupabase.createStaffAccount({ email, username, fullName, role, location });
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
// COPY TEMP PASSWORD
// ============================================================
let _lastTempPw = '';
function copyTempPw() {
  if (!_lastTempPw) return;
  try { navigator.clipboard.writeText(_lastTempPw); toast('Password copied to clipboard!'); }
  catch { toast('Could not copy — note it down manually', 'error'); }
}

// ============================================================
// SESSIONS PANEL (users page)
// ============================================================
function renderSessionsPanel() {
  const sessions = getSessions();
  const now = Date.now();
  // Prune stale sessions older than 6 minutes
  const active = sessions.filter(s => now - s.lastActivity < INACTIVITY_MS + 60000);
  if (active.length !== sessions.length) LS.set('lumoda_sessions', active);

  const buildSession = s => {
    const initials = s.fullName.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
    return '<div style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--gray-50);gap:12px">' +
      '<div style="width:32px;height:32px;border-radius:50%;background:var(--brand-brown);color:var(--white);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0">' + initials + '</div>' +
      '<div style="flex:1"><div style="font-size:13px;font-weight:500">' + s.fullName + '</div>' +
      '<div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">' + s.role + ' · ' + s.location + ' · Last active: ' + fmtAgo(s.lastActivity) + '</div></div>' +
      '<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#16a34a;font-family:var(--font-mono)"><div style="width:7px;height:7px;border-radius:50%;background:#4ade80;animation:pulse 2s infinite"></div>Online</div>' +
      '</div>';
  };

  const empty = '<div style="padding:20px 16px;color:var(--gray-400);font-size:13px">No active sessions</div>';

  // Dashboard sessions card
  const dashPanel = document.getElementById('active-sessions-panel');
  const dashList  = document.getElementById('active-sessions-list');
  if (dashPanel && dashList) {
    dashPanel.style.display = isAdmin() ? 'block' : 'none';
    if (isAdmin()) dashList.innerHTML = active.length ? active.map(buildSession).join('') : empty;
  }

  // Users page sessions
  const usersCount = document.getElementById('sessions-count-users');
  const usersList  = document.getElementById('sessions-list-users');
  if (usersCount) usersCount.textContent = active.length + ' active';
  if (usersList)  usersList.innerHTML = active.length ? active.map(buildSession).join('') : empty;
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o=>o.addEventListener('click',e=>{ if(e.target===o) o.classList.remove('open'); }));

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
        <td align="right"><div style="border:1px solid rgba(255,255,255,.4);padding:3px 10px;font-size:11px;font-weight:700;margin-bottom:6px">MAA LUCY'S PLACE</div><div style="font-size:9px;opacity:.75">LOC 1: Alabar, Ghana Region, Shop OCL/ZR/GF/A20 &amp; A21</div><div style="font-size:9px;opacity:.75">LOC 2: Morocco (K.O) Old Barbers Bldg GF 26</div><div style="font-size:9px;opacity:.75">TEL: 0244369357 / 0546014044 / 0243563481</div></td>
      </tr></table>
      <!-- RED BAR -->
      <table width="100%" style="background:#C8291C;color:white;padding:5px 14px" cellpadding="0" cellspacing="0"><tr>
        <td style="font-weight:700;font-size:13px;letter-spacing:2px">INVOICE</td>
        <td align="center" style="font-family:monospace;font-size:12px">Nr: <strong>${inv.number}</strong></td>
        <td align="right" style="font-family:monospace;font-size:11px">${fmtDate(inv.createdAt)}</td>
      </tr></table>
      <!-- CUSTOMER -->
      <div style="padding:8px 14px;border:1px solid #ddd;border-top:none">
        <table width="100%"><tr>
          <td><strong>Name:</strong> ${inv.customerName}</td>
          ${inv.customerPhone ? '<td><strong>Tel:</strong> '+inv.customerPhone+'</td>' : '<td></td>'}
          <td align="right"><strong>Location:</strong> ${inv.location}</td>
        </tr></table>
        ${inv.customerAddress ? '<div style="font-size:11px;margin-top:3px"><strong>Address:</strong> '+inv.customerAddress+'</div>' : ''}
      </div>
      <!-- ITEMS TABLE -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ddd;border-top:none">
        <thead><tr style="background:#C8291C;color:white">
          <th style="padding:7px 6px;text-align:center;width:50px;font-size:11px">QTY</th>
          <th style="padding:7px 6px;text-align:left;font-size:11px">DESCRIPTION</th>
          <th style="padding:7px 6px;text-align:right;width:110px;font-size:11px">@ UNIT</th>
          <th style="padding:7px 6px;text-align:right;width:120px;font-size:11px">AMOUNT GH₵</th>
        </tr></thead>
        <tbody>${rows}${blanks}</tbody>
      </table>
      <!-- TOTAL -->
      <table width="100%" style="border:1px solid #ddd;border-top:2px solid #5C2D0A" cellpadding="0" cellspacing="0"><tr>
        <td style="padding:8px 14px;font-size:11px;color:#666;font-style:italic">Goods sold out are not returnable</td>
        <td align="right" style="padding:8px 14px;font-size:16px;font-weight:700;font-family:monospace;color:#5C2D0A">Total: ${fmtGHS(inv.total)}</td>
      </tr></table>
      <!-- PAYMENT & STATUS -->
      <div style="padding:6px 14px;border:1px solid #ddd;border-top:none;background:#f9f9f7;font-size:12px">
        <strong>Status:</strong> ${inv.status.toUpperCase()}${pmLine}${noteLine}
      </div>
      <!-- SIGNATURES -->
      <table width="100%" style="margin-top:24px" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:11px">Customer's Signature: _________________________</td>
        <td align="right" style="font-size:11px">Manager's Signature: _________________________</td>
      </tr></table>
      <div style="text-align:center;font-size:10px;color:#999;margin-top:16px;font-style:italic">Thank you for your business!</div>
    </div>`;
  document.getElementById('print-area').innerHTML = html;
  window.print();
  setTimeout(()=>{ document.getElementById('print-area').innerHTML=''; }, 1500);
}

// ============================================================
// CSV PRODUCT IMPORT
// ============================================================
let _csvParsed = [];

function makeLumodaSku(name) {
  const slug = String(name || '')
    .trim()
    .replace(/[.'"]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return 'LMD-' + (slug || 'PRODUCT');
}

function openCsvModal() {
  if (!isAdmin()) { toast('Admin only','error'); return; }
  _csvParsed = [];
  document.getElementById('csv-file-input').value = '';
  document.getElementById('csv-preview').style.display = 'none';
  document.getElementById('csv-import-btn').style.display = 'none';
  const errEl = document.getElementById('csv-error');
  if (errEl) { errEl.style.display='none'; errEl.textContent=''; }
  openModal('csv-modal');
}

function parseCsvFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) { showCsvError('File is empty or has no data rows.'); return; }
    // Normalize headers
    const headers = lines[0].split(',').map(h=>h.trim().toLowerCase().replace(/\s+/g,''));
    const required = ['name','price'];
    const missing = required.filter(r=>!headers.includes(r));
    if (missing.length) { showCsvError('Missing required columns: '+missing.join(', ')+'. Required: Name, Price'); return; }
    const idx = {
      name:       headers.indexOf('name'),
      sku:        headers.indexOf('sku'),
      category:   headers.indexOf('category'),
      price:      headers.indexOf('price'),
      stock:      headers.indexOf('stock'),
      alabar:     headers.findIndex(h=>h.includes('alabar')),
      morocco:    headers.findIndex(h=>h.includes('morocco')),
      reorder:    headers.findIndex(h=>h.includes('reorder')),
    };
    const parsed = [];
    for (let i=1; i<lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (!cols || cols.length < 2) continue;
      const name = (cols[idx.name]||'').trim();
      if (!name) continue;
      const price = parseFloat(cols[idx.price]||'0') || 0;
      const stock = idx.stock>=0 ? (parseInt(cols[idx.stock])||0) : 0;
      parsed.push({
        name,
        sku:       idx.sku>=0 && (cols[idx.sku]||'').trim() ? (cols[idx.sku]||'').trim() : makeLumodaSku(name),
        category:  idx.category>=0 ? (cols[idx.category]||'').trim() : 'General',
        price,
        stockAlabar:  idx.alabar>=0 ? (parseInt(cols[idx.alabar])||0) : stock,
        stockMorocco: idx.morocco>=0 ? (parseInt(cols[idx.morocco])||0) : stock,
        reorder:      idx.reorder>=0 ? (parseInt(cols[idx.reorder])||5) : 5,
      });
    }
    if (!parsed.length) { showCsvError('No valid product rows found.'); return; }
    _csvParsed = parsed;
    renderCsvPreview(parsed);
  };
  reader.readAsText(file);
}

function parseCsvLine(line) {
  // Handle quoted CSV fields
  const result = [];
  let cur='', inQ=false;
  for (let i=0;i<line.length;i++) {
    if (line[i]==='"') { inQ=!inQ; }
    else if (line[i]===',' && !inQ) { result.push(cur); cur=''; }
    else cur+=line[i];
  }
  result.push(cur);
  return result;
}

function renderCsvPreview(parsed) {
  const existing = getProducts();
  const tbody = document.getElementById('csv-preview-body');
  tbody.innerHTML = parsed.map((p,i)=>{
    const dup = existing.find(e=>e.sku && p.sku && e.sku.toLowerCase()===p.sku.toLowerCase());
    const action = dup ? '<span class="badge badge-warning">Update</span>' : '<span class="badge badge-success">New</span>';
    return '<tr>'+
      '<td style="font-weight:500">'+escapeHtml(p.name)+'</td>'+
      '<td class="mono">'+escapeHtml(p.sku||'—')+'</td>'+
      '<td>'+escapeHtml(p.category||'—')+'</td>'+
      '<td class="mono">'+fmtGHS(p.price)+'</td>'+
      '<td class="mono" style="text-align:center">'+p.stockAlabar+'</td>'+
      '<td class="mono" style="text-align:center">'+p.stockMorocco+'</td>'+
      '<td class="mono" style="text-align:center">'+p.reorder+'</td>'+
      '<td>'+action+'</td></tr>';
  }).join('');
  document.getElementById('csv-preview-title').textContent = parsed.length+' products found — review before importing';
  document.getElementById('csv-preview').style.display = 'block';
  document.getElementById('csv-import-btn').style.display = 'inline-flex';
  const errEl = document.getElementById('csv-error'); if(errEl) errEl.style.display='none';
}

function showCsvError(msg) {
  const el = document.getElementById('csv-error');
  if (el) { el.textContent=msg; el.style.display='block'; }
  document.getElementById('csv-preview').style.display='none';
  document.getElementById('csv-import-btn').style.display='none';
  _csvParsed=[];
}

async function importCsvProducts() {
  if (!_csvParsed.length) return;
  const btn = document.getElementById('csv-import-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const payload = _csvParsed.map(p => ({
        name: p.name,
        sku: p.sku || makeLumodaSku(p.name),
        category: p.category || 'General',
        price: p.price,
        stock_alabar: p.stockAlabar || 0,
        stock_morocco: p.stockMorocco || 0,
        reorder_level: p.reorder || 5
      }));
      const { data, error } = await window.LumodaSupabase.importProducts(payload, {
        stockTarget: 'both',
        defaultCategory: 'General',
        defaultReorder: 5
      });
      if (error) throw error;

      try {
        const remoteProducts = await window.LumodaSupabase.loadProducts();
        LS.set('lumoda_products', remoteProducts);
      } catch (e) {}

      closeModal('csv-modal');
      toast((data?.added || 0)+' added, '+(data?.updated || 0)+' updated in Supabase');
      renderProducts();
      _csvParsed = [];
      return;
    } catch (err) {
      showCsvError(err.message || 'Supabase import failed. Make sure you are signed in as admin.');
      if (btn) { btn.disabled = false; btn.textContent = 'Import Products'; }
      return;
    }
  }

  const products = getProducts();
  let added=0, updated=0;
  _csvParsed.forEach(p=>{
    const dup = products.findIndex(e=>e.sku && p.sku && e.sku.toLowerCase()===p.sku.toLowerCase());
    if (dup>=0) {
      products[dup] = { ...products[dup], name:p.name, category:p.category||products[dup].category, price:p.price, stockAlabar:p.stockAlabar||products[dup].stockAlabar, stockMorocco:p.stockMorocco||products[dup].stockMorocco, reorder:p.reorder||products[dup].reorder };
      updated++;
    } else {
      products.push({ id:'p_'+Date.now()+'_'+Math.random().toString(36).slice(2,5), name:p.name, sku:p.sku||('SKU-'+Date.now()), category:p.category||'General', price:p.price, stockAlabar:p.stockAlabar, stockMorocco:p.stockMorocco, reorder:p.reorder });
      added++;
    }
  });
  LS.set('lumoda_products', products);
  addAudit('CSV Import', currentUser.fullName+' imported '+_csvParsed.length+' products ('+added+' new, '+updated+' updated)');
  closeModal('csv-modal');
  toast(added+' added, '+updated+' updated from CSV');
  renderProducts();
  _csvParsed=[];
  if (btn) { btn.disabled = false; btn.textContent = 'Import Products'; }
}

function downloadCsvTemplate() {
  const csv = 'Name,SKU,Category,Price,AlabarStock,MoroccoStock,ReorderLevel\n'+
    'Blender,BLN-001,Appliances,250,10,8,5\n'+
    'Cooking Pot,CPT-002,Cookware,80,20,15,5\n'+
    'Frying Pan,FPN-003,Cookware,45,15,10,5\n';
  const blob = new Blob([csv],{type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url; a.download='lumoda_products_template.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('Template downloaded');
}
// ============================================================
// APP STARTUP (FIX)
// ============================================================

async function bootApp() {
  if (!autoLoginAllowed()) {
    SS.del('lumoda_token');
    SS.del('lumoda_sessions');
  }
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    if (autoLoginAllowed()) {
      try {
        const { data } = await window.LumodaSupabase.getSession();
        const supaSession = data?.session;
        if (supaSession?.user?.id) {
          const { data: profile, error } = await window.LumodaSupabase.getProfile(supaSession.user.id);
          if (error) throw error;
          if (profile && profile.active !== false) {
            currentUser = supabaseProfileToLocal(profile);
            currentLocation = currentUser.location;
            currentUser.token = registerSession(currentUser);
            await syncSupabaseCache();
            showApp();
            return;
          }
        }
      } catch (err) {
        console.warn('Supabase startup failed:', err);
      }
    }
  }

  if (autoLoginAllowed()) {
    const session = getCurrentSession();

    if (session) {
      const user = getUsers().find(u => u.username === session.username && u.active);

      if (user) {
        currentUser = { ...user, token: session.token };
        currentLocation = currentUser.location;
        showApp();
        return;
      }
    }
  }

  // No valid session → show login
  showAuthScreen();
}

// Run app after DOM loads
window.addEventListener('DOMContentLoaded', bootApp);
