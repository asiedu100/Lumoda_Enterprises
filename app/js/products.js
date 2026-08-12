// ============================================================
// PRODUCTS
// ============================================================
let productSearch = '';
function renderProducts() {
  const csvBtn   = document.getElementById('btn-import-csv');
  const addBtn   = document.getElementById('btn-add-product');
  const orderBtn = document.getElementById('btn-order-stock');
  const linkBtn  = document.getElementById('btn-link-warehouse');
  if (csvBtn)   csvBtn.style.display   = isAdmin() ? 'inline-flex' : 'none';
  if (addBtn)   addBtn.style.display   = isAdmin() ? 'inline-flex' : 'none';
  if (orderBtn) orderBtn.style.display = isAdmin() ? 'inline-flex' : 'none';
  if (linkBtn)  linkBtn.style.display  = isAdmin() ? 'inline-flex' : 'none';
  let products = getProducts();
  const totalCount = products.length;
  if(productSearch){const q=productSearch.toLowerCase();products=products.filter(p=>p.name.toLowerCase().includes(q)||p.category.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q));}
  const countEl = document.getElementById('products-count');
  if (countEl) countEl.textContent = productSearch ? products.length+' of '+totalCount+' products' : totalCount+' product'+(totalCount!==1?'s':'');
  const effLoc=isAdmin()?currentLocation:currentUser.location;
  document.getElementById('products-body').innerHTML = products.map(p=>{
    const sA=p.stockAlabar,sM=p.stockMorocco,comb=effLoc==='Morocco'?sM:effLoc==='Alabar'?sA:Math.min(sA,sM);
    const adjBtn=isAdmin()?'<button class="btn btn-secondary btn-sm" onclick="openStockAdjust(\''+p.id+'\')">Adjust</button>':'';
    const editBtn=isAdmin()?'<button class="btn btn-secondary btn-sm" onclick="editProduct(\''+p.id+'\')">Edit</button>':'';
    const priceHtml = '<div style="font-weight:600;font-size:13px;color:var(--gray-800);margin-bottom:3px">'+fmtGHS(p.retailPrice||p.price)+'</div><div style="display:flex;gap:10px;font-size:10.5px;font-family:var(--font-mono);color:var(--gray-400);white-space:nowrap"><span title="Wholesale price">W '+fmtGHS(p.wholesalePrice)+'</span><span title="Carton price">C '+fmtGHS(p.cartonPrice)+'</span></div>';
    // Same red/amber accent language as the warehouse stock table, so a
    // low/out-of-stock product reads the same way across both areas.
    const isOut = comb === 0, isLow = comb <= p.reorder;
    const rowBg = isOut ? 'background:#fef2f2' : isLow ? 'background:#fefce8' : '';
    const stripeClr = isOut ? '#dc2626' : isLow ? '#f59e0b' : 'transparent';
    return '<tr style="'+rowBg+'"><td style="font-weight:500;box-shadow:inset 3px 0 0 '+stripeClr+'">'+escapeHtml(p.name)+'</td><td class="mono">'+escapeHtml(p.sku)+'</td><td style="color:var(--gray-400)">'+escapeHtml(p.category)+'</td><td>'+priceHtml+'</td><td class="mono" style="text-align:center;color:'+(sA<=p.reorder?'#dc2626':'inherit')+'">'+sA+'</td><td class="mono" style="text-align:center;color:'+(sM<=p.reorder?'#dc2626':'inherit')+'">'+sM+'</td><td>'+stockBadge(comb,p.reorder)+'</td><td class="mono" style="color:var(--gray-400)">'+p.reorder+'</td><td style="display:flex;gap:6px">'+adjBtn+editBtn+'</td></tr>';
  }).join('');
}
function filterProducts(val){productSearch=val;renderProducts();}
function openProductModal(){if(!requireAdmin('add products'))return;editingProductId=null;document.getElementById('prod-modal-title').textContent='New Product';['prod-name','prod-sku','prod-category','prod-price','prod-wholesale-price','prod-carton-price','prod-stock-alabar','prod-stock-morocco','prod-reorder'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('prod-reorder').value=getDefaultReorderLevel();openModal('product-modal');}
function editProduct(id){if(!requireAdmin('edit products'))return;const prod=getProducts().find(p=>p.id===id);if(!prod)return;editingProductId=id;document.getElementById('prod-modal-title').textContent='Edit Product';document.getElementById('prod-name').value=prod.name;document.getElementById('prod-sku').value=prod.sku;document.getElementById('prod-category').value=prod.category;document.getElementById('prod-price').value=prod.price;document.getElementById('prod-wholesale-price').value=prod.wholesalePrice;document.getElementById('prod-carton-price').value=prod.cartonPrice;document.getElementById('prod-stock-alabar').value=prod.stockAlabar;document.getElementById('prod-stock-morocco').value=prod.stockMorocco;document.getElementById('prod-reorder').value=prod.reorder;openModal('product-modal');}

async function saveProduct(){
  if(!requireAdmin('save products'))return;
  const name=document.getElementById('prod-name').value.trim();
  const price=parseFloat(document.getElementById('prod-price').value);
  if(!name||isNaN(price)){toast('Name and retail price required','error');return;}
  if(price<0){toast('Retail price cannot be negative','error');return;}
  const wholesalePrice=parseFloat(document.getElementById('prod-wholesale-price').value);
  const cartonPrice=parseFloat(document.getElementById('prod-carton-price').value);
  if((!isNaN(wholesalePrice)&&wholesalePrice<0)||(!isNaN(cartonPrice)&&cartonPrice<0)){toast('Prices cannot be negative','error');return;}
  const products=getProducts();
  const sA=parseInt(document.getElementById('prod-stock-alabar').value)||0;
  const sM=parseInt(document.getElementById('prod-stock-morocco').value)||0;
  const reorder=parseInt(document.getElementById('prod-reorder').value)||getDefaultReorderLevel();
  if(sA<0||sM<0||reorder<0){toast('Stock and reorder level cannot be negative','error');return;}
  const sku=document.getElementById('prod-sku').value.trim()||'SKU-'+Date.now();
  const cat=document.getElementById('prod-category').value.trim()||'General';
  // FIX: if wholesale/carton fields are left blank when editing,
  // keep the existing stored value — don't overwrite with retail price
  const existingProduct = editingProductId ? getProducts().find(p => p.id === editingProductId) : null;
  const resolvedWholesale = isNaN(wholesalePrice)
    ? (existingProduct ? existingProduct.wholesalePrice : price)
    : wholesalePrice;
  const resolvedCarton = isNaN(cartonPrice)
    ? (existingProduct ? existingProduct.cartonPrice : resolvedWholesale)
    : cartonPrice;

  const payload={
    id:editingProductId,
    name,sku,category:cat,
    price,retailPrice:price,
    wholesalePrice: resolvedWholesale,
    cartonPrice:    resolvedCarton,
    stockAlabar:sA,stockMorocco:sM,reorder
  };

  if(window.LumodaSupabase&&window.LumodaSupabase.isConfigured()&&window.LumodaSupabase.saveProduct){
    try{
      const res=await window.LumodaSupabase.saveProduct(payload);
      if(res.error)throw res.error;
      await syncSupabaseCache();
      // FIX #2: syncSupabaseCache already calls refreshAllLineItemDataLists
      addAudit(editingProductId?'Product Updated':'Product Added',currentUser.fullName+' saved "'+name+'" [server]');
      closeModal('product-modal');
      toast('Product saved');
      renderProducts();
      return;
    }catch(err){
      toast(err.message||'Could not save product','error');
      return;
    }
  }

  // Local storage path
  if(editingProductId){
    const idx=products.findIndex(p=>p.id===editingProductId);
    if(idx>=0){products[idx]={...products[idx],...payload};addAudit('Product Updated',currentUser.fullName+' updated "'+name+'"');}
  }else{
    products.push({...payload,id:'p_'+Date.now()});
    addAudit('Product Added',currentUser.fullName+' added "'+name+'" @ '+fmtGHS(price));
  }
  LS.set('lumoda_products',normalizeProducts(products));

  // FIX #2: Refresh all open datalists immediately after local save
  loadProductSuggestions(getProducts());

  closeModal('product-modal');
  toast('Product saved');
  renderProducts();
}

function orderStock(){if(!requireAdmin('order stock'))return;const low=getProducts().filter(p=>p.stockAlabar<=p.reorder||p.stockMorocco<=p.reorder);if(low.length===0){toast('No restocking needed');return;}const text=getBusinessName()+' — Restock Order\n\n'+low.map(p=>'• '+p.name+' ('+p.sku+')\n  Alabar: '+p.stockAlabar+' | Morocco: '+p.stockMorocco+' | Reorder at: '+p.reorder).join('\n');try{navigator.clipboard.writeText(text);toast('Restock list copied');}catch{alert(text);}}

// ============================================================
// STOCK ADJUSTMENT
// ============================================================
let adjustingProductId=null;
function openStockAdjust(pid){if(!requireAdmin('adjust stock'))return;adjustingProductId=pid;const prod=getProducts().find(p=>p.id===pid);if(!prod)return;document.getElementById('stock-prod-name').value=prod.name;document.getElementById('stock-qty').value='';document.getElementById('stock-note').value='';document.getElementById('stock-type').value='Purchase';openModal('stock-modal');}
async function applyStockAdjustment(){
  if(!requireAdmin('adjust stock'))return;
  const loc=document.getElementById('stock-location').value;
  const type=document.getElementById('stock-type').value;
  const qty=parseInt(document.getElementById('stock-qty').value);
  const note=document.getElementById('stock-note').value.trim();
  if(isNaN(qty)||qty===0){toast('Enter a valid quantity','error');return;}
  const products=getProducts();
  const idx=products.findIndex(p=>p.id===adjustingProductId);
  if(idx<0)return;
  const prod=products[idx];
  const isAdd=['Purchase','Return'].includes(type);
  const absQty=Math.abs(qty);
  const change=isAdd?absQty:-absQty;

  // The actual read-check-write and stock_history insert now happen
  // together, atomically, server-side (adjust_product_stock) — this avoids
  // the old race where two concurrent adjustments could both read the same
  // stale stock value and the second write would silently clobber the
  // first. The values below are only used for the offline/not-configured
  // fallback path.
  if(window.LumodaSupabase&&window.LumodaSupabase.isConfigured()&&window.LumodaSupabase.adjustProductStock){
    try{
      const res=await window.LumodaSupabase.adjustProductStock({
        productId:prod.id, location:loc, delta:change, type, note:note||('Manual '+type)
      });
      if(!res?.success){toast(res?.error||'Could not save stock adjustment','error');return;}
      const cacheIdx=products.findIndex(p=>p.id===prod.id);
      if(cacheIdx>=0) products[cacheIdx]={...prod,stockAlabar:res.stock_alabar,stockMorocco:res.stock_morocco};
      LS.set('lumoda_products',normalizeProducts(products));
      loadProductSuggestions(getProducts());
    }catch(err){
      toast(err.message||'Could not save stock adjustment','error');
      return;
    }
  }else{
    let newStockAlabar=prod.stockAlabar, newStockMorocco=prod.stockMorocco;
    if(loc==='Alabar'){
      if(!isAdd&&prod.stockAlabar<absQty){toast('Insufficient stock','error');return;}
      newStockAlabar=Math.max(0,prod.stockAlabar+change);
    }else{
      if(!isAdd&&prod.stockMorocco<absQty){toast('Insufficient stock','error');return;}
      newStockMorocco=Math.max(0,prod.stockMorocco+change);
    }
    products[idx]={...prod,stockAlabar:newStockAlabar,stockMorocco:newStockMorocco};
    LS.set('lumoda_products',products);
    // No server round-trip in this path, so log locally as before.
    addStockHistory(prod.id,prod.name,loc,change,type,note||'Manual '+type);
  }

  addAudit('Stock Adjusted',currentUser.fullName+' adjusted "'+prod.name+'" '+(change>0?'+':'')+change+' at '+loc+' ('+type+')');
  closeModal('stock-modal');
  toast('Stock updated');
  renderProducts();
  renderDashboard();
}
function addStockHistory(productId, productName, location, change, type, note) {
  // Write to localStorage immediately
  const h = getStockHistory();
  h.unshift({
    id: 'sh_'+Date.now(),
    productId, productName, location, change, type, note,
    by: currentUser.username,
    byName: currentUser.fullName,
    createdAt: Date.now()
  });
  LS.set('lumoda_stockhistory', h);

  // FIX BUG 3: Write to Supabase stock_history table
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured() && currentUser) {
    void window.LumodaSupabase.logStockHistory({
      productId, productName, location, change, type, note: note || ''
    }).catch(err => { console.warn('Server stock history write failed:', err); });
  }
}
async function renderStockHistory() {
  // FIX BUG 3: Load from Supabase first, fall back to localStorage
  if (window.LumodaSupabase && window.LumodaSupabase.isConfigured()) {
    try {
      const serverHistory = await window.LumodaSupabase.loadStockHistory();
      if (Array.isArray(serverHistory) && serverHistory.length > 0) {
        LS.set('lumoda_stockhistory', serverHistory);
      }
    } catch (e) {
      console.warn('Could not load stock history from server:', e);
    }
  }

  let h = filterByLoc(getStockHistory());
  h.sort((a, b) => asTimestamp(b.createdAt) - asTimestamp(a.createdAt));
  document.getElementById('stockhistory-body').innerHTML = h.length === 0
    ? '<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:40px">No stock history yet</td></tr>'
    : h.map(x =>
        '<tr>' +
        '<td class="mono">' + fmtDateTime(x.createdAt) + '</td>' +
        '<td><span class="badge badge-neutral">' + escapeHtml(x.type) + '</span></td>' +
        '<td>' + escapeHtml(x.productName) + '</td>' +
        '<td>' + escapeHtml(x.location) + '</td>' +
        '<td class="mono" style="color:' + (x.change > 0 ? '#16a34a' : '#dc2626') + '">' + (x.change > 0 ? '+' : '') + x.change + '</td>' +
        '<td>' + escapeHtml(x.note || '—') + '</td>' +
        '<td>' + escapeHtml(x.byName || x.by) + '</td>' +
        '</tr>'
      ).join('');
}
function filterStockHistory(val){const q=val.toLowerCase();document.querySelectorAll('#stockhistory-body tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none');}

