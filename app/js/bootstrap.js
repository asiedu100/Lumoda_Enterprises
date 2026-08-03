// ============================================================
// OFFLINE
// ============================================================
window.addEventListener('offline',()=>{ const el=document.getElementById('offline-badge'); if(el) el.style.display='block'; });
window.addEventListener('online', ()=>{ const el=document.getElementById('offline-badge'); if(el) el.style.display='none'; });
if (!navigator.onLine) { const el=document.getElementById('offline-badge'); if(el) el.style.display='block'; }

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
// FIX #4: SINGLE SESSION RESTORE (duplicate removed)
// Only the safe version remains — no race condition
// ============================================================
(async function restoreSession() {
  try {
    const sbEnabled =
      window.LumodaSupabase &&
      typeof window.LumodaSupabase.isConfigured === 'function' &&
      window.LumodaSupabase.isConfigured();

    if (sbEnabled) {
      const sb = window.LumodaSupabase.getClient?.();
      if (!sb) throw new Error('Supabase client missing');

      // FIX: Always try to restore from Supabase active session on refresh.
      // Supabase persists the session in localStorage automatically.
      // The "remember me" checkbox only controls our own auto-login flag —
      // but the Supabase token is always available after login until signOut.
      const { data } = await sb.auth.getUser();
      const user = data?.user;

      if (user && window.LumodaSupabase.getProfile) {
        const { data: profile } = await window.LumodaSupabase.getProfile(user.id);
        if (profile && profile.active !== false) {
          currentUser = supabaseProfileToLocal(profile);
          currentLocation = currentUser.location || 'All';
          currentUser.token = registerSession(currentUser);
          await syncSupabaseCache();
          if (currentUser.mustChangePassword) { showChangePwScreen(); } else { showApp(); }
          return;
        }
      }
    }
  } catch (e) {
    console.warn('Session restore failed:', e);
  }
  showAuthScreen();
})();

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