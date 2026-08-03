// ============================================================
// SESSIONS PANEL
// ============================================================
function buildSessionsHtml(sessions) {
  return sessions.length
    ? sessions.map(s =>
        '<div style="display:flex;justify-content:space-between;padding:9px 14px;border-bottom:1px solid var(--gray-50)">' +
        '<span><span class="session-dot"></span>' + escapeHtml(s.fullName || '') +
        ' <span class="mono">@' + escapeHtml(s.username || '') + '</span></span>' +
        '<span class="mono" style="color:var(--gray-400)">' + escapeHtml(s.location || '') + ' · ' + fmtAgo(s.lastActivity) + '</span></div>'
      ).join('')
    : '<div style="padding:16px;color:var(--gray-400);font-size:13px">No active sessions</div>';
}

function renderSessionsPanel(){
  const panel = document.getElementById('active-sessions-panel');
  if (panel && !isAdmin()) { panel.style.display = 'none'; return; }
  if (panel) panel.style.display = 'block';
  const sessions = getSessions();
  const countEl = document.getElementById('active-sessions-count');
  if (countEl) countEl.textContent = sessions.length + ' active';
  const listEl = document.getElementById('active-sessions-list');
  if (listEl) listEl.innerHTML = buildSessionsHtml(sessions);
  const usersCountEl = document.getElementById('sessions-count-users');
  if (usersCountEl) usersCountEl.textContent = sessions.length + ' active';
  const usersListEl = document.getElementById('sessions-list-users');
  if (usersListEl) usersListEl.innerHTML = buildSessionsHtml(sessions);
}

// ============================================================
// USER MANAGEMENT
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
        id: profile.id, email: profile.email || '', username: profile.username,
        fullName: profile.full_name, role: profile.role, location: profile.location,
        active: profile.active !== false, mustChangePassword: !!profile.must_change_password,
        lockedUntil: null, lastLogin: profile.last_login ? new Date(profile.last_login).getTime() : null
      }));
    } catch (error) { console.warn('Could not load Supabase profiles.', error); }
  }

  document.getElementById('users-body').innerHTML = users.map(u => {
    const online = sessions.some(s => s.username === u.username);
    const locked = u.lockedUntil && Date.now() < u.lockedUntil;
    const status = !u.active
      ? '<span class="badge badge-danger">Inactive</span>'
      : locked ? '<span class="badge badge-warning">Locked</span>'
      : u.mustChangePassword ? '<span class="badge badge-info">Temp PW</span>'
      : online ? '<span class="badge badge-success">● Online</span>'
      : '<span class="badge badge-neutral">Offline</span>';

    let actions = '';
    if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
      if (u.role !== 'admin') {
        actions = '<button class="btn btn-secondary btn-sm" onclick="toggleSupabaseUserActive(\''+u.id+'\', '+u.active+')">'+(u.active?'Deactivate':'Activate')+'</button>';
      } else { actions = '<span style="font-size:11px;color:var(--gray-400)">System admin</span>'; }
    } else if (u.id === 'u_admin') {
      actions = '<span style="font-size:11px;color:var(--gray-400)">System admin</span>';
    } else {
      actions = '<button class="btn btn-secondary btn-sm" onclick="resetUserPassword(\''+u.id+'\')">Reset PW</button>'+
        '<button class="btn btn-secondary btn-sm" onclick="toggleUserActive(\''+u.id+'\')">'+(u.active?'Deactivate':'Activate')+'</button>'+
        (locked?'<button class="btn btn-secondary btn-sm" onclick="unlockUser(\''+u.id+'\')">Unlock</button>':'');
    }

    return '<tr>'+
      '<td><div style="font-weight:500">'+escapeHtml(u.fullName)+'</div></td>'+
      '<td><span class="mono">@'+escapeHtml(u.username)+'</span></td>'+
      '<td><span class="badge '+(u.role==='admin'?'badge-neutral':'badge-info')+'">'+escapeHtml(u.role)+'</span></td>'+
      '<td>'+escapeHtml(u.location)+'</td>'+
      '<td>'+status+'</td>'+
      '<td class="mono" style="color:var(--gray-400);font-size:12px">'+(u.lastLogin?fmtDateTime(u.lastLogin):'Never')+'</td>'+
      '<td style="display:flex;gap:6px;flex-wrap:wrap">'+actions+'</td>'+
    '</tr>';
  }).join('');
}