// ============================================================
// CSV IMPORT
// ============================================================
let csvRows=[];
function openCsvModal(){if(!requireAdmin('import CSV'))return;csvRows=[];document.getElementById('csv-file-input').value='';document.getElementById('csv-preview').style.display='none';document.getElementById('csv-import-btn').style.display='none';showCsvError('');openModal('csv-modal');}
function showCsvError(msg){const e=document.getElementById('csv-error');if(!e)return;e.textContent=msg;e.style.display=msg?'block':'none';}
function parseCsvLine(line){const out=[];let cur='',inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}else if(ch===','&&!inQ){out.push(cur.trim());cur='';}else cur+=ch;}out.push(cur.trim());return out;}
function parseCsvFile(input){const file=input.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const text=String(reader.result||'');const lines=text.split(/\r?\n/).filter(l=>l.trim());if(lines.length<2)throw new Error('CSV must include headers and at least one product row.');const headers=parseCsvLine(lines[0]).map(h=>h.toLowerCase().replace(/\s+/g,''));const idx={name:headers.indexOf('name'),price:headers.indexOf('price'),sku:headers.indexOf('sku'),category:headers.indexOf('category'),alabar:headers.indexOf('alabarstock'),morocco:headers.indexOf('moroccostock'),reorder:headers.indexOf('reorderlevel')};if(idx.name<0||idx.price<0)throw new Error('Missing required columns: Name and Price.');const skipped=[];csvRows=lines.slice(1).map((line,i)=>{const c=parseCsvLine(line);return{name:c[idx.name]||'',price:parseFloat(c[idx.price]),sku:idx.sku>=0?c[idx.sku]:'',category:idx.category>=0?c[idx.category]:'General',stockAlabar:idx.alabar>=0?parseInt(c[idx.alabar]||'0'):0,stockMorocco:idx.morocco>=0?parseInt(c[idx.morocco]||'0'):0,reorder:idx.reorder>=0?parseInt(c[idx.reorder]||String(getDefaultReorderLevel())):getDefaultReorderLevel(),row:i+2};}).filter(r=>{if(!r.name)return false;if(isNaN(r.price)||r.price<0){skipped.push('row '+r.row+' ('+r.name+')');return false;}return true;});renderCsvPreview();showCsvError(skipped.length?('Skipped '+skipped.length+' row(s) with a missing/invalid price: '+skipped.join(', ')):'');}catch(err){showCsvError(err.message);}};reader.readAsText(file);}
function renderCsvPreview(){document.getElementById('csv-preview').style.display='block';document.getElementById('csv-import-btn').style.display=csvRows.length?'inline-flex':'none';document.getElementById('csv-preview-title').textContent=csvRows.length+' product(s) ready to import';document.getElementById('csv-preview-body').innerHTML=csvRows.map((r,i)=>'<tr><td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.sku||'—')+'</td><td>'+escapeHtml(r.category||'General')+'</td><td class="mono">'+fmtGHS(r.price||0)+'</td><td class="mono">'+(r.stockAlabar||0)+'</td><td class="mono">'+(r.stockMorocco||0)+'</td><td class="mono">'+(r.reorder||getDefaultReorderLevel())+'</td><td><button class="btn btn-danger btn-sm" onclick="removeCsvRow('+i+')">Remove</button></td></tr>').join('');}
function removeCsvRow(i){csvRows.splice(i,1);renderCsvPreview();}
async function importCsvProducts(){if(!requireAdmin('import products'))return;if(!csvRows.length)return;if(window.LumodaSupabase&&window.LumodaSupabase.isConfigured()){try{const res=await window.LumodaSupabase.importProducts(csvRows.map(r=>({name:r.name,sku:r.sku,category:r.category||'General',price:r.price||0,stock_alabar:r.stockAlabar||0,stock_morocco:r.stockMorocco||0,reorder_level:r.reorder||getDefaultReorderLevel()})));if(res.error)throw res.error;await syncSupabaseCache();addAudit('CSV Imported',currentUser.fullName+' imported '+csvRows.length+' products [server]');closeModal('csv-modal');toast(csvRows.length+' products imported');renderProducts();return;}catch(err){showCsvError(err.message||'Could not import products to Supabase.');return;}}showCsvError('Supabase is not configured. CSV imports are disabled.');}
function downloadCsvTemplate(){const csv='Name,Price,SKU,Category,AlabarStock,MoroccoStock,ReorderLevel\nExample Product,100,EX-001,General,10,5,3';const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lumoda-products-template.csv';a.click();URL.revokeObjectURL(a.href);}
function exportCSV(){const h=getStockHistory();const csv='Date,Type,Product,Location,Change,Note,By\n'+h.map(x=>[fmtDateTime(x.createdAt),x.type,x.productName,x.location,x.change,x.note,x.byName||x.by].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lumoda-stock-history.csv';a.click();URL.revokeObjectURL(a.href);}

// ============================================================
// LINK PRODUCTS TO WAREHOUSE CATALOG (one-time reconciliation)
// Products and warehouse items are two separate catalogs that historically
// never shared a code. Going forward a DB trigger keeps them in sync
// automatically (saving a product creates/updates a matching warehouse
// item). This screen handles the existing mismatch: it proposes pairs by
// an exact name match and lets an admin confirm or skip each one — never
// links anything without a human looking at it, since two different real
// products can easily share a similar name.
// ============================================================
let catalogLinkCandidates = [];
let catalogLinkRemainingCount = 0;

async function openCatalogLinkModal(){
  if(!requireAdmin('link the warehouse catalog'))return;
  if(typeof syncWarehouseCacheFromServer === 'function') await syncWarehouseCacheFromServer();
  buildCatalogLinkCandidates();
  renderCatalogLinkRows();
  openModal('catalog-link-modal');
}

function buildCatalogLinkCandidates(){
  const products = getProducts().filter(p=>p.sku);
  const whItems = (typeof getWarehouseProductsLocal === 'function' ? getWarehouseProductsLocal() : []);
  const bySku = new Set(whItems.map(w=>String(w.code||'').toLowerCase()).filter(Boolean));

  // A product may already have its own auto-created warehouse row (the
  // sync trigger fires on every save) — that alone doesn't mean there's
  // nothing to reconcile. A separate, older warehouse item can still exist
  // under a different code with the same name, holding real stock that
  // hasn't been merged in yet. So candidates are: any warehouse item whose
  // name matches a product but whose code does NOT match that product's own
  // sku — regardless of whether the product already has its own row.
  const usedWhIds = new Set();
  catalogLinkCandidates = [];
  let remaining = 0;
  products.forEach(p=>{
    const ownSku = String(p.sku).toLowerCase();
    const nameKey = String(p.name||'').trim().toLowerCase();
    const orphan = whItems.find(w=>
      !usedWhIds.has(w.id) &&
      String(w.code||'').toLowerCase() !== ownSku &&
      String(w.name||'').trim().toLowerCase() === nameKey
    );
    if(orphan){
      usedWhIds.add(orphan.id);
      catalogLinkCandidates.push({ product:p, whItem:orphan });
    } else if(!bySku.has(ownSku)){
      remaining++;
    }
  });
  catalogLinkRemainingCount = remaining;
}

function renderCatalogLinkRows(){
  const body = document.getElementById('catalog-link-rows');
  const remainingEl = document.getElementById('catalog-link-remaining');
  if(body){
    body.innerHTML = catalogLinkCandidates.length ? catalogLinkCandidates.map((c,i)=>
      '<tr>'+
        '<td>'+escapeHtml(c.product.name)+' <span class="mono" style="color:var(--gray-400);font-size:11px">('+escapeHtml(c.product.sku)+')</span></td>'+
        '<td>'+escapeHtml(c.whItem.name)+' <span class="mono" style="color:var(--gray-400);font-size:11px">('+escapeHtml(c.whItem.code)+')</span></td>'+
        '<td style="white-space:nowrap">'+
          '<button class="btn btn-primary btn-sm" onclick="confirmCatalogLink('+i+')">Confirm</button> '+
          '<button class="btn btn-secondary btn-sm" onclick="skipCatalogLink('+i+')">Skip</button>'+
        '</td>'+
      '</tr>'
    ).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--gray-400);padding:20px">No proposed matches right now</td></tr>';
  }
  if(remainingEl){
    remainingEl.textContent = catalogLinkRemainingCount > 0
      ? catalogLinkRemainingCount+' product(s) have no proposed match.'
      : 'Every product either has a warehouse match or already has a warehouse entry.';
    if(catalogLinkRemainingCount > 0){
      remainingEl.innerHTML += ' <button class="btn btn-primary btn-sm" onclick="backfillRemainingWarehouseEntries()">Create warehouse entries for the remaining '+catalogLinkRemainingCount+'</button>';
    }
  }
}

function skipCatalogLink(index){
  catalogLinkCandidates.splice(index,1);
  renderCatalogLinkRows();
}

async function confirmCatalogLink(index){
  const c = catalogLinkCandidates[index];
  if(!c)return;
  try{
    const res = await window.LumodaSupabase.linkCatalogItem(c.product.id, c.whItem.id);
    if(!res?.success){toast(res?.error||'Could not link item','error');return;}
    if(typeof addAudit==='function') addAudit('Catalog Linked', currentUser.fullName+' linked "'+c.product.name+'" to the warehouse catalog');
    toast('Linked "'+c.product.name+'"');
    catalogLinkCandidates.splice(index,1);
    if(typeof syncWarehouseCacheFromServer === 'function') await syncWarehouseCacheFromServer();
    renderCatalogLinkRows();
  }catch(err){
    console.error('Link catalog item failed:', err);
    toast(err.message||'Could not link item','error');
  }
}

async function backfillRemainingWarehouseEntries(){
  try{
    const res = await window.LumodaSupabase.backfillWarehouseCatalog();
    if(!res?.success){toast(res?.error||'Could not create warehouse entries','error');return;}
    if(typeof addAudit==='function') addAudit('Catalog Backfilled', currentUser.fullName+' created '+res.created+' warehouse entr'+(res.created===1?'y':'ies')+' from products');
    toast(res.created+' warehouse entr'+(res.created===1?'y':'ies')+' created');
    if(typeof syncWarehouseCacheFromServer === 'function') await syncWarehouseCacheFromServer();
    buildCatalogLinkCandidates();
    renderCatalogLinkRows();
  }catch(err){
    console.error('Backfill warehouse catalog failed:', err);
    toast(err.message||'Could not create warehouse entries','error');
  }
}

