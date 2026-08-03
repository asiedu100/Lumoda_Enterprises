// ============================================================
// REPORTS
// ============================================================
let reportsInvoicesCache=[];
let topCustomersSortMode='spend';
function renderReports(){if(!isAdmin())return;const invoices=filterByLoc(getInvoices());reportsInvoicesCache=invoices;const now=new Date();const today=startOfLocalDay(now);const weekStart=startOfWeek(now);const nextWeek=new Date(weekStart);nextWeek.setDate(nextWeek.getDate()+7);const prevWeek=new Date(weekStart);prevWeek.setDate(prevWeek.getDate()-7);const monthStart=new Date(now.getFullYear(),now.getMonth(),1);const todayTotal=sumInvoiceTotal(invoices.filter(i=>asTimestamp(i.createdAt)>=today));const weekTotal=sumInvoiceTotal(invoices.filter(i=>{const t=asTimestamp(i.createdAt);return t>=weekStart&&t<nextWeek;}));const lastWeekTotal=sumInvoiceTotal(invoices.filter(i=>{const t=asTimestamp(i.createdAt);return t>=prevWeek&&t<weekStart;}));const monthTotal=sumInvoiceTotal(invoices.filter(i=>asTimestamp(i.createdAt)>=monthStart));const allTotal=sumInvoiceTotal(invoices);document.getElementById('rep-today').textContent=fmtGHS(todayTotal);document.getElementById('rep-week').textContent=fmtGHS(weekTotal);document.getElementById('rep-last-week').textContent=fmtGHS(lastWeekTotal);document.getElementById('rep-week-delta').innerHTML=weekComparisonLabel(weekTotal,lastWeekTotal);document.getElementById('rep-month').textContent=fmtGHS(monthTotal);document.getElementById('rep-alltime').textContent=fmtGHS(allTotal);renderPaymentBreakdown(invoices,filterByLoc(getCashSales()));renderLocationBreakdown(invoices);renderTopProducts(invoices);renderMonthlyChart(invoices);renderTopCustomers(invoices,topCustomersSortMode);const dayPicker=document.getElementById('rep-day-picker');if(dayPicker&&!dayPicker.value){const d=new Date();dayPicker.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}renderSalesByDay();}
function renderPaymentBreakdown(invoices,cashSales){const paid=invoices.filter(i=>i.status==='paid');const cash=paid.filter(i=>i.payMethod==='cash').reduce((s,i)=>s+i.total,0);const momo=paid.filter(i=>i.payMethod==='momo').reduce((s,i)=>s+i.total,0);const uns=paid.filter(i=>!i.payMethod).reduce((s,i)=>s+i.total,0);const cashSalesTotal=(cashSales||[]).reduce((s,i)=>s+i.total,0);document.getElementById('payment-breakdown').innerHTML='<div style="display:grid;gap:8px"><div class="stat-card" style="padding:10px"><div class="stat-label">💵 Cash Sales (walk-in)</div><div class="stat-value" style="font-size:18px">'+fmtGHS(cashSalesTotal)+'</div></div><div class="stat-card" style="padding:10px"><div class="stat-label">Cash (from invoices)</div><div class="stat-value" style="font-size:18px">'+fmtGHS(cash)+'</div></div><div class="stat-card" style="padding:10px"><div class="stat-label">Mobile Money</div><div class="stat-value" style="font-size:18px">'+fmtGHS(momo)+'</div></div><div class="stat-card" style="padding:10px"><div class="stat-label">Unspecified Paid</div><div class="stat-value" style="font-size:18px">'+fmtGHS(uns)+'</div></div></div>';}
function renderLocationBreakdown(invoices){const locs=LOCATIONS;document.getElementById('location-breakdown').innerHTML=locs.map(l=>{const arr=invoices.filter(i=>i.location===l);return '<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-100)"><span>'+l+'</span><strong>'+fmtGHS(sumInvoiceTotal(arr))+'</strong><span class="mono" style="color:var(--gray-400)">'+arr.length+' inv</span></div>';}).join('');}
function renderTopProducts(invoices){const map={};invoices.forEach(inv=>inv.items.forEach(it=>{map[it.name]=(map[it.name]||0)+it.total;}));const top=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);document.getElementById('top-products').innerHTML=top.length?top.map(([n,t],i)=>'<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--gray-100)"><span>'+(i+1)+'. '+escapeHtml(n)+'</span><strong>'+fmtGHS(t)+'</strong></div>').join(''):'<div style="color:var(--gray-400);font-size:13px">No product sales yet</div>';}
function renderMonthlyChart(invoices){const months=[];const now=new Date();for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const next=new Date(d.getFullYear(),d.getMonth()+1,1);const total=invoices.filter(inv=>{const t=asTimestamp(inv.createdAt);return t>=d&&t<next;}).reduce((s,inv)=>s+inv.total,0);months.push({label:d.toLocaleDateString('en',{month:'short'}),total});}const max=Math.max(...months.map(m=>m.total),1);document.getElementById('monthly-chart').innerHTML=months.map(m=>{const h=Math.round(m.total/max*120);return '<div class="chart-bar-wrap"><div style="font-size:9px;color:var(--gray-400);font-family:var(--font-mono)">'+(m.total>0?'GH₵'+Math.round(m.total):'')+'</div><div class="chart-bar" style="height:'+h+'px"></div><div class="chart-bar-label">'+m.label+'</div></div>';}).join('');}