async function toggleSupabaseUserActive(userId, isActive){
  if(!requireAdmin('manage users')) return;
  const sb = window.LumodaSupabase.getClient();
  const { error } = await sb.from('profiles').update({ active: !isActive }).eq('id', userId);
  if (error) { console.error(error); toast('Could not update user status', 'error'); return; }
  toast(isActive ? 'User deactivated' : 'User activated');
  renderUsers();
}

function openCreateUserModal(){
  if(!requireAdmin('create users'))return;
  ['new-user-fullname','new-user-username','new-user-email'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('new-user-role').value='staff'; document.getElementById('new-user-location').value=LOCATIONS[0];
  document.getElementById('create-user-error').style.display='none';
  document.getElementById('new-user-location-row').style.display='flex';
  openModal('create-user-modal');
}

function onNewUserRoleChange(){
  const role = document.getElementById('new-user-role').value;
  document.getElementById('new-user-location-row').style.display = (role === 'admin' || role === 'warehouse_manager') ? 'none' : 'flex';
}

function saveNewUser(){
  const fullName=document.getElementById('new-user-fullname').value.trim();
  const username=document.getElementById('new-user-username').value.trim().toLowerCase();
  const email=document.getElementById('new-user-email').value.trim().toLowerCase();
  const role=document.getElementById('new-user-role').value;
  const location=(role==='admin'||role==='warehouse_manager')?'All':document.getElementById('new-user-location').value;
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
        closeModal('create-user-modal'); renderUsers();
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
  if (!_lastTempPw) { toast('No temporary password to copy', 'error'); return; }
  try { navigator.clipboard.writeText(_lastTempPw); toast('Temporary password copied'); }
  catch (e) { toast('Could not copy password', 'error'); }
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
      } catch (error) { err.textContent = error.message || 'Could not update your password.'; err.style.display = 'block'; }
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
async function renderAuditLog() {
  if (!isAdmin()) return;

  // FIX BUG 3: Load from Supabase first, fall back to localStorage
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const serverLogs = await window.LumodaSupabase.loadAuditLogs();
      if (Array.isArray(serverLogs) && serverLogs.length > 0) {
        LS.set('lumoda_audit', serverLogs);
      }
    } catch (e) {
      console.warn('Could not load audit logs from server:', e);
    }
  }

  const log = LS.get('lumoda_audit') || [];
  document.getElementById('audit-list').innerHTML = log.length
    ? log.map(a =>
        '<div class="audit-item"><div class="audit-dot"></div><div>' +
        '<div style="font-size:13px"><strong>' + escapeHtml(a.action) + '</strong> — ' + escapeHtml(a.detail) + '</div>' +
        '<div class="audit-meta">' + escapeHtml(a.byName || a.by || 'system') + ' · ' + fmtDateTime(a.createdAt) + '</div>' +
        '</div></div>'
      ).join('')
    : '<div style="padding:40px;text-align:center;color:var(--gray-400)">No audit logs yet</div>';
}
function filterAudit(val){const q=val.toLowerCase();document.querySelectorAll('#audit-list .audit-item').forEach(el=>el.style.display=el.textContent.toLowerCase().includes(q)?'':'none');}

