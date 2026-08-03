// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  updateUserUI();
  const invoices   = filterByLoc(getInvoices());
  // Sales-total tiles show branch-wide numbers to admins, but only the
  // logged-in staff member's own sales to everyone else — the day's
  // revenue figures are business-sensitive and staff don't need the
  // whole branch's numbers to do their job.
  const own = isAdmin() ? invoices : invoices.filter(i => i.createdBy === currentUser.id);
  const now        = new Date();
  const today      = startOfLocalDay(now);
  const weekStart  = startOfWeek(now);
  const nextWeek   = new Date(weekStart); nextWeek.setDate(nextWeek.getDate() + 7);
  const prevWeek   = new Date(weekStart); prevWeek.setDate(prevWeek.getDate() - 7);
  const todayInvs  = own.filter(i => asTimestamp(i.createdAt) >= today);
  const weekInvs   = own.filter(i => {
    const createdAt = asTimestamp(i.createdAt);
    return createdAt >= weekStart && createdAt < nextWeek;
  });
  const lastWeekInvs = own.filter(i => {
    const createdAt = asTimestamp(i.createdAt);
    return createdAt >= prevWeek && createdAt < weekStart;
  });
  const pendingInvs = own.filter(i => i.status==='pending'||i.status==='partial');
  const weekTotal = sumInvoiceTotal(weekInvs);
  const lastWeekTotal = sumInvoiceTotal(lastWeekInvs);

  const todayLabelEl   = document.getElementById('stat-today-label');
  const weekLabelEl    = document.getElementById('stat-week-label');
  const pendingLabelEl = document.getElementById('stat-pending-label');
  if (todayLabelEl)   todayLabelEl.textContent   = isAdmin() ? "Today's Sales"   : 'Your Sales Today';
  if (weekLabelEl)    weekLabelEl.textContent    = isAdmin() ? 'This Week'       : 'Your Sales This Week';
  if (pendingLabelEl) pendingLabelEl.textContent = isAdmin() ? 'Pending'         : 'Your Pending';

  document.getElementById('stat-today').textContent     = fmtGHS(sumInvoiceTotal(todayInvs));
  document.getElementById('stat-today-d').textContent   = todayInvs.length + ' invoice' + (todayInvs.length!==1?'s':'');
  document.getElementById('stat-week').textContent      = fmtGHS(weekTotal);
  document.getElementById('stat-week-d').innerHTML      = weekInvs.length + ' invoices ' + weekComparisonLabel(weekTotal, lastWeekTotal);
  document.getElementById('stat-pending').textContent   = fmtGHS(sumInvoiceTotal(pendingInvs));
  document.getElementById('stat-pending-d').textContent = pendingInvs.length + ' outstanding';
  document.getElementById('stat-customers').textContent = filterByLoc(getCustomers()).length;

  const recent = [...own].sort((a,b)=>asTimestamp(b.createdAt)-asTimestamp(a.createdAt)).slice(0,6);
  document.getElementById('dash-recent-body').innerHTML = recent.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:32px">No invoices yet</td></tr>'
    : recent.map(i => '<tr style="cursor:pointer" onclick="viewInvoice(\''+i.id+'\')"><td class="mono">'+escapeHtml(i.number)+'</td><td>'+escapeHtml(i.customerName)+'</td><td class="mono">'+fmtGHS(i.total)+'</td><td>'+statusBadge(i.status)+'</td></tr>').join('');

  const effLoc  = isAdmin() ? currentLocation : currentUser.location;
  const lowStock = getProducts().filter(p => { const s = effLoc==='Morocco'?p.stockMorocco:effLoc==='Alabar'?p.stockAlabar:Math.min(p.stockAlabar,p.stockMorocco); return s <= p.reorder; }).slice(0,6);
  document.getElementById('low-stock-list').innerHTML = lowStock.length === 0
    ? '<div style="padding:32px;text-align:center;color:var(--gray-400);font-size:13px">All products well-stocked ✓</div>'
    : lowStock.map(p => {
        const stock = effLoc==='Morocco'?p.stockMorocco:effLoc==='Alabar'?p.stockAlabar:Math.min(p.stockAlabar,p.stockMorocco);
        const pct   = Math.min(100, Math.round(stock/Math.max(p.reorder*2,1)*100));
        const cls   = stock===0?'critical':'low';
        const adjBtn = isAdmin()?'<button class="btn btn-secondary btn-sm" onclick="openStockAdjust(\''+p.id+'\')">Adjust</button>':'';
        return '<div class="low-stock-item"><div style="flex:1"><div style="font-size:13px;font-weight:500">'+escapeHtml(p.name)+'</div><div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">Stock: '+stock+' · Reorder: '+p.reorder+'</div><div class="stock-bar-wrap" style="margin-top:6px"><div class="stock-bar '+cls+'" style="width:'+pct+'%"></div></div></div>'+adjBtn+'</div>';
      }).join('');

  const todayCash = todayInvs.filter(i=>i.payMethod==='cash').reduce((s,i)=>s+i.total,0);
  const todayMomo = todayInvs.filter(i=>i.payMethod==='momo').reduce((s,i)=>s+i.total,0);
  const todayUnspecified = todayInvs.filter(i=>i.status==='paid'&&!i.payMethod).reduce((s,i)=>s+i.total,0);
  const hasPaid = todayCash>0||todayMomo>0||todayUnspecified>0;
  const pmPanel = document.getElementById('dash-pm-panel');
  if (pmPanel) {
    pmPanel.style.display = hasPaid ? 'grid' : 'none';
    const cashEl = document.getElementById('stat-cash');
    const momoEl = document.getElementById('stat-momo');
    const cashLabelEl = document.getElementById('stat-cash-label');
    const momoLabelEl = document.getElementById('stat-momo-label');
    if (cashEl) cashEl.textContent = fmtGHS(todayCash);
    if (momoEl) momoEl.textContent = fmtGHS(todayMomo);
    if (cashLabelEl) cashLabelEl.textContent = isAdmin() ? '💵 Cash Today' : '💵 Your Cash Today';
    if (momoLabelEl) momoLabelEl.textContent = isAdmin() ? '📱 MoMo Today' : '📱 Your MoMo Today';
  }

  renderSessionsPanel();
  renderWeeklyChart(own);
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

