// ============================================================
// FIX #2: Refresh datalists in all open line item rows
// Called after any product is added/edited or cache synced
// ============================================================
function refreshAllLineItemDataLists() {
  const products = getProducts();
  const opts = products.map(p => '<option value="' + escAttr(p.name) + '">').join('');

  // Refresh new invoice modal line items
  document.querySelectorAll('#line-items-body .line-item-row').forEach(row => {
    const dl = row.querySelector('datalist');
    if (dl) dl.innerHTML = opts;
  });

  // Refresh edit invoice modal line items
  document.querySelectorAll('#edit-items-container .line-item-row').forEach(row => {
    const dl = row.querySelector('datalist');
    if (dl) dl.innerHTML = opts;
  });

  // Also refresh the global product-list datalist if it exists
  const globalList = document.getElementById('product-list');
  if (globalList) globalList.innerHTML = opts;
}

// ============================================================
// CUSTOMER TYPE SELECTOR — sets price type for ALL line items
// ============================================================
function selectCustomerType(type) {
  // Sets the default for any new row added afterward, and bulk-applies to
  // every row currently on the invoice (each row can still be individually
  // changed afterward via its own sale-type select).
  window._invoicePriceType = type;
  _updateCustomerTypePills(type);
  document.querySelectorAll('#line-items-body .line-item-row').forEach(row => {
    const inputs = row.querySelectorAll('input');
    const name   = inputs[0].value.trim();
    const pi     = inputs[2];
    const sel    = row.querySelector('select');
    if (sel) sel.value = type;
    const product = getProducts().find(p => p.name.toLowerCase() === name.toLowerCase());
    if (product) {
      pi.removeAttribute('readonly');
      pi.value = Number(productPriceForType(product, type)).toFixed(2);
      pi.setAttribute('readonly', '');
    }
  });
  calcTotal();
}

function _updateCustomerTypePills(type) {
  const on  = 'flex:1;padding:9px;border:2px solid var(--brand-brown);border-radius:var(--radius);background:#fdf5ef;cursor:pointer;font-size:13px;font-weight:600;text-align:center;color:var(--brand-brown)';
  const off = 'flex:1;padding:9px;border:1px solid var(--gray-200);border-radius:var(--radius);background:var(--white);cursor:pointer;font-size:13px;font-weight:500;text-align:center;color:var(--gray-600)';
  const rEl = document.getElementById('ctype-retail');
  const wEl = document.getElementById('ctype-wholesale');
  const cEl = document.getElementById('ctype-carton');
  if (rEl) rEl.style.cssText = type === 'retail'    ? on : off;
  if (wEl) wEl.style.cssText = type === 'wholesale' ? on : off;
  if (cEl) cEl.style.cssText = type === 'carton'    ? on : off;
}

// ============================================================
// INVOICES
// ============================================================
let invoiceFilter = { text:'', status:'' };

function renderInvoices() {
  let invoices = filterByLoc(getInvoices());
  if (!isAdmin()) invoices = invoices.filter(i => i.createdBy === currentUser.id);
  if (invoiceFilter.text) { const q=invoiceFilter.text.toLowerCase(); invoices=invoices.filter(i=>i.customerName.toLowerCase().includes(q)||i.number.toLowerCase().includes(q)); }
  if (invoiceFilter.status) invoices = invoices.filter(i=>i.status===invoiceFilter.status);
  invoices.sort((a,b)=>asTimestamp(b.createdAt)-asTimestamp(a.createdAt));
  const tbody = document.getElementById('invoices-body');
  tbody.innerHTML = invoices.length===0
    ? '<tr><td colspan="10" style="text-align:center;color:var(--gray-400);padding:40px">No invoices found</td></tr>'
    : invoices.map(i=>'<tr><td class="mono" style="cursor:pointer" onclick="viewInvoice(\''+i.id+'\')">'+escapeHtml(i.number)+'</td><td class="mono">'+fmtDate(i.createdAt)+'</td><td>'+escapeHtml(i.customerName)+'</td><td><span class="badge badge-neutral">'+escapeHtml(i.location)+'</span></td><td style="color:var(--gray-600)">'+i.items.length+' item'+(i.items.length!==1?'s':'')+'</td><td class="mono" style="font-weight:500">'+fmtGHS(i.total)+'</td><td>'+statusBadge(i.status)+'</td><td>'+(i.payMethod==='cash'?'💵 Cash':i.payMethod==='momo'?'📱 MoMo':'—')+'</td><td style="color:var(--gray-400);font-size:12px">'+escapeHtml(i.createdByName || 'Unknown')+'</td><td><button class="btn btn-secondary btn-sm" onclick="viewInvoice(\''+i.id+'\')">View</button></td></tr>').join('');
}
function filterInvoices(val)      { invoiceFilter.text=val;   renderInvoices(); }
function filterInvoiceStatus(val) { invoiceFilter.status=val; renderInvoices(); }

let cashSalesFilter = '';
function filterCashSales(val) { cashSalesFilter = val; renderCashSales(); }

function renderCashSales() {
  let sales = filterByLoc(getCashSales());
  if (!isAdmin()) sales = sales.filter(i => i.createdBy === currentUser.id);
  if (cashSalesFilter) { const q=cashSalesFilter.toLowerCase(); sales=sales.filter(i=>i.customerName.toLowerCase().includes(q)||i.number.toLowerCase().includes(q)); }
  sales.sort((a,b)=>asTimestamp(b.createdAt)-asTimestamp(a.createdAt));
  const tbody = document.getElementById('cashsales-body');
  if (!tbody) return;
  tbody.innerHTML = sales.length===0
    ? '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:40px">No cash sales yet</td></tr>'
    : sales.map(i=>'<tr><td class="mono" style="cursor:pointer" onclick="viewInvoice(\''+i.id+'\')">'+escapeHtml(i.number)+'</td><td class="mono">'+fmtDate(i.createdAt)+'</td><td><span class="badge badge-neutral">'+escapeHtml(i.location)+'</span></td><td style="color:var(--gray-600)">'+i.items.length+' item'+(i.items.length!==1?'s':'')+'</td><td class="mono" style="font-weight:500">'+fmtGHS(i.total)+'</td><td style="color:var(--gray-400);font-size:12px">'+escapeHtml(i.createdByName || 'Unknown')+'</td><td><button class="btn btn-secondary btn-sm" onclick="viewInvoice(\''+i.id+'\')">View</button></td></tr>').join('');
}

function _walkInName() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return 'Walk-in - ' + pad(now.getDate()) + '/' + pad(now.getMonth()+1) + '/' + now.getFullYear() +
    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}