// ============================================================
// PENDING APPROVALS (discount requests + item-removal requests)
// ============================================================
async function refreshApprovalsBadge() {
  if (!isAdmin() || !window.LumodaSupabase || !window.LumodaSupabase.isConfigured()) return;
  try {
    const rows  = await window.LumodaSupabase.loadInvoiceEditRequests();
    const badge = document.getElementById('approvals-badge');
    if (!badge) return;
    if (rows.length > 0) { badge.textContent = rows.length; badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  } catch (e) {
    console.warn('Could not load pending approvals count:', e);
  }
}

async function renderApprovals() {
  if (!isAdmin()) return;
  const container = document.getElementById('approvals-list');
  if (!window.LumodaSupabase || !window.LumodaSupabase.isConfigured()) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray-400)">Approvals require an online connection</div>';
    return;
  }

  let rows = [];
  try {
    rows = await window.LumodaSupabase.loadInvoiceEditRequests();
  } catch (e) {
    console.error('Could not load approvals:', e);
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray-400)">Could not load pending approvals</div>';
    return;
  }

  const badge = document.getElementById('approvals-badge');
  if (badge) { if (rows.length > 0) { badge.textContent = rows.length; badge.style.display = 'inline-block'; } else { badge.style.display = 'none'; } }

  if (!rows.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray-400)">Nothing waiting on you right now</div>';
    return;
  }

  container.innerHTML = rows.map(r => {
    const who = escapeHtml((r.profiles && r.profiles.full_name) || 'Unknown staff') + ' · ' + escapeHtml((r.profiles && r.profiles.location) || '');
    const when = fmtDateTime(new Date(r.requested_at).getTime());

    if (r.request_type === 'discount') {
      const p = r.payload || {};
      const items = Array.isArray(p.p_items) ? p.p_items : [];
      const itemsHtml = items.map(it => '<div style="font-size:12.5px;color:var(--gray-600)">' + escapeHtml(String(it.qty)) + ' × ' + escapeHtml(it.name || '') + ' @ ' + fmtGHS(it.price || 0) + '</div>').join('');
      return '<div class="audit-item" style="align-items:flex-start">' +
        '<div class="audit-dot" style="background:var(--brand-yellow)"></div>' +
        '<div style="flex:1">' +
          '<div style="font-size:13px"><span class="badge badge-warning">Discount request</span> ' +
          '<strong>' + escapeHtml(p.p_customer_name || 'Unnamed customer') + '</strong> — discount of ' + fmtGHS(p.p_discount || 0) +
          '</div>' +
          itemsHtml +
          '<div class="audit-meta">Requested by ' + who + ' · ' + when + '</div>' +
          '<div style="margin-top:8px;display:flex;gap:8px">' +
            '<button class="btn btn-primary btn-sm" onclick="approveRequest(\'' + r.id + '\')">Approve</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="rejectRequest(\'' + r.id + '\')">Reject</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    // item_change request
    const inv = r.invoices || {};
    const items = Array.isArray(r.payload) ? r.payload : [];
    const itemsHtml = items.map(it => '<div style="font-size:12.5px;color:var(--gray-600)">' + escapeHtml(String(it.qty)) + ' × ' + escapeHtml(it.name || '') + ' @ ' + fmtGHS(it.price || 0) + '</div>').join('');
    return '<div class="audit-item" style="align-items:flex-start">' +
      '<div class="audit-dot" style="background:var(--brand-red)"></div>' +
      '<div style="flex:1">' +
        '<div style="font-size:13px"><span class="badge badge-danger">Item removal</span> ' +
        'Invoice <strong>' + escapeHtml(inv.number || r.invoice_id) + '</strong> — ' + escapeHtml(inv.customer_name || '') +
        '</div>' +
        '<div class="audit-meta" style="margin-bottom:4px">Proposed item list after the change:</div>' +
        itemsHtml +
        '<div class="audit-meta">Requested by ' + who + ' · ' + when + '</div>' +
        '<div style="margin-top:8px;display:flex;gap:8px">' +
          '<button class="btn btn-primary btn-sm" onclick="approveRequest(\'' + r.id + '\')">Approve</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="rejectRequest(\'' + r.id + '\')">Reject</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function approveRequest(id) {
  if (!requireAdmin('approve requests')) return;
  try {
    const res = await window.LumodaSupabase.approveInvoiceRequest(id);
    if (res.error) throw res.error;
    await syncSupabaseCache();
    addAudit('Request Approved', currentUser.fullName + ' approved edit request ' + id);
    toast('Approved');
    renderApprovals();
    renderDashboard();
  } catch (err) {
    toast(err.message || 'Could not approve request', 'error');
  }
}

async function rejectRequest(id) {
  if (!requireAdmin('reject requests')) return;
  const reason = prompt('Reason for rejecting (optional):') || '';
  try {
    const res = await window.LumodaSupabase.rejectInvoiceRequest(id, reason);
    if (res.error) throw res.error;
    addAudit('Request Rejected', currentUser.fullName + ' rejected edit request ' + id + (reason ? ' — ' + reason : ''));
    toast('Rejected');
    renderApprovals();
  } catch (err) {
    toast(err.message || 'Could not reject request', 'error');
  }
}

