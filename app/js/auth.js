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

async function forceLogout(reason) {
  clearTimeout(inactivityTimer); clearTimeout(warningTimer); clearInterval(countdownInterval);
  if (currentUser) addAudit('Auto Logout', `Session ended — ${reason}`);
  // Must revoke the underlying Supabase session too, not just local session
  // bookkeeping — otherwise a page refresh silently re-authenticates the user.
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try { await window.LumodaSupabase.signOut(); } catch (e) {}
  }
  destroySession();
  stopActivityTracking();
  currentUser = null;
  authGeneration++;
  clearUserScopedState();
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
    defaultLandingPage: profile.default_landing_page || null,
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

  // Captured before the fetch, checked again before writing anything below
  // — if a different user has since logged in or out, this response is for
  // whoever was signed in when it was requested, not whoever is signed in
  // now, and must not overwrite their fresh data.
  const myGeneration = authGeneration;

  const [products, customers, invoices, stockHistory, auditLogs, businessSettings] = await Promise.all([
    window.LumodaSupabase.loadProducts(),
    window.LumodaSupabase.loadCustomers().catch(() => []),
    window.LumodaSupabase.loadInvoices().catch(() => []),
    // FIX BUG 3: Load stock history and audit logs from Supabase
    window.LumodaSupabase.loadStockHistory().catch(() => null),
    window.LumodaSupabase.loadAuditLogs().catch(() => null),
    window.LumodaSupabase.loadBusinessSettings().catch(() => null)
  ]);

  if (myGeneration !== authGeneration) return;

  LS.set('lumoda_products', normalizeProducts(products));
  LS.set('lumoda_customers', customers);
  LS.set('lumoda_invoices', invoices);

  // Cached so synchronous formatters/defaults (fmtGHS, new-item reorder
  // pre-fill) can read it without needing to be made async everywhere.
  if (businessSettings) { LS.set('lumoda_business_settings', businessSettings); applyBrandColor(businessSettings.brand_color); applyLogo(businessSettings.logo_url); applyBusinessName(businessSettings.business_name); }

  // Merge server stock history into local (server is source of truth)
  if (Array.isArray(stockHistory) && stockHistory.length > 0) {
    LS.set('lumoda_stockhistory', stockHistory);
  }

  // Merge server audit logs into local (server is source of truth)
  if (Array.isArray(auditLogs) && auditLogs.length > 0) {
    LS.set('lumoda_audit', auditLogs);
  }

  // FIX #2: Refresh product suggestions in any open invoice modal after cache sync
  refreshAllLineItemDataLists();

  // A full sync only succeeds when we actually have a connection — a good
  // moment to also flush any cash sales queued while offline.
  if (typeof trySyncOfflineQueue === 'function') trySyncOfflineQueue();
}

// Lightweight alternative to syncSupabaseCache() for a single invoice write
// (create/edit/delete). Re-downloads just that one invoice — plus the small,
// join-free customers table in case the write created a new customer —
// instead of every invoice, product, and log the business has ever had.
async function syncSingleInvoice(invoiceId) {
  if (!window.LumodaSupabase || !window.LumodaSupabase.isConfigured()) return;

  const myGeneration = authGeneration;

  const [invoice, customers] = await Promise.all([
    window.LumodaSupabase.loadInvoiceById(invoiceId),
    window.LumodaSupabase.loadCustomers().catch(() => null)
  ]);

  if (myGeneration !== authGeneration) return;

  const invoices = LS.get('lumoda_invoices') || [];
  const idx = invoices.findIndex(i => i.id === invoiceId);
  if (invoice) {
    if (idx >= 0) invoices[idx] = invoice; else invoices.unshift(invoice);
  } else if (idx >= 0) {
    invoices.splice(idx, 1);
  }
  LS.set('lumoda_invoices', invoices);

  if (Array.isArray(customers)) LS.set('lumoda_customers', customers);

  refreshAllLineItemDataLists();
}

// ============================================================
// NETWORK VS AUTH FAILURE (session restore / offline / reconnect)
// ============================================================

// True when a Supabase Auth call failed because the server couldn't be
// reached — as opposed to being reached and rejecting the request. Checked
// empirically against the live client: a genuine network failure surfaces
// as error.name === 'AuthRetryableFetchError' with no real HTTP status.
function isAuthNetworkFailure(err) {
  if (!navigator.onLine) return true;
  if (!err) return false;
  if (err.name === 'AuthRetryableFetchError') return true;
  if (err.status === 0) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed');
}

// Distinguishes "session temporarily can't be verified" (safe to retry
// once reconnected/refreshed) from "permanently not authorized" (must
// flag for admin, never silently retried). Confirmed directly against the
// live database: a stale/expired token that reaches the server (server
// IS reachable) makes create_invoice_no_stock raise {code:'P0001',
// message:'Not authenticated'}. A genuinely disabled account raises a
// different message, 'Active profile not found' — excluded explicitly
// below rather than relying only on the two strings not overlapping.
function isAuthTokenStaleError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  if (msg.includes('active profile not found')) return false; // permanent — never treat as "just stale"
  const code = err.code || '';
  return msg.includes('not authenticated') || code === 'PGRST301' || msg.includes('jwt expired') || msg.includes('invalid jwt');
}

