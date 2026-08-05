// ============================================================
// SETTINGS
// ============================================================
const SETTINGS_STAFF_PAGES = ['dashboard', 'cashsales', 'invoices', 'customers', 'products', 'stockhistory'];
const SETTINGS_ADMIN_PAGES = [...SETTINGS_STAFF_PAGES, 'reports', 'warehouse'];
const SETTINGS_PAGE_LABELS = { dashboard:'Dashboard', cashsales:'Cash Sales', invoices:'Invoices', customers:'Customers', products:'Products', stockhistory:'Stock History', reports:'Reports', warehouse:'Warehouse' };

async function renderSettings() {
  const isWarehouseManager = currentUser && currentUser.role === 'warehouse_manager';
  const landingGroup = document.getElementById('set-landing-page-group');
  if (isWarehouseManager) {
    // Warehouse managers only ever have one page to land on — nothing to choose.
    if (landingGroup) landingGroup.style.display = 'none';
  } else if (landingGroup) {
    landingGroup.style.display = '';
    const pages = isAdmin() ? SETTINGS_ADMIN_PAGES : SETTINGS_STAFF_PAGES;
    const select = document.getElementById('set-landing-page');
    select.innerHTML = pages.map(p => `<option value="${p}">${SETTINGS_PAGE_LABELS[p]}</option>`).join('');
    select.value = (currentUser.defaultLandingPage && pages.includes(currentUser.defaultLandingPage))
      ? currentUser.defaultLandingPage
      : 'dashboard';
  }

  const bizCard = document.getElementById('business-settings-card');
  const backupCard = document.getElementById('backup-settings-card');
  if (!isAdmin()) {
    if (bizCard) bizCard.style.display = 'none';
    if (backupCard) backupCard.style.display = 'none';
    return;
  }
  if (bizCard) bizCard.style.display = '';
  if (backupCard) backupCard.style.display = '';

  try {
    const settings = await window.LumodaSupabase.loadBusinessSettings();
    document.getElementById('set-business-name').value = settings.business_name || '';
    document.getElementById('set-phone').value          = settings.phone || '';
    document.getElementById('set-address').value        = settings.address || '';
    document.getElementById('set-currency').value       = settings.currency_symbol || '';
    document.getElementById('set-reorder').value        = settings.default_reorder_level ?? '';
    document.getElementById('set-brand-color').value    = settings.brand_color || '#5C2D0A';
    document.getElementById('set-brand-color-hex').textContent = settings.brand_color || '#5C2D0A';
    updateLogoPreviewUI(settings.logo_url);
    // Belt-and-suspenders: normally applied at login, but repaint here too
    // in case this is the freshest data the page has seen yet.
    applyBrandColor(settings.brand_color);
    applyLogo(settings.logo_url);
    applyBusinessName(settings.business_name);
    LS.set('lumoda_business_settings', settings);
  } catch (error) {
    console.error('Could not load business settings:', error);
    toast('Could not load business settings', 'error');
  }
}

// Repaints the app live as soon as a new colour is picked, before Save is
// even clicked — makes it obvious what you're about to commit to.
function previewBrandColor() {
  const hex = document.getElementById('set-brand-color').value;
  document.getElementById('set-brand-color-hex').textContent = hex;
  applyBrandColor(hex);
}