// Filters the already-loaded invoice list to a single picked calendar day —
// no extra data fetch, this just re-slices what renderReports() already has.
function renderSalesByDay(){
  const picker=document.getElementById('rep-day-picker');
  const container=document.getElementById('sales-by-day');
  if(!picker||!container)return;
  if(!picker.value){container.innerHTML='<div style="color:var(--gray-400);font-size:13px">Pick a date to see that day\'s sales</div>';return;}
  const dayStart=new Date(picker.value+'T00:00:00').getTime();
  const dayEnd=dayStart+24*60*60*1000;
  const dayInvoices=reportsInvoicesCache.filter(i=>{const t=asTimestamp(i.createdAt);return t>=dayStart&&t<dayEnd;});
  const total=sumInvoiceTotal(dayInvoices);
  const rows=dayInvoices.length
    ?dayInvoices.map(i=>'<div style="display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--gray-100);font-size:12.5px"><span class="mono" style="color:var(--gray-400)">'+escapeHtml(i.number)+'</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escapeHtml(i.customerName)+'</span><strong>'+fmtGHS(i.total)+'</strong></div>').join('')
    :'<div style="color:var(--gray-400);font-size:13px;padding:6px 0">No sales on this day</div>';
  container.innerHTML='<div style="display:flex;gap:20px;margin-bottom:10px"><div><div class="stat-label" style="font-size:9px">Total</div><div class="stat-value" style="font-size:18px">'+fmtGHS(total)+'</div></div><div><div class="stat-label" style="font-size:9px">Invoices</div><div class="stat-value" style="font-size:18px">'+dayInvoices.length+'</div></div></div>'+rows;
}

// Ranks customers by either total spend or number of orders — both numbers
// are always shown, just the bold/primary one swaps with the toggle.
function renderTopCustomers(invoices,sortBy){
  const map={};
  invoices.forEach(inv=>{
    const key=(inv.customerName||'Unknown').trim()||'Unknown';
    if(!map[key])map[key]={name:key,total:0,count:0};
    map[key].total+=inv.total;
    map[key].count+=1;
  });
  const list=Object.values(map).sort((a,b)=>sortBy==='orders'?(b.count-a.count):(b.total-a.total)).slice(0,5);
  document.getElementById('top-customers').innerHTML=list.length
    ?list.map((c,i)=>'<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:9px 0;border-bottom:1px solid var(--gray-100)"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(i+1)+'. '+escapeHtml(c.name)+'</span><span style="display:flex;align-items:baseline;gap:8px;flex-shrink:0"><span class="mono" style="color:var(--gray-400);font-size:11px">'+(sortBy==='orders'?fmtGHS(c.total):c.count+' order'+(c.count!==1?'s':''))+'</span><strong>'+(sortBy==='orders'?c.count+' order'+(c.count!==1?'s':''):fmtGHS(c.total))+'</strong></span></div>').join('')
    :'<div style="color:var(--gray-400);font-size:13px">No customer sales yet</div>';
}
function switchTopCustomersSort(mode,btn){
  topCustomersSortMode=mode;
  document.querySelectorAll('#top-customers-sort button').forEach(b=>{b.classList.remove('btn-primary');b.classList.add('btn-secondary');});
  if(btn){btn.classList.remove('btn-secondary');btn.classList.add('btn-primary');}
  renderTopCustomers(reportsInvoicesCache,topCustomersSortMode);
}