// Called after every successful server-verified login/restore/reconnect —
// the timestamp gates how long a cached session stays trusted offline
// (OFFLINE_AUTH_WINDOW_MS), and the cached profile is what offline restore
// reconstructs currentUser from without needing a network call.
function recordSuccessfulVerification(profile) {
  LS.set('lumoda_last_verified', Date.now());
  LS.set('lumoda_cached_profile', {
    id: profile.id, email: profile.email, username: profile.username,
    full_name: profile.full_name, role: profile.role, location: profile.location,
    active: profile.active, must_change_password: profile.must_change_password,
    default_landing_page: profile.default_landing_page
  });
}

// Called from restoreSession() when the server can't be reached at
// startup. Falls back to the last known-good session, gated by
// OFFLINE_AUTH_WINDOW_MS so a cached login can't be trusted forever.
// Deliberately does NOT call clearUserScopedState() — this is the same
// user continuing, not a different one logging in, and the cached
// invoices/products/etc. already in localStorage are exactly what's
// needed to browse offline.
// Returns true if it handled the situation (entered offline mode, or
// showed the reconnect-required screen) — false if there's nothing
// usable/consistent locally, so the caller should fall through to the
// normal login screen.
function tryEnterOfflineSession() {
  const lastVerified  = LS.get('lumoda_last_verified');
  const cachedProfile = LS.get('lumoda_cached_profile');
  const rawSession     = window.LumodaSupabase.getRawStoredSession ? window.LumodaSupabase.getRawStoredSession() : null;
  const sessionUserId  = rawSession?.user?.id;

  if (!lastVerified || !cachedProfile || !sessionUserId || cachedProfile.id !== sessionUserId) {
    return false; // nothing usable, or the cached profile doesn't match the stored session
  }
  if (cachedProfile.active === false) return false; // last known state was already inactive

  if (Date.now() - lastVerified > OFFLINE_AUTH_WINDOW_MS) {
    const note = document.getElementById('reconnect-pending-note');
    if (note) note.style.display = (typeof getOfflineQueue === 'function' && getOfflineQueue().length > 0) ? 'block' : 'none';
    document.getElementById('app').style.display = 'none';
    document.getElementById('change-pw-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('reconnect-screen').style.display = 'flex';
    return true;
  }

  currentUser = supabaseProfileToLocal(cachedProfile);
  currentLocation = currentUser.location || 'All';
  isOfflineSession = true;
  updateOfflineSessionBanner();
  authGeneration++;
  currentUser.token = registerSession(currentUser);
  if (currentUser.mustChangePassword) { showChangePwScreen(); } else { showApp(); }
  return true;
}

// Signs the user out because the server says so (disabled account, or a
// revoked/invalid session discovered on reconnect) — as opposed to the
// user choosing to log out. No confirm() dialog, since this isn't a
// choice; server-side authorization wins regardless of what the device
// was doing offline.
async function signOutDueToDeactivation() {
  if (currentUser) addAudit('Account Deactivated', `"${currentUser.fullName}" was signed out — account no longer active`);
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try { await window.LumodaSupabase.signOut(); } catch (e) {}
    if (window.LumodaSupabase.clearRawStoredSession) window.LumodaSupabase.clearRawStoredSession();
  }
  LS.del('lumoda_last_verified');
  LS.del('lumoda_cached_profile');
  destroySession(); stopActivityTracking(); currentUser = null;
  isOfflineSession = false;
  updateOfflineSessionBanner();
  authGeneration++;
  clearUserScopedState();
  showAuthScreen();
  toast('Your account is no longer active. Contact your administrator.', 'error');
}

