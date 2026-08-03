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
  // JSON.stringify safely encodes each value as a JS string literal; escAttr then
  // HTML-escapes the whole thing so it's safe inside the double-quoted attribute
  // (fixes attribute-injection XSS for names containing a double quote).
  box.innerHTML=matches.map(c=>{
    const call = 'selectCustomerSuggestion(' + JSON.stringify(c.name||'') + ',' + JSON.stringify(c.phone||'') + ',' + JSON.stringify(c.address||'') + ')';
    return '<div style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--gray-50)" onmousedown="'+escAttr(call)+'" onmouseover="this.style.background=\'var(--gray-50)\'" onmouseout="this.style.background=\'\'"><strong>'+escapeHtml(c.name)+'</strong>'+(c.phone?'<span style="color:var(--gray-400);font-size:11px;margin-left:6px">'+escapeHtml(c.phone)+'</span>':'')+'</div>';
  }).join('');
}
function selectCustomerSuggestion(name,phone,addr) { document.getElementById('inv-cust-name').value=name; document.getElementById('inv-cust-phone').value=phone; document.getElementById('inv-cust-addr').value=addr; document.getElementById('cust-suggestions').style.display='none'; }