function openInvoiceModal(mode) {
  mode = mode === 'cash' ? 'cash' : 'invoice';
  window._invoiceMode = mode;

  lineItemCount = 0;
  document.getElementById('line-items-body').innerHTML = '';
  ['inv-cust-name','inv-cust-phone','inv-cust-addr','inv-notes','inv-momo-number'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('inv-status').value = 'pending';
  document.getElementById('invoice-total-display').textContent = 'Total: GH₵ 0.00';
  const discEl = document.getElementById('inv-discount');
  if (discEl) discEl.value = 0;
  const tenderedEl = document.getElementById('inv-cash-tendered');
  if (tenderedEl) tenderedEl.value = '';
  const changeEl = document.getElementById('inv-change-display');
  if (changeEl) changeEl.textContent = '';
  const _pmRow   = document.getElementById('payment-method-row');
  const _momoRow = document.getElementById('momo-number-row');
  const _pmCash  = document.getElementById('pm-cash');
  const _pmMomo  = document.getElementById('pm-momo');
  if (_pmRow)   _pmRow.style.display   = 'none';
  if (_momoRow) _momoRow.style.display = 'none';
  if (_pmCash)  _pmCash.style.cssText  = 'border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;text-align:center';
  if (_pmMomo)  _pmMomo.style.cssText  = 'border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;text-align:center';
  window._selectedPayMethod = '';
  const locSel = document.getElementById('inv-location');
  if (!isAdmin()) { locSel.value = currentUser.location; locSel.disabled = true; } else locSel.disabled = false;

  const titleEl   = document.getElementById('invoice-modal-title');
  const submitBtn = document.getElementById('invoice-submit-btn');
  const namePhone = document.getElementById('inv-fg-name-phone');
  const addr      = document.getElementById('inv-fg-address');
  const statusFg  = document.getElementById('inv-fg-status');
  const tenderedFg = document.getElementById('inv-fg-tendered');

  if (mode === 'cash') {
    if (namePhone) namePhone.style.display = 'none';
    if (addr)      addr.style.display      = 'none';
    if (statusFg)  statusFg.style.display  = 'none';
    if (tenderedFg) tenderedFg.style.display = 'block';
    document.getElementById('inv-cust-name').value = _walkInName();
    document.getElementById('inv-status').value = 'paid';
    window._selectedPayMethod = 'cash';
    window._invoicePriceType = 'retail';
    _updateCustomerTypePills('retail');
    if (titleEl)   titleEl.textContent   = 'Cash Sale';
    if (submitBtn) submitBtn.textContent = 'Complete Sale';
  } else {
    if (namePhone) namePhone.style.display = '';
    if (addr)      addr.style.display      = '';
    if (statusFg)  statusFg.style.display  = '';
    if (tenderedFg) tenderedFg.style.display = 'none';
    // Reset customer type to wholesale (default since all prices are wholesale)
    window._invoicePriceType = 'wholesale';
    _updateCustomerTypePills('wholesale');
    if (titleEl)   titleEl.textContent   = 'New Invoice';
    if (submitBtn) submitBtn.textContent = 'Create Invoice';
  }

  addLineItem();
  openModal('invoice-modal');
}

function onStatusChange() {
  const status  = document.getElementById('inv-status').value;
  const pmRow   = document.getElementById('payment-method-row');
  const momoRow = document.getElementById('momo-number-row');
  const showPm  = (status === 'paid' || status === 'partial');
  if (pmRow) pmRow.style.display = showPm ? 'block' : 'none';
  if (!showPm) {
    window._selectedPayMethod = '';
    if (momoRow) momoRow.style.display = 'none';
    const cb = document.getElementById('momo-same-as-mine');
    const input = document.getElementById('inv-momo-number');
    if (cb) cb.checked = false;
    if (input) { input.value = ''; input.disabled = false; input.style.opacity = '1'; }
  }
}

function selectPayMethod(method) {
  window._selectedPayMethod = method;
  const on  = 'border:2px solid var(--brand-brown);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:600;text-align:center;background:var(--gray-50)';
  const off = 'border:1px solid var(--gray-200);border-radius:var(--radius);padding:10px 14px;cursor:pointer;font-size:13px;font-weight:500;text-align:center';
  document.getElementById('pm-cash').style.cssText = method==='cash' ? on : off;
  document.getElementById('pm-momo').style.cssText = method==='momo' ? on : off;
  document.getElementById('momo-number-row').style.display = method==='momo' ? 'block' : 'none';
  if (method !== 'momo') {
    const cb = document.getElementById('momo-same-as-mine');
    const input = document.getElementById('inv-momo-number');
    if (cb) cb.checked = false;
    if (input) { input.value = ''; input.disabled = false; input.style.opacity = '1'; }
  }
}

function toggleMomoSameAsMe(checkbox) {
  const input = document.getElementById('inv-momo-number');
  if (checkbox.checked) {
    const customerPhone = document.getElementById('inv-cust-phone')?.value?.trim() || '';
    if (!customerPhone) {
      alert('Please enter the customer\'s phone number first.');
      checkbox.checked = false;
      return;
    }
    input.value = customerPhone;
    input.disabled = true;
    input.style.opacity = '0.6';
  } else {
    input.value = '';
    input.disabled = false;
    input.style.opacity = '1';
  }
}

// Each row has its own sale-type select — the Customer Type pills bulk-apply
// to all current rows and seed the default for new ones, but a customer can
// still buy some products carton/wholesale and others retail on one invoice.
function addLineItem() {
  const id   = lineItemCount++;
  const opts = getProducts().map(p=>'<option value="'+escAttr(p.name)+'">'+escapeHtml(p.name)+'</option>').join('');
  const defaultType = window._invoicePriceType || 'wholesale';
  const row  = document.createElement('div');
  row.className = 'line-item-row'; row.id = 'li-'+id;
  row.innerHTML =
    '<input type="text" list="pl-'+id+'" placeholder="Product name" oninput="onLineItemInput('+id+')" onchange="onLineItemInput('+id+')" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">'+
    '<datalist id="pl-'+id+'">'+opts+'</datalist>'+
    '<select onchange="onLineItemInput('+id+')" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">'+
      '<option value="retail"'+(defaultType==='retail'?' selected':'')+'>Retail</option>'+
      '<option value="wholesale"'+(defaultType==='wholesale'?' selected':'')+'>Wholesale</option>'+
      '<option value="carton"'+(defaultType==='carton'?' selected':'')+'>Carton</option>'+
    '</select>'+
    '<input type="number" placeholder="Qty" min="1" oninput="calcTotal()" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">'+
    '<input type="number" placeholder="0.00" min="0" step="0.01" readonly title="Price set by sale type" oninput="calcTotal()" style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none;background:var(--gray-50);color:var(--gray-400);cursor:not-allowed">'+
    '<button class="remove-item" onclick="removeLineItem('+id+')">×</button>';
  document.getElementById('line-items-body').appendChild(row);
}

function onLineItemInput(id) {
  const row = document.getElementById('li-'+id);
  if (!row) return;
  const inputs    = row.querySelectorAll('input');
  const ni        = inputs[0];
  // inp[0]=name, inp[1]=qty, inp[2]=price — <select> isn't matched by querySelectorAll('input')
  const pi        = inputs[2];
  const priceType = row.querySelector('select')?.value || window._invoicePriceType || 'wholesale';
  const m         = getProducts().find(p => p.name.toLowerCase() === ni.value.toLowerCase());
  if (m) {
    const newPrice = productPriceForType(m, priceType);
    pi.removeAttribute('readonly');
    pi.value = Number(newPrice).toFixed(2);
    pi.setAttribute('readonly', '');
    pi.style.borderColor = '#16a34a';
    pi.style.color = '#166534';
    setTimeout(() => { pi.style.borderColor = ''; pi.style.color = 'var(--gray-400)'; }, 1000);
  }
  calcTotal();
}

function removeLineItem(id) { const r=document.getElementById('li-'+id); if(r) r.remove(); calcTotal(); }

function calcTotal() {
  let subtotal = 0;
  document.querySelectorAll('#line-items-body .line-item-row').forEach(row => {
    const inp = row.querySelectorAll('input');
    // inp[0]=name(text), inp[1]=qty(number), inp[2]=price(number)
    subtotal += (parseFloat(inp[1].value) || 0) * (parseFloat(inp[2].value) || 0);
  });
  const discount = Math.max(0, parseFloat(document.getElementById('inv-discount')?.value) || 0);
  const total = Math.max(0, subtotal - discount);
  document.getElementById('invoice-total-display').textContent =
    'Subtotal: ' + fmtGHS(subtotal) +
    ' | Discount: ' + fmtGHS(discount) +
    ' | Total: ' + fmtGHS(total);
  updateChangeDisplay();
}

// Cash Sale only: shows the change due (or shortfall) as staff types in
// what the customer handed over. Purely a live display — createInvoice()
// re-derives and validates the real numbers itself before saving.
function updateChangeDisplay() {
  const changeEl = document.getElementById('inv-change-display');
  if (!changeEl) return;
  let subtotal = 0;
  document.querySelectorAll('#line-items-body .line-item-row').forEach(row => {
    const inp = row.querySelectorAll('input');
    subtotal += (parseFloat(inp[1].value) || 0) * (parseFloat(inp[2].value) || 0);
  });
  const discount = Math.max(0, parseFloat(document.getElementById('inv-discount')?.value) || 0);
  const total = Math.max(0, subtotal - discount);
  const tenderedEl = document.getElementById('inv-cash-tendered');
  const tendered = tenderedEl ? parseFloat(tenderedEl.value) || 0 : 0;
  if (!tendered) { changeEl.textContent = ''; return; }
  const change = tendered - total;
  changeEl.textContent = change >= 0 ? 'Change due: ' + fmtGHS(change) : 'Short by ' + fmtGHS(Math.abs(change));
  changeEl.style.color = change >= 0 ? 'var(--brand-green)' : 'var(--brand-red)';
}

async function createInvoice() {
  if (invoiceSaving) return;
  invoiceSaving = true;

  const name       = document.getElementById('inv-cust-name').value.trim();
  const phone      = document.getElementById('inv-cust-phone').value.trim();
  const addr       = document.getElementById('inv-cust-addr').value.trim();
  const loc        = document.getElementById('inv-location').value;
  const status     = document.getElementById('inv-status').value;
  const notes      = document.getElementById('inv-notes').value.trim();
  const discount   = Math.max(0, parseFloat(document.getElementById('inv-discount')?.value) || 0);
  const momoEl     = document.getElementById('inv-momo-number');
  const momoNumber = momoEl ? momoEl.value.trim() : '';

  const needsPayMethod = status === 'paid' || status === 'partial';
  if (needsPayMethod && !window._selectedPayMethod) {
    invoiceSaving = false;
    toast('Please select Cash or Mobile Money', 'error');
    return;
  }
  const payMethod = needsPayMethod ? (window._selectedPayMethod || '') : '';

  if (!name) { invoiceSaving = false; toast('Customer name is required', 'error'); return; }

  const rows = document.querySelectorAll('#line-items-body .line-item-row');
  if (rows.length === 0) { invoiceSaving = false; toast('Add at least one item', 'error'); return; }

  const items = [];
  let valid = true;
  rows.forEach(row => {
    const inp = row.querySelectorAll('input');
    const pn  = inp[0].value.trim();
    const qty   = parseInt(inp[1].value) || 0;
    const price = parseFloat(inp[2].value) || 0;
    const priceType = row.querySelector('select')?.value || window._invoicePriceType || 'wholesale';
    if (!pn || qty < 1 || price <= 0) { valid = false; return; }
    items.push({ name: pn, priceType, qty, price, total: qty * price });
  });

  if (!valid) { invoiceSaving = false; toast('Fill in all item fields (name, qty, price)', 'error'); return; }

  const subtotal = items.reduce((s,i)=>s+i.total,0);
  const total    = Math.max(0, subtotal - discount);
  const seq      = LS.get('lumoda_invoice_seq')||2388;
  const number   = String(seq).padStart(6,'0');
  LS.set('lumoda_invoice_seq', seq+1);

  const isCashSale = window._invoiceMode === 'cash';

  let cashTendered = null;
  if (isCashSale) {
    const tenderedEl = document.getElementById('inv-cash-tendered');
    cashTendered = tenderedEl ? parseFloat(tenderedEl.value) || 0 : 0;
    if (!cashTendered) { invoiceSaving = false; toast('Enter how much cash the customer handed over', 'error'); return; }
    if (cashTendered < total) { invoiceSaving = false; toast('Cash tendered is less than the total — check the amount', 'error'); return; }
  }

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
    isCashSale,
    cashTendered,
    createdBy:currentUser.id,
    createdByName:currentUser.fullName,
    createdAt:Date.now(),
    deleted:false
  };

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const cachedProducts = getProducts();
      const p_items = items.map(it => {
        const prod = cachedProducts.find(p => p.name.toLowerCase() === it.name.toLowerCase());
        return { product_id: prod ? prod.id : null, name: it.name, qty: it.qty, price: it.price, sale_type: it.priceType || 'retail' };
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
        p_discount:         discount || 0,
        p_is_cash_sale:     isCashSale,
        p_cash_tendered:    cashTendered
      });
      if (res.error) throw res.error;

      if (res.data && res.data.discount_pending_approval) {
        invoiceSaving = false;
        closeModal('invoice-modal');
        toast('Discount request sent — an admin needs to approve it before this sale can be completed', 'info');
        return;
      }

      await syncSupabaseCache();
      addAudit(isCashSale ? 'Cash Sale Created' : 'Invoice Created', currentUser.fullName+' created '+number+' for '+name+' — '+fmtGHS(total)+' ['+loc+']');
      invoiceSaving = false;
      closeModal('invoice-modal');
      toast(isCashSale ? 'Cash sale '+number+' recorded!' : 'Invoice '+number+' created!');
      currentLocation = 'All';
      renderDashboard();
      if (isCashSale) {
        if (document.getElementById('page-cashsales').classList.contains('active')) renderCashSales();
      } else if (document.getElementById('page-invoices').classList.contains('active')) {
        renderInvoices();
      }
      try { navigator.clipboard.writeText(generateInvoiceText(invoice)); } catch(e) {}
      if (isCashSale) printInvoice(invoice);
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
  if (!isCashSale) saveCustomerIfNew(name,phone,addr,loc);
  addAudit(isCashSale ? 'Cash Sale Created' : 'Invoice Created', currentUser.fullName+' created '+number+' for '+name+' — '+fmtGHS(total)+' ['+loc+']');
  invoiceSaving = false;
  closeModal('invoice-modal');
  toast(isCashSale ? 'Cash sale '+number+' recorded!' : 'Invoice '+number+' created!');
  currentLocation = 'All';
  renderDashboard();
  if (isCashSale) {
    if (document.getElementById('page-cashsales').classList.contains('active')) renderCashSales();
  } else if (document.getElementById('page-invoices').classList.contains('active')) {
    renderInvoices();
  }
  try { navigator.clipboard.writeText(generateInvoiceText(invoice)); } catch(e) {}
  if (isCashSale) printInvoice(invoice);
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

  // FIX #1: Mark as Paid button — always show if not already paid and user can edit
  const paidBtn = document.getElementById('view-inv-mark-paid');
  if (paidBtn) {
    paidBtn.style.display = canEditInvoice(inv) && inv.status !== 'paid' ? 'inline-flex' : 'none';
    paidBtn.onclick = () => markViewingInvoicePaid();
  }

  const editBtn = document.getElementById('view-inv-edit');
  if (editBtn) {
    editBtn.style.display = canEditInvoice(inv) ? 'inline-flex' : 'none';
    editBtn.onclick = () => openEditInvoiceModal(id);
  }

  // FIX #3: Share button — always present
  const shareBtn = document.getElementById('view-inv-share');
  if (shareBtn) {
    shareBtn.style.display = 'inline-flex';
    shareBtn.onclick = () => shareInvoice();
  }

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
        '<div style="font-family:var(--font-serif);font-style:italic;font-size:11px;opacity:.8">The cook\'s helper</div>' +
        '<div style="font-size:10px;opacity:.7;margin-top:2px">Dealers in All Kinds of Kitchen Accessories</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;white-space:nowrap;align-self:center">MAA LUCY\'S PLACE</div>' +
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
        (inv.customerPhone ? '<span style="color:var(--gray-400)">Tel:</span><span>'+escapeHtml(inv.customerPhone)+'</span>' : '') +
      '</div>' +
      (inv.customerAddress ? '<div style="font-size:13px;margin-top:4px"><span style="color:var(--gray-400)">Address:</span> '+escapeHtml(inv.customerAddress)+'</div>' : '') +
    '</div>' +

    '<table style="margin:0">' +
      '<thead>' +
        '<tr style="background:var(--brand-red)">' +
          '<th style="color:white;padding:8px 10px;font-size:11px;width:56px;text-align:center">QTY</th>' +
          '<th style="color:white;padding:8px 10px;font-size:11px">DESCRIPTION</th>' +
          '<th style="color:white;padding:8px 10px;font-size:11px;text-align:right;width:100px">UNIT PRICE</th>' +
          '<th style="color:white;padding:8px 10px;font-size:11px;text-align:right;width:110px">AMOUNT</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' +
        inv.items.map(item =>
          '<tr>' +
            '<td style="text-align:center;padding:9px 10px;font-weight:500">'+escapeHtml(item.qty)+'</td>' +
            '<td style="padding:9px 10px">'+escapeHtml(item.name)+'</td>' +
            '<td style="text-align:right;padding:9px 10px;font-family:var(--font-mono)">'+Number(item.price || 0).toFixed(2)+'</td>' +
            '<td style="text-align:right;padding:9px 10px;font-family:var(--font-mono);font-weight:600">'+Number(item.total || 0).toFixed(2)+'</td>' +
          '</tr>'
        ).join('') +
        blanks +
      '</tbody>' +
    '</table>' +

    '<div style="display:flex;flex-direction:column;align-items:flex-end;border-top:2px solid var(--brand-brown);padding:10px 14px;gap:6px">' +
      '<div><span style="font-size:13px;color:var(--gray-400)">Subtotal:</span> <span style="font-family:var(--font-mono)">'+fmtGHS(inv.subtotal || inv.total)+'</span></div>' +
      '<div><span style="font-size:13px;color:var(--gray-400)">Discount:</span> <span style="font-family:var(--font-mono)">-'+fmtGHS(inv.discount || 0)+'</span></div>' +
      '<div><span style="font-size:13px;font-weight:500">Total </span> <span style="font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--brand-brown)">'+fmtGHS(inv.total)+'</span></div>' +
      (inv.isCashSale && inv.cashTendered != null ? (
        '<div><span style="font-size:13px;color:var(--gray-400)">Cash Tendered:</span> <span style="font-family:var(--font-mono)">'+fmtGHS(inv.cashTendered)+'</span></div>' +
        '<div><span style="font-size:13px;font-weight:500">Change </span> <span style="font-family:var(--font-mono);font-size:16px;font-weight:700;color:var(--brand-green)">'+fmtGHS(Math.max(0, inv.cashTendered - inv.total))+'</span></div>'
      ) : '') +
    '</div>' +

    '<div style="padding:8px 14px;border-top:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;background:var(--gray-50)">' +
      '<span style="font-size:11px;color:var(--gray-400);font-style:italic">Goods sold out are not returnable</span>' +
      statusBadge(inv.status) +
      (inv.payMethod ? '&nbsp;&nbsp;<span class="badge badge-neutral">'+(inv.payMethod==='momo'?'📱 Mobile Money':'💵 Cash')+'</span>' : '') +
      (inv.momoNumber ? '&nbsp;<span style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">'+escapeHtml(inv.momoNumber)+'</span>' : '') +
    '</div>' +

    '<div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono);padding:6px 14px">' +
      'Location: '+escapeHtml(inv.location)+' · By: '+escapeHtml(inv.createdByName || 'Unknown')+' · '+fmtDateTime(inv.createdAt) +
    '</div>' +

    (inv.notes ? '<div style="margin-top:10px;padding:10px;background:var(--gray-50);border-radius:var(--radius);font-size:13px;color:var(--gray-600)">'+escapeHtml(inv.notes)+'</div>' : '') +
    (inv.deleted ? '<div style="margin-top:10px;padding:8px 12px;background:#fee2e2;border-radius:var(--radius);font-size:12px;color:#991b1b">⚠ Deleted by '+escapeHtml(inv.deletedBy)+' on '+fmtDateTime(inv.deletedAt)+'</div>' : '') +
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

// ============================================================
// FIX #3: Share invoice — works on all platforms
// Uses native share if available (mobile), otherwise WhatsApp
// with a copy-to-clipboard fallback for long text
// ============================================================
function shareInvoice() {
  const inv = getAllInvoices().find(i => i.id === viewingInvoiceId);
  if (!inv) return;

  const text = generateInvoiceText(inv);

  // Try native Web Share API (works on mobile browsers with HTTPS)
  if (navigator.share) {
    navigator.share({
      title: 'Invoice ' + inv.number + ' — ' + inv.customerName,
      text: text
    }).catch(err => {
      // User cancelled or API failed — fall through to manual share
      if (err && err.name !== 'AbortError') {
        _shareViaWhatsAppOrCopy(inv, text);
      }
    });
    return;
  }

  // No native share — open share sheet manually
  _shareViaWhatsAppOrCopy(inv, text);
}

function _shareViaWhatsAppOrCopy(inv, text) {
  // Build share sheet overlay
  const existing = document.getElementById('share-sheet-overlay');
  if (existing) existing.remove();

  // Truncate for WhatsApp URL (max ~2000 chars safe)
  const shortText = text.length > 1500
    ? text.substring(0, 1480) + '\n...\n(See full invoice in app)'
    : text;

  const waUrl = 'https://wa.me/?text=' + encodeURIComponent(shortText);

  const overlay = document.createElement('div');
  overlay.id = 'share-sheet-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML = `
    <div style="background:white;border-radius:16px 16px 0 0;padding:24px;width:100%;max-width:480px;box-shadow:0 -4px 24px rgba(0,0,0,0.15)">
      <div style="font-weight:700;font-size:16px;margin-bottom:6px">Share Invoice ${escapeHtml(inv.number)}</div>
      <div style="font-size:13px;color:#666;margin-bottom:20px">${escapeHtml(inv.customerName)} · ${fmtGHS(inv.total)}</div>
      <div style="display:grid;gap:10px">
        <a href="${escapeHtml(waUrl)}" target="_blank" rel="noopener"
           style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;color:inherit;font-size:14px;font-weight:500"
           onclick="document.getElementById('share-sheet-overlay').remove()">
          <span style="font-size:24px">💬</span> Share via WhatsApp
        </a>
        <button onclick="_copyAndCloseShare()" 
           style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;background:white;cursor:pointer;font-size:14px;font-weight:500;width:100%;text-align:left">
          <span style="font-size:24px">📋</span> Copy invoice text
        </button>
        <button onclick="_sendViaSMS()"
           style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;background:white;cursor:pointer;font-size:14px;font-weight:500;width:100%;text-align:left">
          <span style="font-size:24px">📱</span> Send as SMS
        </button>
      </div>
      <button onclick="document.getElementById('share-sheet-overlay').remove()"
         style="margin-top:14px;width:100%;padding:12px;border:none;background:#f3f4f6;border-radius:10px;font-size:14px;font-weight:500;cursor:pointer">
        Cancel
      </button>
    </div>
  `;

  // Close on backdrop click
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Store text for copy/SMS actions
  window._pendingShareText = text;
  window._pendingShareInv  = inv;
}

function _copyAndCloseShare() {
  const text = window._pendingShareText || '';
  navigator.clipboard.writeText(text)
    .then(() => toast('Invoice text copied to clipboard!'))
    .catch(() => {
      // Fallback for browsers without clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast('Invoice text copied!');
    });
  const overlay = document.getElementById('share-sheet-overlay');
  if (overlay) overlay.remove();
}

function _sendViaSMS() {
  const inv  = window._pendingShareInv;
  const text = window._pendingShareText || '';
  const phone = inv?.customerPhone ? inv.customerPhone.replace(/\s+/g,'') : '';
  const smsUrl = phone
    ? 'sms:' + phone + '?body=' + encodeURIComponent(text.substring(0, 800))
    : 'sms:?body=' + encodeURIComponent(text.substring(0, 800));
  window.open(smsUrl, '_blank');
  const overlay = document.getElementById('share-sheet-overlay');
  if (overlay) overlay.remove();
}

// ============================================================
// FIX #1: Mark as Paid — waits for cache before refreshing modal
// ============================================================
async function markViewingInvoicePaid() {
  const inv = getAllInvoices().find(i=>i.id===viewingInvoiceId);
  if (!inv) return;
  if (!requireInvoiceEdit(inv, 'mark paid')) return;

  // Show inline payment method picker instead of browser prompt
  _showMarkPaidDialog(inv);
}

function _showMarkPaidDialog(inv) {
  const existing = document.getElementById('mark-paid-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mark-paid-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:white;border-radius:12px;padding:24px;width:100%;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
      <div style="font-weight:700;font-size:16px;margin-bottom:4px">Mark Invoice as Paid</div>
      <div style="font-size:13px;color:#666;margin-bottom:20px">Invoice ${escapeHtml(inv.number)} · ${fmtGHS(inv.total)}</div>

      <div style="font-size:13px;font-weight:600;margin-bottom:10px">Payment Method</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
        <button id="mpd-cash" onclick="_selectMpdMethod('cash')"
          style="padding:14px;border:2px solid #e5e7eb;border-radius:10px;background:white;cursor:pointer;font-size:14px;font-weight:500">
          💵 Cash
        </button>
        <button id="mpd-momo" onclick="_selectMpdMethod('momo')"
          style="padding:14px;border:2px solid #e5e7eb;border-radius:10px;background:white;cursor:pointer;font-size:14px;font-weight:500">
          📱 MoMo
        </button>
      </div>

      <div id="mpd-momo-row" style="display:none;margin-bottom:16px">
        <label style="font-size:13px;font-weight:500;display:block;margin-bottom:6px">MoMo Number (optional)</label>
        <input id="mpd-momo-number" type="tel" placeholder="e.g. 0244123456"
          style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;box-sizing:border-box">
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button onclick="document.getElementById('mark-paid-overlay').remove()"
          style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:white;cursor:pointer;font-size:13px;font-weight:500">
          Cancel
        </button>
        <button onclick="_confirmMarkPaid('${escapeHtml(inv.id)}')"
          style="padding:12px;border:none;border-radius:8px;background:var(--brand-brown,#5C2D0A);color:white;cursor:pointer;font-size:13px;font-weight:600">
          Confirm Paid
        </button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  window._mpdMethod = '';
}

function _selectMpdMethod(method) {
  window._mpdMethod = method;
  const on  = 'padding:14px;border:2px solid var(--brand-brown,#5C2D0A);border-radius:10px;background:#fdf8f3;cursor:pointer;font-size:14px;font-weight:600';
  const off = 'padding:14px;border:2px solid #e5e7eb;border-radius:10px;background:white;cursor:pointer;font-size:14px;font-weight:500';
  document.getElementById('mpd-cash').style.cssText = method === 'cash' ? on : off;
  document.getElementById('mpd-momo').style.cssText = method === 'momo' ? on : off;
  document.getElementById('mpd-momo-row').style.display = method === 'momo' ? 'block' : 'none';
}

async function _confirmMarkPaid(invId) {
  if (!window._mpdMethod) { toast('Please select Cash or MoMo', 'error'); return; }
  const momoNumber = document.getElementById('mpd-momo-number')?.value.trim() || '';

  const overlay = document.getElementById('mark-paid-overlay');
  if (overlay) overlay.remove();

  // FIX #1: updateInvoice now awaits cache sync before calling viewInvoice
  await updateInvoice(invId, {
    status: 'paid',
    payMethod: window._mpdMethod,
    momoNumber
  });
}

function generateInvoiceText(inv) {
  const sep = '─'.repeat(58);
  const rows = inv.items.map(item => {
    const qty    = String(item.qty || '').padEnd(5);
    const label  = item.name;
    const name   = String(label || '').substring(0, 28).padEnd(28);
    const unit   = Number(item.price || 0).toFixed(2).padStart(10);
    const amount = Number(item.total || 0).toFixed(2).padStart(11);
    return `${qty} ${name} ${unit} ${amount}`;
  }).join('\n');

  return `
${'━'.repeat(58)}
LUMODA ENTERPRISE
The cook's helper
Dealers in All Kinds of Kitchen Accessories
MAA LUCY'S PLACE
${'━'.repeat(58)}

LOCATION 1: Alabar, Ghana Region
Shop No. OCL/ZR/GF/A20 and A21

LOCATION 2: Morocco (K.O) OLD Barbers Building
Shop No. GF 26

TEL: 0244369357 / 0546014044 / 0243563481

${'━'.repeat(58)}
INVOICE
No: ${inv.number}
Date: ${fmtDate(inv.createdAt)}

Customer: ${inv.customerName}
${inv.customerPhone ? 'Phone: ' + inv.customerPhone : ''}
${inv.customerAddress ? 'Address: ' + inv.customerAddress : ''}

${sep}
QTY   DESCRIPTION                    UNIT PRICE     AMOUNT
${sep}
${rows}
${sep}

Subtotal: ${fmtGHS(inv.subtotal || inv.total)}
Discount: ${fmtGHS(inv.discount || 0)}
Total: ${fmtGHS(inv.total)}

Status: ${String(inv.status || '').toUpperCase()}
${inv.payMethod ? 'Payment: ' + (inv.payMethod === 'momo' ? 'Mobile Money' + (inv.momoNumber ? ' (' + inv.momoNumber + ')' : '') : 'Cash') : ''}
${inv.notes ? 'Notes: ' + inv.notes : ''}

Goods sold out are not returnable.
`.trim();
}

// ==========================
// INVOICE EDIT FEATURE
// ==========================
let editingInvoiceId = null;

function openEditInvoiceModal(id) {
  const inv = getAllInvoices().find(i => i.id === id);
  if (!inv) return;
  if (!requireInvoiceEdit(inv, 'edit')) return;

  editingInvoiceId = id;

  document.querySelector('#edit-customer-name').value = inv.customerName || '';
  document.querySelector('#edit-phone').value         = inv.customerPhone || '';
  document.querySelector('#edit-address').value       = inv.customerAddress || '';
  document.querySelector('#edit-notes').value         = inv.notes || '';
  document.querySelector('#edit-status').value        = inv.status || 'pending';
  document.querySelector('#edit-pay-method').value    = inv.payMethod || '';

  // Default sale type for any NEW row added during this edit — the mode
  // (most common) type across existing items, not a lock on every row.
  // Customers can legitimately buy some products carton/wholesale and
  // others retail within the same invoice, so each row keeps its own type.
  const typeCounts = {};
  (inv.items || []).forEach(it => { const t = it.priceType || 'wholesale'; typeCounts[t] = (typeCounts[t] || 0) + 1; });
  let modeType = 'wholesale', modeCount = 0;
  Object.keys(typeCounts).forEach(t => { if (typeCounts[t] > modeCount) { modeType = t; modeCount = typeCounts[t]; } });
  window._editInvoicePriceType = modeType;

  // FIX #2 / #6: renderEditItems pulls fresh products each time
  renderEditItems(inv.items || []);

  openModal('edit-invoice-modal');
}

async function saveEditedInvoice() {
  if (editInvoiceSaving) return;
  editInvoiceSaving = true;

  const id       = editingInvoiceId;
  const existing = getAllInvoices().find(i => i.id === id);
  if (!requireInvoiceEdit(existing, 'edit')) { editInvoiceSaving = false; return; }

  const rows = document.querySelectorAll('#edit-items-container .line-item-row');
  if (rows.length === 0) { editInvoiceSaving = false; toast('Add at least one item', 'error'); return; }

  // Every row must be fully valid — don't silently drop incomplete rows (e.g. a
  // product whose locked price tier resolves to 0), block save with a toast instead.
  let allValid = true;
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const name   = inputs[0].value.trim();
    const qty    = parseInt(inputs[1].value) || 0;
    const priceInput = inputs[2];
    const price  = parseFloat(priceInput.value) || parseFloat(priceInput.getAttribute('value')) || 0;
    if (!name || qty < 1 || price <= 0) allValid = false;
  });
  if (!allValid) { editInvoiceSaving = false; toast('Fill in all item fields (name, qty, price)', 'error'); return; }

  const items = collectEditedItems();
  if (!items.length) { editInvoiceSaving = false; toast('Add at least one item', 'error'); return; }

  const status = document.querySelector('#edit-status').value || 'pending';
  const needsPayMethod = status === 'paid' || status === 'partial';
  const payMethod = needsPayMethod ? document.querySelector('#edit-pay-method').value : '';
  if (needsPayMethod && !payMethod) { editInvoiceSaving = false; toast('Select a payment method for paid/partial invoices', 'error'); return; }

  const subtotal = calculateTotal(items);
  const updates  = {
    customerName:    document.querySelector('#edit-customer-name').value.trim(),
    customerPhone:   document.querySelector('#edit-phone').value.trim(),
    customerAddress: document.querySelector('#edit-address').value.trim(),
    notes:           document.querySelector('#edit-notes').value.trim(),
    status,
    payMethod,
    items,
    subtotal,
    total: Math.max(0, subtotal - (existing.discount || 0)),
  };

  const saved = await updateInvoice(id, updates);
  editInvoiceSaving = false;
  if (saved) closeModal('edit-invoice-modal');
}

// ============================================================
// FIX #1 + #6: updateInvoice — awaits cache before re-rendering
// ============================================================
async function updateInvoice(id, updates) {
  const existing = getAllInvoices().find(i => i.id === id) || {};
  if (!requireInvoiceEdit(existing, 'edit')) return false;

  const itemsExplicitlyChanged = Object.prototype.hasOwnProperty.call(updates, 'items');
  const mergedUpdates = {
    ...existing,
    ...updates,
    items: itemsExplicitlyChanged ? updates.items : existing.items,
    // FIX BUG 1: Flag tells updateInvoiceNoStock whether to touch invoice_items
    // When marking paid (no items in updates), this is false → items are NEVER deleted
    _itemsChanged: itemsExplicitlyChanged
  };

  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const res = await window.LumodaSupabase.updateInvoiceNoStock(id, mergedUpdates);
      if (res.error) throw res.error;

      // FIX #1: Wait for full cache sync BEFORE re-rendering the modal
      await syncSupabaseCache();

      addAudit('Invoice Edited', currentUser.fullName+' edited invoice '+id+' [server]');
      if (res.data && res.data.items_pending_approval) {
        toast('Saved — but removing/reducing an item needs admin approval first, so that part is on hold', 'info');
      } else {
        toast('Invoice updated');
      }

      // Now re-render — cache is fresh so status/items show correctly
      viewInvoice(id);
      renderPage('invoices');
      renderDashboard();
      return true;
    } catch (err) {
      toast(err.message || 'Could not update invoice', 'error');
      return false;
    }
  }

  // Local storage path
  const invoices = LS.get('lumoda_invoices') || [];
  const idx      = invoices.findIndex(i => i.id === id);
  if (idx < 0) return false;

  invoices[idx] = {
    ...invoices[idx],
    ...mergedUpdates,
    updatedAt: Date.now(),
    updatedBy: currentUser?.username
  };
  LS.set('lumoda_invoices', invoices);

  addAudit('Invoice Edited', currentUser.fullName+' edited invoice '+(invoices[idx].number || id)+' [local]');
  toast('Invoice updated');

  // FIX #1: re-read from updated localStorage — will show new status immediately
  viewInvoice(id);
  renderPage('invoices');
  renderDashboard();
  return true;
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.price || 0)), 0);
}

// FIX #2/#6: renderEditItems always uses fresh product list
function renderEditItems(items) {
  const container = document.getElementById('edit-items-container');
  if (!container) return;
  container.innerHTML = '';
  (items || []).forEach(item => addItem(item));
  calcEditTotal();
}

// FIX #5: qty starts empty in edit modal too
function addItem(item = {}) {
  const container = document.getElementById('edit-items-container');
  if (!container) return;

  const uid = 'edit-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

  // FIX #2: Always get fresh products at the moment the row is created
  const opts = getProducts()
    .map(p => `<option value="${escAttr(p.name)}">${escapeHtml(p.name)}</option>`)
    .join('');

  const row = document.createElement('div');
  row.className = 'line-item-row';
  row.id = uid;

  // qty: empty placeholder unless editing existing item
  const qtyVal   = item.qty   != null ? escAttr(item.qty)   : '';
  const priceVal = item.price != null ? escAttr(item.price) : '';
  // Existing items keep their own stored sale type; a brand-new row defaults
  // to the invoice's dominant type but can still be changed per-row.
  const rowPriceType = item.priceType || window._editInvoicePriceType || 'wholesale';

  row.innerHTML = `
    <input type="text"
      list="pl-${uid}"
      placeholder="Product name"
      value="${escAttr(item.name || '')}"
      oninput="onEditItemInput('${uid}')"
      onchange="onEditItemInput('${uid}')"
      style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">
    <datalist id="pl-${uid}">${opts}</datalist>

    <select onchange="onEditItemInput('${uid}')"
      style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">
      <option value="retail"    ${rowPriceType === 'retail'    ? 'selected' : ''}>Retail</option>
      <option value="wholesale" ${rowPriceType === 'wholesale' ? 'selected' : ''}>Wholesale</option>
      <option value="carton"    ${rowPriceType === 'carton'    ? 'selected' : ''}>Carton</option>
    </select>

    <input type="number" value="${qtyVal}" min="1" placeholder="Qty" oninput="calcEditTotal()"
      style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none">

    <input type="number" value="${priceVal}" min="0" step="0.01" placeholder="0.00"
      readonly title="Price is set automatically"
      oninput="calcEditTotal()"
      style="padding:5px 7px;border:1px solid var(--gray-200);border-radius:var(--radius);font-size:12px;width:100%;font-family:var(--font-sans);outline:none;background:var(--gray-50);color:var(--gray-400);cursor:not-allowed">

    <button type="button" class="remove-item" onclick="(function(){var r=document.getElementById('${uid}');if(r)r.remove();calcEditTotal();})();">×</button>
  `;

  container.appendChild(row);
  calcEditTotal();
}

function onEditItemInput(uid) {
  const row = document.getElementById(uid);
  if (!row) return;

  const inputs     = row.querySelectorAll('input');
  const priceInput = inputs[2];
  const name       = inputs[0].value.trim();
  const priceType  = row.querySelector('select')?.value || window._editInvoicePriceType || 'wholesale';

  const product = getProducts().find(p =>
    p.name.toLowerCase() === name.toLowerCase()
  );

  if (product) {
    const newPrice = productPriceForType(product, priceType);
    // Must remove readonly to set value programmatically then restore
    priceInput.removeAttribute('readonly');
    priceInput.value = Number(newPrice).toFixed(2);
    priceInput.setAttribute('readonly', '');
    // Flash green to confirm price updated
    priceInput.style.borderColor = '#16a34a';
    priceInput.style.color = '#166534';
    setTimeout(() => {
      priceInput.style.borderColor = '';
      priceInput.style.color = 'var(--gray-400)';
    }, 1000);
  }

  calcEditTotal();
}

function collectEditedItems() {
  const rows  = document.querySelectorAll('#edit-items-container .line-item-row');
  const items = [];
  rows.forEach(row => {
    const inputs    = row.querySelectorAll('input');
    const name      = inputs[0].value.trim();
    const priceType = row.querySelector('select')?.value || window._editInvoicePriceType || 'wholesale';
    const qty       = parseInt(inputs[1].value) || 0;
    // Read price robustly — handle readonly fields in all browsers
    const priceInput = inputs[2];
    const price = parseFloat(priceInput.value) ||
                  parseFloat(priceInput.getAttribute('value')) || 0;
    if (name && qty > 0 && price > 0) {
      items.push({ name, priceType, qty, price, total: qty * price });
    }
  });
  return items;
}

function calcEditTotal() {
  const el = document.getElementById('edit-invoice-total-display');
  if (!el) return;
  const items    = collectEditedItems();
  const subtotal = calculateTotal(items);
  el.textContent = items.length > 0
    ? 'Subtotal: ' + fmtGHS(subtotal) + '  |  Items: ' + items.length
    : 'Total: GH₵ 0.00';
}

function loadProductSuggestions(products) {
  const list = document.getElementById('product-list');
  if (!list) return;
  list.innerHTML = products.map(p => `<option value="${escAttr(p.name)}"></option>`).join('');
  // Also refresh any open line item datalists
  refreshAllLineItemDataLists();
}

// ============================================================
// PRINT INVOICE
// ============================================================
function printInvoice(inv) {
  inv = inv || getAllInvoices().find(i => i.id === viewingInvoiceId);
  if (!inv) return;

  const pmLine = inv.payMethod
    ? '<div style="margin-top:6px;font-size:12px"><strong>Payment:</strong> ' +
      (inv.payMethod === 'momo' ? 'Mobile Money' + (inv.momoNumber ? ' — ' + escapeHtml(inv.momoNumber) : '') : 'Cash') + '</div>'
    : '';

  const noteLine = inv.notes
    ? '<div style="margin-top:6px;font-size:12px"><strong>Notes:</strong> ' + escapeHtml(inv.notes) + '</div>'
    : '';

  const blanks = Array(Math.max(0, 8 - inv.items.length))
    .fill(`<tr><td style="padding:8px 6px;border-bottom:1px solid #eee">&nbsp;</td><td style="border-bottom:1px solid #eee"></td><td style="border-bottom:1px solid #eee"></td><td style="border-bottom:1px solid #eee"></td></tr>`)
    .join('');

  const rows = inv.items.map(item => `
    <tr>
      <td style="text-align:center;padding:8px 6px;border-bottom:1px solid #eee">${item.qty}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #eee">${escapeHtml(item.name)}</td>
      <td style="text-align:right;padding:8px 6px;border-bottom:1px solid #eee;font-family:monospace">${Number(item.price || 0).toFixed(2)}</td>
      <td style="text-align:right;padding:8px 6px;border-bottom:1px solid #eee;font-family:monospace;font-weight:700">${Number(item.total || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  const html = `
    <div style="font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:#000;max-width:620px;margin:0 auto">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#5C2D0A;color:white;padding:12px 16px">
        <tr>
          <td>
            <div style="font-size:20px;font-weight:800;letter-spacing:1px">LUMODA ENTERPRISE</div>
            <div style="font-style:italic;font-size:12px;opacity:.9">The cook's helper</div>
            <div style="font-size:10px;opacity:.75">Dealers in All Kinds of Kitchen Accessories</div>
            <div style="font-size:10px;opacity:.85;margin-top:3px">Tel: 0244369357 / 0546014044 / 0243563481</div>
          </td>
          <td align="right">
            <div style="border:1px solid rgba(255,255,255,.45);padding:4px 10px;font-size:11px;font-weight:700">MAA LUCY'S PLACE</div>
          </td>
        </tr>
      </table>
      <div style="background:#C8291C;color:white;padding:8px 14px;display:flex;justify-content:space-between;font-weight:700;letter-spacing:.08em">
        <span>INVOICE</span><span>No: ${escapeHtml(inv.number)}</span><span>${fmtDate(inv.createdAt)}</span>
      </div>
      <div style="padding:12px 14px;border-left:2px solid #5C2D0A;border-right:2px solid #5C2D0A">
        <div><strong>Customer:</strong> ${escapeHtml(inv.customerName)}</div>
        ${inv.customerPhone ? '<div><strong>Tel:</strong> '+escapeHtml(inv.customerPhone)+'</div>' : ''}
        ${inv.customerAddress ? '<div><strong>Address:</strong> '+escapeHtml(inv.customerAddress)+'</div>' : ''}
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-left:2px solid #5C2D0A;border-right:2px solid #5C2D0A">
        <thead>
          <tr style="background:#C8291C;color:white">
            <th style="padding:8px 6px;width:56px;text-align:center">QTY</th>
            <th style="padding:8px 6px;text-align:left">DESCRIPTION</th>
            <th style="padding:8px 6px;text-align:right">UNIT PRICE</th>
            <th style="padding:8px 6px;text-align:right">AMOUNT</th>
          </tr>
        </thead>
        <tbody>${rows}${blanks}</tbody>
      </table>
      <div style="border:2px solid #5C2D0A;border-top:0;padding:12px 14px">
        <div style="text-align:right;font-size:13px;color:#555">Subtotal: ${fmtGHS(inv.subtotal || inv.total)}</div>
        <div style="text-align:right;font-size:13px;color:#555">Discount: -${fmtGHS(inv.discount || 0)}</div>
        <div style="text-align:right;font-size:16px;font-weight:800">Total: ${fmtGHS(inv.total)}</div>
        ${inv.isCashSale && inv.cashTendered != null ? `
        <div style="text-align:right;font-size:13px;color:#555">Cash Tendered: ${fmtGHS(inv.cashTendered)}</div>
        <div style="text-align:right;font-size:15px;font-weight:800;color:#1a7a3c">Change: ${fmtGHS(Math.max(0, inv.cashTendered - inv.total))}</div>
        ` : ''}
        <div style="margin-top:8px;font-size:11px;color:#555">
          <strong>Status:</strong> ${escapeHtml(inv.status.toUpperCase())}
          ${pmLine}${noteLine}
        </div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:#555">Prepared By: ${escapeHtml(inv.createdByName || 'System')}</div>
      <div style="margin-top:16px;text-align:center;font-size:10px;color:#666">Goods sold out are not returnable</div>
    </div>
  `;

  const printArea = document.getElementById('print-area');
  printArea.innerHTML = html;
  window.print();
}