// Runs when connectivity returns while the app is in offline-session mode
// — revalidates with the server and refreshes the access token (getUser()
// triggers this) BEFORE the existing offline-queue drain runs, so a
// queued sale is retried against a fresh token rather than the stale
// cached one. A no-op if the session is already fully verified.
async function revalidateSessionOnReconnect() {
  if (!isOfflineSession) return;
  if (!window.LumodaSupabase || !window.LumodaSupabase.isConfigured()) return;
  const sb = window.LumodaSupabase.getClient?.();
  if (!sb) return;

  try {
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    const user = data?.user;
    if (!user) throw new Error('No user in restored session');

    const { data: profile, error: profileError } = await window.LumodaSupabase.getProfile(user.id);
    if (profileError) throw profileError;
    if (!profile || profile.active === false) {
      await signOutDueToDeactivation();
      return;
    }

    currentUser = supabaseProfileToLocal(profile);
    recordSuccessfulVerification(profile);
    isOfflineSession = false;
    updateOfflineSessionBanner();
    await syncSupabaseCache(); // resyncs data, and (at its end) drains the offline sales queue
  } catch (e) {
    // Still not really reachable, or a transient blip — stay in offline
    // mode and try again on the next 'online' event rather than signing
    // anyone out over a network hiccup.
    if (!isAuthNetworkFailure(e)) console.warn('Reconnect revalidation failed:', e);
  }
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

      // Wipe any state left behind by whoever was signed in on this device
      // before — including their cached data — before this user's identity
      // is established, so nothing from the previous session can bleed in.
      clearUserScopedState();
      currentUser = supabaseProfileToLocal(profile);
      currentLocation = currentUser.location;
      isOfflineSession = false;
      updateOfflineSessionBanner();
      recordSuccessfulVerification(profile);
      authGeneration++;
      currentUser.token = registerSession(currentUser);
      setAutoLoginAllowed(!!document.getElementById('remember-login')?.checked);
      try { await window.LumodaSupabase.recordLogin(); } catch (e) { console.warn('Could not record last login:', e); }
      await syncSupabaseCache();
      addAudit('Login', `"${currentUser.fullName}" signed in with Supabase [${currentUser.location}]`);
      if (currentUser.mustChangePassword) { showChangePwScreen(); } else { showApp(); }
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
// FORCED PASSWORD CHANGE
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
  if (!confirm('Sign out of ' + getBusinessName() + '?')) return;
  addAudit('Logout', `"${currentUser.fullName}" signed out`);
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try { await window.LumodaSupabase.signOut(); } catch (e) {}
    // signOut()'s own network call is what normally clears the persisted
    // session — if that call fails (e.g. logging out while offline), the
    // token would otherwise survive and could be picked back up by the
    // offline-restore path. Clear it directly so a deliberate logout can
    // never be restored from, online or not.
    if (window.LumodaSupabase.clearRawStoredSession) window.LumodaSupabase.clearRawStoredSession();
  }
  LS.del('lumoda_last_verified');
  LS.del('lumoda_cached_profile');
  destroySession(); stopActivityTracking(); currentUser = null;
  isOfflineSession = false;
  updateOfflineSessionBanner();
  authGeneration++;
  clearUserScopedState();
  showAuthScreen();
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
  renderLocationSelects();
  updateUserUI(); buildNavForRole();
  const roleDefault = (currentUser && currentUser.role === 'warehouse_manager') ? 'warehouse' : 'dashboard';
  // A saved landing-page preference only applies to admin/staff — a
  // warehouse manager only ever has one page to land on anyway. Guard
  // against a stale preference (e.g. left over from before a role change)
  // pointing at a page this role can no longer reach.
  const staffPages = ['dashboard', 'cashsales', 'invoices', 'customers', 'products', 'stockhistory'];
  const adminPages = [...staffPages, 'reports', 'warehouse'];
  const allowedPages = isAdmin() ? adminPages : staffPages;
  const preferred = currentUser?.defaultLandingPage;
  const startPage = (preferred && allowedPages.includes(preferred)) ? preferred : roleDefault;
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
  if (!isAdmin()) { toast('Only admin can ' + action, 'error'); return false; }
  return true;
}
function canEditInvoice(inv) {
  if (!currentUser || !inv || inv.deleted) return false;
  // Not yet synced to the server (offline queue) — its id is a local
  // placeholder, not a real invoice id, so there's nothing there yet for
  // an edit call to actually update. Wait for it to sync first.
  if (inv.offlineSync) return false;
  if (isAdmin()) return true;
  return inv.location && currentUser.location === inv.location;
}
function requireInvoiceEdit(inv, action) {
  if (!canEditInvoice(inv)) { toast('You cannot ' + action + ' for this invoice', 'error'); return false; }
  return true;
}

function buildNavForRole() {
  const admin = isAdmin();
  const warehouseManager = currentUser && currentUser.role === 'warehouse_manager';

  if (warehouseManager) {
    ['dashboard','cashsales','invoices','customers','products','stockhistory','reports','audit','users','approvals','warehouses'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'none';
    });
    const warehouseNav = document.getElementById('nav-warehouse');
    if (warehouseNav) warehouseNav.style.display = 'flex';
    document.getElementById('loc-filter').style.display = 'none';
    currentLocation = currentUser.location;
  } else if (admin) {
    ['reports','audit','users','approvals','warehouses'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'flex';
    });
    ['dashboard','cashsales','invoices','customers','products','stockhistory'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'flex';
    });
    const warehouseNav = document.getElementById('nav-warehouse');
    if (warehouseNav) warehouseNav.style.display = 'flex';
    document.getElementById('loc-filter').style.display = 'flex';
    refreshApprovalsBadge();
  } else {
    ['reports','audit','users','warehouse','approvals','warehouses'].forEach(page => {
      const el = document.querySelector('.nav-item[data-page="' + page + '"]');
      if (el) el.style.display = 'none';
    });
    ['dashboard','cashsales','invoices','customers','products','stockhistory'].forEach(page => {
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
  const u         = currentUser;
  const firstName = u.fullName.split(' ')[0];
  const initials  = u.fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
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
