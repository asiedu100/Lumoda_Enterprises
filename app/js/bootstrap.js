// ============================================================
// OFFLINE
// ============================================================
window.addEventListener('offline',()=>{ const el=document.getElementById('offline-badge'); if(el) el.style.display='block'; });
window.addEventListener('online', ()=>{ const el=document.getElementById('offline-badge'); if(el) el.style.display='none'; });
if (!navigator.onLine) { const el=document.getElementById('offline-badge'); if(el) el.style.display='block'; }

// Feeds the cumulative-online-time tracker (core.js) that
// STALE_TOKEN_RETRY_LIMIT_MS is measured against — kept separate from the
// badge listeners above since this accrues state, not just toggles a UI
// element.
window.addEventListener('online',  () => markOnlineTransition(true));
window.addEventListener('offline', () => markOnlineTransition(false));

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
// SESSION RESTORE (network failure vs. auth failure — see auth.js for
// isAuthNetworkFailure/tryEnterOfflineSession/OFFLINE_AUTH_WINDOW_MS)
// ============================================================
async function restoreSession() {
  try {
    const sbEnabled =
      window.LumodaSupabase &&
      typeof window.LumodaSupabase.isConfigured === 'function' &&
      window.LumodaSupabase.isConfigured();

    if (sbEnabled) {
      const sb = window.LumodaSupabase.getClient?.();
      if (!sb) throw new Error('Supabase client missing');

      // Always try to restore from Supabase's active session on refresh.
      // Supabase persists the session in localStorage automatically.
      // The "remember me" checkbox only controls our own auto-login flag —
      // but the Supabase token is always available after login until
      // signOut(). getUser() always revalidates with the server, so its
      // failure needs to be classified: unreachable server falls back to
      // the cached session (below); a genuine rejection does not.
      let user = null, authError = null;
      try {
        const { data, error } = await sb.auth.getUser();
        user = data?.user || null;
        authError = error || null;
      } catch (e) {
        authError = e;
      }

      if (user && window.LumodaSupabase.getProfile) {
        const { data: profile } = await window.LumodaSupabase.getProfile(user.id);
        if (profile && profile.active !== false) {
          clearUserScopedState();
          currentUser = supabaseProfileToLocal(profile);
          currentLocation = currentUser.location || 'All';
          isOfflineSession = false;
          updateOfflineSessionBanner();
          recordSuccessfulVerification(profile);
          authGeneration++;
          currentUser.token = registerSession(currentUser);
          await syncSupabaseCache();
          if (currentUser.mustChangePassword) { showChangePwScreen(); } else { showApp(); }
          return;
        }
        // Profile exists but inactive, or missing — server-confirmed, not
        // a network issue, so this falls through to the login screen.
      } else if (authError && typeof isAuthNetworkFailure === 'function' && isAuthNetworkFailure(authError)) {
        if (tryEnterOfflineSession()) return;
      }
    }
  } catch (e) {
    console.warn('Session restore failed:', e);
  }
  showAuthScreen();
}
restoreSession();

// Revalidate + refresh the token the moment connectivity returns, before
// the existing offline-queue drain (registered separately, in
// invoices.js) gets a chance to run against a still-stale token.
window.addEventListener('online', () => { if (typeof revalidateSessionOnReconnect === 'function') revalidateSessionOnReconnect(); });

// ============================================================
// SERVICE WORKER (PWA)
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => console.log('PWA: Service Worker registered'))
      .catch(err => console.log('PWA error:', err));
  });
}

// ============================================================
// GLOBAL EXPORTS (for HTML onclick attributes)
// ============================================================
window.openEditInvoiceModal = openEditInvoiceModal;
window.saveEditedInvoice    = saveEditedInvoice;
window.updateInvoice        = updateInvoice;
window.addItem              = addItem;
window.shareInvoice         = shareInvoice;
window._copyAndCloseShare   = _copyAndCloseShare;
window._sendViaSMS          = _sendViaSMS;
window._selectMpdMethod     = _selectMpdMethod;
window._confirmMarkPaid     = _confirmMarkPaid;
window._shareViaWhatsAppOrCopy = _shareViaWhatsAppOrCopy;