// Keeps the small preview swatch in Business Settings in sync with
// whether a logo is actually set, separate from the sidebar/login mark.
function updateLogoPreviewUI(url) {
  const img = document.getElementById('set-logo-preview');
  const empty = document.getElementById('set-logo-preview-empty');
  const removeBtn = document.getElementById('set-logo-remove-btn');
  if (url) {
    img.src = url; img.style.display = ''; empty.style.display = 'none';
    if (removeBtn) removeBtn.style.display = '';
  } else {
    img.style.display = 'none'; empty.style.display = '';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

async function uploadLogoFile() {
  if (!requireAdmin('change the logo')) return;
  const input = document.getElementById('set-logo-file');
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > LOGO_MAX_BYTES) { toast('Logo must be under 2MB', 'error'); input.value = ''; return; }
  try {
    const url = await window.LumodaSupabase.uploadLogo(file);
    const saved = await window.LumodaSupabase.saveLogoUrl(url);
    if (saved) LS.set('lumoda_business_settings', saved);
    updateLogoPreviewUI(url);
    applyLogo(url);
    addAudit('Logo Updated', `${currentUser.fullName} updated the business logo`);
    toast('Logo updated');
  } catch (error) {
    console.error('Logo upload failed:', error);
    toast(error.message || 'Could not upload logo', 'error');
  } finally {
    input.value = '';
  }
}

async function removeLogo() {
  if (!requireAdmin('change the logo')) return;
  if (!confirm('Remove the current logo? The default Lumoda mark will show instead.')) return;
  try {
    const saved = await window.LumodaSupabase.saveLogoUrl(null);
    if (saved) LS.set('lumoda_business_settings', saved);
    updateLogoPreviewUI(null);
    applyLogo(null);
    addAudit('Logo Removed', `${currentUser.fullName} removed the business logo`);
    toast('Logo removed');
  } catch (error) {
    console.error('Could not remove logo:', error);
    toast(error.message || 'Could not remove logo', 'error');
  }
}

async function saveMyLandingPagePref() {
  const select = document.getElementById('set-landing-page');
  if (!select) return;
  try {
    await window.LumodaSupabase.saveMyDefaultLandingPage(select.value, currentUser.id);
    currentUser.defaultLandingPage = select.value;
    toast('Preference saved');
  } catch (error) {
    console.error('Could not save preference:', error);
    toast(error.message || 'Could not save preference', 'error');
  }
}

async function saveBusinessSettingsForm() {
  if (!requireAdmin('edit business settings')) return;
  const errEl = document.getElementById('set-business-error');
  errEl.style.display = 'none';
  const businessName = document.getElementById('set-business-name').value.trim();
  if (!businessName) { errEl.textContent = 'Business name is required.'; errEl.style.display = 'block'; return; }
  try {
    const saved = await window.LumodaSupabase.saveBusinessSettings({
      businessName,
      phone:                document.getElementById('set-phone').value.trim(),
      address:              document.getElementById('set-address').value.trim(),
      currencySymbol:       document.getElementById('set-currency').value.trim() || 'GH₵',
      defaultReorderLevel:  document.getElementById('set-reorder').value,
      brandColor:           document.getElementById('set-brand-color').value
    });
    // Update the local cache immediately — without this, fmtGHS()/reorder
    // defaults/brand colour would keep showing the old values until the
    // next full login sync, even though the save itself succeeded.
    if (saved) { LS.set('lumoda_business_settings', saved); applyBrandColor(saved.brand_color); applyBusinessName(saved.business_name); }
    addAudit('Business Settings Updated', `${currentUser.fullName} updated business settings`);
    toast('Business settings saved');
  } catch (error) {
    console.error('Could not save business settings:', error);
    errEl.textContent = error.message || 'Could not save business settings';
    errEl.style.display = 'block';
  }
}

function downloadCsv(filename, headers, rows) {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const csv = [headers, ...rows].map(row => row.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function formatInvoiceItemsForExport(items) {
  return (items || []).map(it => `${it.qty}x ${it.name} @${Number(it.price || 0).toFixed(2)}`).join('; ');
}

async function exportAllData() {
  if (!requireAdmin('export business data')) return;
  const btn = document.getElementById('backup-export-btn');
  const sb = window.LumodaSupabase;
  if (!sb || !sb.isConfigured || !sb.isConfigured()) { toast('Supabase is not configured', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }
  try {
    // Pulled fresh from the server rather than local caches, so the backup
    // reflects everything, not just whatever pages happen to be cached.
    const [
      products, customers, invoices, stockHistory,
      warehousesRaw, warehouseBalancesRaw, warehouseMovementsRaw
    ] = await Promise.all([
      sb.loadProducts(),
      sb.loadCustomers().catch(() => []),
      sb.loadInvoices().catch(() => []),
      sb.loadStockHistory().catch(() => []),
      sb.loadWarehouses().catch(() => []),
      sb.loadWarehouseStockBalance().catch(() => []),
      sb.loadWarehouseMovements().catch(() => [])
    ]);

    const dateStr = new Date().toISOString().slice(0, 10);
    const warehouses = warehousesRaw.map(normalizeWarehouse);
    const warehouseName = new Map(warehouses.map(w => [w.id, w.name]));

    const files = [
      [`lumoda-products-${dateStr}.csv`,
        ['Name', 'SKU', 'Category', 'Retail Price', 'Wholesale Price', 'Carton Price', 'Alabar Stock', 'Morocco Stock', 'Reorder Level'],
        products.map(p => [p.name, p.sku, p.category, p.retailPrice, p.wholesalePrice, p.cartonPrice, p.stockAlabar, p.stockMorocco, p.reorder])],

      [`lumoda-customers-${dateStr}.csv`,
        ['Name', 'Phone', 'Address', 'Branch', 'Created'],
        customers.map(c => [c.name, c.phone, c.address, c.location, fmtDate(c.createdAt)])],

      [`lumoda-invoices-${dateStr}.csv`,
        ['Number', 'Date', 'Customer', 'Phone', 'Branch', 'Items', 'Subtotal', 'Discount', 'Total', 'Amount Paid', 'Balance', 'Status', 'Pay Method', 'Cash Sale', 'Created By'],
        invoices.map(i => [i.number, fmtDate(i.createdAt), i.customerName, i.customerPhone, i.location, formatInvoiceItemsForExport(i.items), i.subtotal, i.discount, i.total, i.amountPaid, i.balance, i.status, i.payMethod, i.isCashSale ? 'Yes' : 'No', i.createdByName])],

      [`lumoda-stock-history-${dateStr}.csv`,
        ['Date', 'Type', 'Product', 'Location', 'Change', 'Note', 'By'],
        stockHistory.map(x => [fmtDateTime(x.createdAt), x.type, x.productName, x.location, x.change, x.note, x.byName || x.by])],

      [`lumoda-warehouses-${dateStr}.csv`,
        ['Code', 'Name', 'Address', 'Status'],
        warehouses.map(w => [w.code, w.name, w.address, w.active ? 'Active' : 'Inactive'])],

      [`lumoda-warehouse-stock-${dateStr}.csv`,
        ['Warehouse', 'Item Code', 'Item Name', 'Total', 'Reserved', 'Available', 'Reorder Level', 'Updated'],
        warehouseBalancesRaw.map(normalizeWarehouseBalance).map(b =>
          [warehouseName.get(b.warehouseId) || b.warehouseId, b.itemCode, b.itemName, b.totalCartons, b.reservedCartons, b.availableCartons, b.reorderLevel, b.updatedAt ? fmtDateTime(b.updatedAt) : ''])],

      [`lumoda-warehouse-movements-${dateStr}.csv`,
        ['Warehouse', 'Type', 'Description', 'Cartons', 'Status', 'Created By', 'Date'],
        warehouseMovementsRaw.map(normalizeWarehouseMovement).map(m =>
          [warehouseName.get(m.warehouseId) || m.warehouseId, formatWarehouseType(m.type), m.description, m.cartons, m.status, m.createdByName, fmtDateTime(m.createdAt)])]
    ];

    // Staggered rather than all at once — firing many downloads in the same
    // instant is what makes browsers block them as a "multi-download" popup.
    for (const [filename, headers, rows] of files) {
      downloadCsv(filename, headers, rows);
      await new Promise(r => setTimeout(r, 250));
    }

    addAudit('Data Exported', `${currentUser.fullName} exported a full data backup (${files.length} CSV files)`);
    toast(`${files.length} files downloaded`);
  } catch (error) {
    console.error('Export failed:', error);
    toast(error.message || 'Could not export data', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Export All Data (CSV)'; }
  }
}
