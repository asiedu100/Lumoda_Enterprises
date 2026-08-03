// ============================================================
// LUMODA ENTERPRISE - warehouse.js v2.1
// Changes:
//  1. Low Stock — show 15 items, "Load More" pagination
//  2. Stock Balance — show 20 items, search filter, "Load More"
//  3. Stock In — multi-item rows (like Stock Out)
// ============================================================

// ============================================================
// PAGINATION STATE
// ============================================================
let lowStockPage      = 15;   // how many low stock items currently showing
let balancePage       = 20;   // how many balance rows currently showing
let balanceSearch     = '';   // search filter for stock balance table

const LOW_STOCK_PAGE_SIZE  = 15;
const BALANCE_PAGE_SIZE    = 20;

// ============================================================
// WAREHOUSE (location) SELECTION
// currentWarehouseId is which warehouse Stock In/Out/Adjustment write to,
// and (unless 'all') which one the balance/movement views are scoped to.
// 'all' is only meaningful for admins — RLS already limits a
// warehouse_manager's synced data to warehouses they're assigned to.
// ============================================================
let currentWarehouseId = null;

// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================
function getWarehouseMovementsLocal() {
  return JSON.parse(localStorage.getItem('lumoda_warehouse_movements') || '[]');
}
function saveWarehouseMovementsLocal(records) {
  localStorage.setItem('lumoda_warehouse_movements', JSON.stringify(records || []));
}
function getWarehouseProductsLocal() {
  return JSON.parse(localStorage.getItem('lumoda_warehouse_products') || '[]');
}
function saveWarehouseProductsLocal(products) {
  localStorage.setItem('lumoda_warehouse_products', JSON.stringify(products || []));
}
function getWarehouseSuppliersLocal() {
  return JSON.parse(localStorage.getItem('lumoda_warehouse_suppliers') || '[]');
}
function saveWarehouseSuppliersLocal(suppliers) {
  localStorage.setItem('lumoda_warehouse_suppliers', JSON.stringify(suppliers || []));
}
function getWarehouseBalancesLocal() {
  return JSON.parse(localStorage.getItem('lumoda_warehouse_stock_balance') || '[]');
}
function saveWarehouseBalancesLocal(balances) {
  localStorage.setItem('lumoda_warehouse_stock_balance', JSON.stringify(balances || []));
}
function getWarehousesLocal() {
  return JSON.parse(localStorage.getItem('lumoda_warehouses') || '[]');
}
function saveWarehousesLocal(warehouses) {
  localStorage.setItem('lumoda_warehouses', JSON.stringify(warehouses || []));
}

// Balances/movements scoped to the selected warehouse (or all of them, for
// an admin who has 'all' selected). Every read in this file should go
// through these two instead of the raw *Local() getters above.
function getScopedWarehouseBalances() {
  const all = getWarehouseBalancesLocal();
  if (!currentWarehouseId || currentWarehouseId === 'all') return all;
  // The item catalog is shared across every warehouse, so a warehouse should
  // always list every catalog item (at 0 cartons if nothing's been recorded
  // there yet) rather than only the items that already have a balance row —
  // otherwise a brand-new warehouse looks empty of items instead of just
  // empty of stock.
  const realForWarehouse = all.filter(b => b.warehouseId === currentWarehouseId);
  const realByCode = new Map(realForWarehouse.map(b => [b.itemCode, b]));
  const catalog = getWarehouseProductsLocal();
  const catalogByCode = new Map(catalog.map(p => [p.code, p]));

  // Union of the catalog and any real balance rows — a real balance row
  // always wins even if its item somehow isn't (yet) in the catalog table,
  // so genuine stock is never hidden just because of a catalog mismatch.
  const codes = new Set([...catalogByCode.keys(), ...realByCode.keys()]);
  return [...codes].map(code => realByCode.get(code) || {
    id: null,
    warehouseId: currentWarehouseId,
    itemCode: code,
    itemName: catalogByCode.get(code)?.name || code,
    totalCartons: 0,
    reservedCartons: 0,
    availableCartons: 0,
    reorderLevel: catalogByCode.get(code)?.reorder || 10,
    unitPrice: 0,
    updatedAt: null
  });
}
function getScopedWarehouseMovements() {
  const all = getWarehouseMovementsLocal();
  if (!currentWarehouseId || currentWarehouseId === 'all') return all;
  return all.filter(m => m.warehouseId === currentWarehouseId);
}

function isWarehouseSyncEnabled() {
  return Boolean(
    window.LumodaSupabase &&
    window.LumodaSupabase.isConfigured &&
    window.LumodaSupabase.isConfigured()
  );
}

function whCurrentUserName() {
  return currentUser?.fullName || currentUser?.full_name || currentUser?.username || 'Unknown';
}

function whSafeCode(code, description) {
  const rawCode = String(code || '').trim();
  if (rawCode) return rawCode.toUpperCase();
  return String(description || 'ITEM')
    .trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || ('ITEM-' + Date.now());
}

function whDate(value) {
  if (typeof fmtDateTime === 'function') return fmtDateTime(value);
  return value ? new Date(value).toLocaleString() : '—';
}

function warehouseStatusBadge(status) {
  const s = status || 'executed';
  if (s === 'pending')  return '<span class="badge badge-warning">Pending</span>';
  if (s === 'executed') return '<span class="badge badge-success">Executed</span>';
  if (s === 'rejected') return '<span class="badge badge-danger">Rejected</span>';
  return `<span class="badge badge-neutral">${escapeHtml(s)}</span>`;
}

function formatWarehouseType(type) {
  const labels = {
    opening_balance: 'Opening Balance',
    stock_in:        'Stock In',
    stock_out:       'Stock Out',
    adjustment:      'Adjustment'
  };
  return labels[type] || type || '—';
}

function warehouseTypeBadgeClass(type) {
  const classes = {
    stock_in:        'badge-success',
    stock_out:       'badge-warning',
    adjustment:      'badge-info',
    opening_balance: 'badge-neutral'
  };
  return classes[type] || 'badge-neutral';
}

// ============================================================
// NORMALIZERS
// ============================================================
function normalizeWarehouse(row) {
  return {
    id:       row.id,
    code:     row.code || '',
    name:     row.name || '',
    address:  row.address || '',
    active:   row.active !== false
  };
}

function normalizeWarehouseMovement(row) {
  return {
    id:              row.id,
    warehouseId:     row.warehouse_id || row.warehouseId || null,
    type:            row.type,
    requisitionNo:   row.requisition_no   || row.requisitionNo   || '',
    issueTo:         row.issue_to         || row.issueTo         || '',
    storekeeper:     row.storekeeper      || '',
    supplier:        row.supplier         || '',
    description:     row.description      || '',
    cartons:         Number(row.cartons   || 0),
    notes:           row.notes            || '',
    items:           Array.isArray(row.items) ? row.items : [],
    status:          row.status           || 'executed',
    createdByName:   row.created_by_name  || row.createdByName   || 'Unknown',
    createdAt:       row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now()),
    approvedAt:      row.approved_at ? new Date(row.approved_at).getTime() : (row.approvedAt || null),
    rejectionReason: row.rejection_reason || row.rejectionReason || ''
  };
}

function normalizeWarehouseProduct(row) {
  return {
    id:            row.id,
    // The live warehouse_products table's column is `sku`, not `code` — this
    // previously always fell through to '' for any Supabase-synced product.
    code:          row.sku || row.code || '',
    name:          row.name || '',
    category:      row.category || 'General',
    reorder:       Number(row.reorder_level || row.reorder || 0),
    createdByName: row.created_by_name || row.createdByName || 'Unknown',
    createdAt:     row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now())
  };
}

function normalizeWarehouseSupplier(row) {
  return {
    id:            row.id,
    name:          row.name     || '',
    phone:         row.phone    || '',
    location:      row.location || '',
    notes:         row.notes    || '',
    createdByName: row.created_by_name || row.createdByName || 'Unknown',
    createdAt:     row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now())
  };
}

function normalizeWarehouseBalance(row) {
  return {
    id:               row.id,
    warehouseId:      row.warehouse_id     || row.warehouseId     || null,
    itemCode:         row.item_code        || row.itemCode        || '',
    itemName:         row.item_name        || row.itemName        || row.description || '',
    totalCartons:     Number(row.total_cartons     || row.totalCartons     || 0),
    reservedCartons:  Number(row.reserved_cartons  || row.reservedCartons  || 0),
    availableCartons: Number(row.available_cartons || row.availableCartons || 0),
    reorderLevel:     Number(row.reorder_level     || row.reorderLevel     || 10),
    unitPrice:        Number(row.unit_price        || row.unitPrice        || row.price || 0),
    updatedAt:        row.updated_at ? new Date(row.updated_at).getTime() : (row.updatedAt || Date.now())
  };
}

// ============================================================
// SYNC
// ============================================================
async function syncWarehouseCacheFromServer() {
  if (!isWarehouseSyncEnabled()) return;
  try {
    const [movements, products, suppliers, balances, warehouses] = await Promise.all([
      window.LumodaSupabase.loadWarehouseMovements?.().catch(() => []),
      window.LumodaSupabase.loadWarehouseProducts?.().catch(() => []),
      window.LumodaSupabase.loadWarehouseSuppliers?.().catch(() => []),
      window.LumodaSupabase.loadWarehouseStockBalance?.().catch(() => []),
      window.LumodaSupabase.loadWarehouses?.().catch(() => [])
    ]);
    if (Array.isArray(movements)) saveWarehouseMovementsLocal(movements.map(normalizeWarehouseMovement));
    if (Array.isArray(products))  saveWarehouseProductsLocal(products.map(normalizeWarehouseProduct));
    if (Array.isArray(suppliers)) saveWarehouseSuppliersLocal(suppliers.map(normalizeWarehouseSupplier));
    if (Array.isArray(balances))  saveWarehouseBalancesLocal(balances.map(normalizeWarehouseBalance));
    if (Array.isArray(warehouses)) saveWarehousesLocal(warehouses.map(normalizeWarehouse));
  } catch (error) {
    console.warn('Warehouse sync failed', error);
  }
  ensureCurrentWarehouseSelected();
}

// Picks a sensible default: keep the current selection if it's still valid;
// otherwise an admin defaults to 'all', anyone else defaults to their one
// (or first) assigned warehouse — RLS already means the synced list only
// contains warehouses they can access.
function ensureCurrentWarehouseSelected() {
  const list = getWarehousesLocal().filter(w => w.active);
  const stillValid = currentWarehouseId === 'all' || list.some(w => w.id === currentWarehouseId);
  if (stillValid) return;
  currentWarehouseId = isAdmin() ? 'all' : (list[0] ? list[0].id : 'all');
}

function switchWarehouse(id) {
  currentWarehouseId = id;
  resetWarehousePagination();
  renderWarehouse();
}

// ============================================================
// MOVEMENT FILTERS
// ============================================================
let warehouseMovementFilter = { search: '', type: 'all', status: 'all' };

function updateWarehouseMovementFilter(field, value) {
  warehouseMovementFilter[field] = value;
  renderWarehouse();
}

function getFilteredWarehouseMovements(movements) {
  return movements.filter(m => {
    const search = warehouseMovementFilter.search.toLowerCase().trim();
    const matchesSearch =
      !search ||
      String(m.description || '').toLowerCase().includes(search) ||
      String(m.requisitionNo || '').toLowerCase().includes(search) ||
      String(m.createdByName || '').toLowerCase().includes(search) ||
      JSON.stringify(m.items || []).toLowerCase().includes(search);
    const matchesType   = warehouseMovementFilter.type   === 'all' || m.type   === warehouseMovementFilter.type;
    const matchesStatus = warehouseMovementFilter.status === 'all' || m.status === warehouseMovementFilter.status;
    return matchesSearch && matchesType && matchesStatus;
  });
}

// ============================================================
// PAGINATION HELPERS
// ============================================================

// Reset pagination when warehouse re-renders from scratch
function resetWarehousePagination() {
  lowStockPage  = LOW_STOCK_PAGE_SIZE;
  balancePage   = BALANCE_PAGE_SIZE;
  balanceSearch = '';
}

// Called by "Load More" button in Low Stock section
function loadMoreLowStock() {
  lowStockPage += LOW_STOCK_PAGE_SIZE;
  _rerenderLowStock();
}

// Called by "Load More" button in Stock Balance section
function loadMoreBalance() {
  balancePage += BALANCE_PAGE_SIZE;
  _rerenderBalance();
}

// Called by search input in Stock Balance section
function filterBalanceSearch(val) {
  balanceSearch = val;
  balancePage   = BALANCE_PAGE_SIZE; // reset to first page on new search
  _rerenderBalance();
}

// Re-render only the low stock card (no full page re-render)
function _rerenderLowStock() {
  const balances      = getScopedWarehouseBalances();
  const lowStockItems = balances.filter(b =>
    Number(b.availableCartons || 0) <= Number(b.reorderLevel || 10)
  );
  const container = document.getElementById('wh-low-stock-container');
  if (container) container.innerHTML = _buildLowStockHTML(lowStockItems);
}

// Re-render only the balance table (no full page re-render)
function _rerenderBalance() {
  const balances  = getScopedWarehouseBalances();
  const container = document.getElementById('wh-balance-container');
  if (container) container.innerHTML = _buildBalanceHTML(balances);
}

// ============================================================
// LOW STOCK HTML BUILDER
// ============================================================
function _buildLowStockHTML(lowStockItems) {
  if (!lowStockItems.length) {
    return `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px">
      ✓ All warehouse items are well-stocked
    </div>`;
  }

  // Out-of-stock first, then lowest-available-first within the rest.
  const sorted = [...lowStockItems].sort((a, b) => Number(a.availableCartons || 0) - Number(b.availableCartons || 0));

  const showing = Math.min(lowStockPage, sorted.length);
  const visible = sorted.slice(0, showing);
  const remaining = sorted.length - showing;

  const rows = visible.map(b => {
    const available  = Number(b.availableCartons || 0);
    const reorder    = Number(b.reorderLevel || 10);
    const pct        = Math.min(100, Math.round(available / Math.max(reorder * 2, 1) * 100));
    const isCritical = available === 0;
    const barColor   = isCritical ? '#dc2626' : '#f59e0b';
    const bgColor    = isCritical ? '#fef2f2' : '#fefce8';
    const borderColor = isCritical ? '#fca5a5' : '#fde047';

    return `
      <div style="display:flex;align-items:center;gap:14px;padding:12px 14px;
                  background:${bgColor};border:1px solid ${borderColor};
                  border-radius:8px;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--black);
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${escapeHtml(b.itemName)}
          </div>
          <div style="font-size:11px;color:var(--gray-600);font-family:var(--font-mono);margin-top:2px">
            ${escapeHtml(b.itemCode)} &nbsp;·&nbsp; Available: <strong>${available}</strong> &nbsp;·&nbsp; Reorder at: ${reorder}
          </div>
          <div style="margin-top:6px;height:4px;background:var(--gray-100);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;transition:width .3s"></div>
          </div>
        </div>
        <div style="flex-shrink:0">
          ${isCritical
            ? '<span class="badge badge-danger">Out</span>'
            : '<span class="badge badge-warning">Low</span>'
          }
        </div>
      </div>
    `;
  }).join('');

  const footer = remaining > 0
    ? `<button onclick="loadMoreLowStock()"
         style="width:100%;margin-top:4px;padding:10px;border:1px dashed var(--gray-200);
                border-radius:8px;background:transparent;cursor:pointer;font-size:13px;
                color:var(--gray-600);font-family:var(--font-sans);transition:all .15s"
         onmouseover="this.style.background='var(--gray-50)'"
         onmouseout="this.style.background='transparent'">
         Load ${Math.min(remaining, LOW_STOCK_PAGE_SIZE)} more
         <span style="color:var(--gray-400);font-size:11px;font-family:var(--font-mono)">
           (${remaining} remaining)
         </span>
       </button>`
    : '';

  const counter = `
    <div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono);
                margin-bottom:10px;text-align:right">
      Showing ${showing} of ${sorted.length}
    </div>`;

  return counter + rows + footer;
}

// ============================================================
// STOCK BALANCE HTML BUILDER
// ============================================================
function _buildBalanceHTML(allBalances) {
  // Apply search filter
  const q = balanceSearch.toLowerCase().trim();
  const filtered = q
    ? allBalances.filter(b =>
        String(b.itemName || '').toLowerCase().includes(q) ||
        String(b.itemCode || '').toLowerCase().includes(q)
      )
    : allBalances;

  const showing  = Math.min(balancePage, filtered.length);
  const visible  = filtered.slice(0, showing);
  const remaining = filtered.length - showing;

  if (!filtered.length) {
    return `
      <div style="padding:40px;text-align:center;color:var(--gray-400);font-size:13px">
        ${q ? `No items matching "${escapeHtml(q)}"` : 'No warehouse stock yet. Add Opening Balance or Stock In.'}
      </div>`;
  }

  const admin = isAdmin();
  // Whether an item has real stock in ANY warehouse — the catalog is shared,
  // so deleting an item removes it everywhere, not just the warehouse
  // currently being viewed. Only items with zero stock everywhere are safe
  // to delete (mirrors the same rule used for deleting a warehouse itself).
  const globalBalances = getWarehouseBalancesLocal();
  const catalog = getWarehouseProductsLocal();

  const rows = visible.map(b => {
    const available = Number(b.availableCartons || 0);
    const reorder    = Number(b.reorderLevel || 10);
    const isLow      = available <= reorder;
    const isCritical = available === 0;
    // Same red/amber tokens as the Low Stock card, so a problem item reads
    // the same way whether you spot it there or scanning this full table.
    const rowBg     = isCritical ? 'background:#fef2f2' : isLow ? 'background:#fefce8' : '';
    const stripeClr = isCritical ? '#dc2626' : isLow ? '#f59e0b' : 'transparent';

    let actionsCell = '';
    if (admin) {
      const product = catalog.find(p => p.code === b.itemCode);
      const hasStockAnywhere = globalBalances.some(x => x.itemCode === b.itemCode && Number(x.totalCartons) > 0);
      actionsCell = (product && !hasStockAnywhere)
        ? `<button class="btn btn-secondary btn-sm" onclick="deleteWarehouseProductItem('${product.id}')" style="color:#991b1b">Delete</button>`
        : `<button class="btn btn-secondary btn-sm" disabled title="${!product ? 'Not in the item catalog yet' : 'Has stock in a warehouse — remove the stock first'}" style="opacity:.5;cursor:not-allowed">Delete</button>`;
    }

    return `
    <tr style="${rowBg}">
      <td class="mono" style="box-shadow:inset 3px 0 0 ${stripeClr}">${escapeHtml(b.itemCode)}</td>
      <td style="font-weight:500">${escapeHtml(b.itemName)}</td>
      <td class="mono" style="text-align:center">${b.totalCartons}</td>
      <td class="mono" style="text-align:center;color:var(--gray-400)">${b.reservedCartons}</td>
      <td class="mono" style="text-align:center;font-weight:700;color:${
        isLow ? '#dc2626' : 'var(--brand-brown)'
      }">${available}</td>
      <td class="mono" style="text-align:center;color:var(--gray-400)">${reorder}</td>
      <td>
        ${isLow
          ? '<span class="badge badge-danger">Reorder</span>'
          : '<span class="badge badge-success">OK</span>'
        }
      </td>
      <td class="mono" style="font-size:11px;color:var(--gray-400)">${b.updatedAt ? whDate(b.updatedAt) : '—'}</td>
      ${admin ? `<td>${actionsCell}</td>` : ''}
    </tr>
  `;
  }).join('');

  const colCount = admin ? 9 : 8;
  const loadMoreRow = remaining > 0
    ? `<tr>
         <td colspan="${colCount}" style="padding:0;border:none">
           <button onclick="loadMoreBalance()"
             style="width:100%;padding:12px;border:none;border-top:1px dashed var(--gray-100);
                    background:transparent;cursor:pointer;font-size:13px;color:var(--gray-600);
                    font-family:var(--font-sans);transition:background .15s"
             onmouseover="this.style.background='var(--gray-50)'"
             onmouseout="this.style.background='transparent'">
             Load ${Math.min(remaining, BALANCE_PAGE_SIZE)} more
             <span style="color:var(--gray-400);font-size:11px;font-family:var(--font-mono)">
               (${remaining} of ${filtered.length} shown)
             </span>
           </button>
         </td>
       </tr>`
    : `<tr>
         <td colspan="${colCount}" style="padding:8px 13px;font-size:11px;color:var(--gray-400);
                                  font-family:var(--font-mono);text-align:right;border:none">
           All ${filtered.length} item${filtered.length !== 1 ? 's' : ''} shown
         </td>
       </tr>`;

  return `
    <table>
      <thead>
        <tr>
          <th>Item Code</th>
          <th>Item Name</th>
          <th style="text-align:center">Total</th>
          <th style="text-align:center">Reserved</th>
          <th style="text-align:center">Available</th>
          <th style="text-align:center">Reorder At</th>
          <th>Status</th>
          <th>Updated</th>
          ${admin ? '<th></th>' : ''}
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${loadMoreRow}
      </tbody>
    </table>`;
}

async function deleteWarehouseProductItem(productId) {
  if (!requireAdmin('delete warehouse items')) return;
  const product = getWarehouseProductsLocal().find(p => p.id === productId);
  if (!product) return;
  if (!confirm(`Delete item "${product.name}"? This removes it from the catalog for every warehouse and cannot be undone.`)) return;
  try {
    await window.LumodaSupabase.deleteWarehouseProduct(productId);
    if (typeof addAudit === 'function') addAudit('Warehouse Item Deleted', `${whCurrentUserName()} deleted item ${product.name} (${product.code})`);
    toast('Item deleted');
    await renderWarehouse();
  } catch (error) {
    console.error('Delete warehouse item failed:', error);
    const msg = error?.code === '23503'
      ? 'Can\'t delete — this item still has movement or requisition history.'
      : (error.message || 'Could not delete item');
    toast(msg, 'error');
  }
}

// ============================================================
// RENDER WAREHOUSE (main)
// ============================================================
async function renderWarehouse() {
  const body = document.getElementById('warehouse-body');
  if (!body) return;

  // Reset pagination on fresh render
  resetWarehousePagination();

  await syncWarehouseCacheFromServer();

  const movements     = getScopedWarehouseMovements();
  const balances      = getScopedWarehouseBalances();
  const filteredMoves = getFilteredWarehouseMovements(movements);
  const warehouseList = getWarehousesLocal().filter(w => w.active);
  const showWarehouseSwitcher = isAdmin() || warehouseList.length > 1;

  const today = new Date().toDateString();

  const stockOutToday = movements
    .filter(m => m.type === 'stock_out' && new Date(m.createdAt).toDateString() === today)
    .reduce((sum, m) => sum + Number(m.cartons || 0), 0);

  const stockInToday = movements
    .filter(m => (m.type === 'stock_in' || m.type === 'opening_balance') && new Date(m.createdAt).toDateString() === today)
    .reduce((sum, m) => sum + Number(m.cartons || 0), 0);

  const lowStockItems = balances.filter(b =>
    Number(b.availableCartons || 0) <= Number(b.reorderLevel || 10)
  );

  body.innerHTML = `

    ${showWarehouseSwitcher ? `
    <!-- WAREHOUSE SWITCHER -->
    <div id="wh-switcher-bar" style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:9px 12px;background:var(--gray-50);border:1px solid var(--gray-100);border-radius:var(--radius-lg)">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="var(--brand-brown)" style="flex-shrink:0"><path d="M8 0L1 4v8l7 4 7-4V4L8 0zm0 2.2L13 5l-5 2.8L3 5l5-2.8zM2 6.4l5 2.8v5.4L2 11.8V6.4zm6 8.2V9.2l5-2.8v5.4l-5 2.8z"/></svg>
      <span style="font-size:10px;color:var(--gray-400);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:.07em;flex-shrink:0">Warehouse</span>
      <select class="form-select" style="width:auto;min-width:160px;max-width:220px" onchange="switchWarehouse(this.value)">
        ${isAdmin() ? `<option value="all" ${currentWarehouseId === 'all' ? 'selected' : ''}>All Warehouses</option>` : ''}
        ${warehouseList.map(w => `<option value="${escAttr(w.id)}" ${currentWarehouseId === w.id ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}
      </select>
      ${currentWarehouseId === 'all'
        ? '<span style="font-size:11px;color:var(--gray-400)">Viewing all — pick one warehouse to record Stock In/Out/Adjustments</span>'
        : ''}
    </div>
    ` : ''}

    <!-- STAT CARDS -->
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
      <div class="stat-card">
        <div class="stat-label">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:4px"><path d="M8 0L1 4v8l7 4 7-4V4L8 0zm0 2.2L13 5l-5 2.8L3 5l5-2.8zM2 6.4l5 2.8v5.4L2 11.8V6.4zm6 8.2V9.2l5-2.8v5.4l-5 2.8z"/></svg>
          Warehouse Items
        </div>
        <div class="stat-value">${balances.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:4px"><path d="M8.94 1.5a1.5 1.5 0 0 0-1.88 0L.72 13a1.5 1.5 0 0 0 1.31 2.25h11.94A1.5 1.5 0 0 0 15.28 13L8.94 1.5zM8 5.5c.41 0 .75.34.72.75l-.25 4a.47.47 0 0 1-.94 0l-.25-4A.75.75 0 0 1 8 5.5zm0 7a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z"/></svg>
          Low Stock
        </div>
        <div class="stat-value" style="color:${lowStockItems.length > 0 ? '#dc2626' : 'inherit'}">${lowStockItems.length}</div>
        <div class="stat-delta ${lowStockItems.length > 0 ? 'down' : ''}">${lowStockItems.length > 0 ? 'needs attention' : 'all good ✓'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px"><path d="M8 2v9M4.5 7.5 8 11l3.5-3.5M3 14h10"/></svg>
          Stock In Today
        </div>
        <div class="stat-value">${stockInToday}</div>
        <div class="stat-delta">cartons received</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px"><path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M3 14h10"/></svg>
          Stock Out Today
        </div>
        <div class="stat-value">${stockOutToday}</div>
        <div class="stat-delta">cartons issued</div>
      </div>
    </div>

    <!-- ACTION BUTTONS -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
      <button class="btn btn-primary" onclick="openWarehouseOpeningBalanceModal()">Opening Balance</button>
      <button class="btn btn-primary" onclick="openWarehouseStockInModal()">+ Stock In</button>
      <button class="btn btn-warning" onclick="openWarehouseAdjustmentModal()">⚖ Adjustment</button>
      <button class="btn btn-secondary" onclick="openWarehouseStockOutModal()">Stock Out / Requisition</button>
      <button class="btn btn-secondary" onclick="openWarehouseCsvModal()">⬆ Import CSV</button>
      <button class="btn btn-secondary" onclick="renderWarehouse()">↻ Refresh</button>
    </div>

    <!-- LOW STOCK ALERTS -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <div class="card-title">
          Low Stock Alerts
          ${lowStockItems.length > 0
            ? `<span style="margin-left:8px;background:#fee2e2;color:#991b1b;font-size:11px;
                            padding:2px 8px;border-radius:20px;font-family:var(--font-mono);
                            font-weight:600">${lowStockItems.length}</span>`
            : ''
          }
        </div>
      </div>
      <div style="padding:12px 14px" id="wh-low-stock-container">
        ${_buildLowStockHTML(lowStockItems)}
      </div>
    </div>

    <!-- STOCK BALANCE TABLE -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <div class="card-title">Warehouse Stock Balance</div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
          <div style="font-size:11px;color:var(--gray-400);font-family:var(--font-mono)">
            ${balances.length} items total
          </div>
          <div style="position:relative;display:flex;align-items:center">
            <span style="position:absolute;left:9px;color:var(--gray-400);font-size:14px;pointer-events:none">⌕</span>
            <input
              type="text"
              placeholder="Search items…"
              value="${escapeHtml(balanceSearch)}"
              oninput="filterBalanceSearch(this.value)"
              style="padding:6px 10px 6px 28px;border:1px solid var(--gray-200);border-radius:var(--radius);
                     font-size:13px;width:200px;outline:none;font-family:var(--font-sans);
                     background:var(--white);color:var(--black)"
              onfocus="this.style.borderColor='var(--brand-brown)'"
              onblur="this.style.borderColor='var(--gray-200)'">
          </div>
        </div>
      </div>
      <div style="overflow-x:auto" id="wh-balance-container">
        ${_buildBalanceHTML(balances)}
      </div>
    </div>

    <!-- RECENT MOVEMENTS -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Recent Warehouse Movements</div>
        <input
          class="form-input"
          style="max-width:200px"
          placeholder="Search…"
          value="${escapeHtml(warehouseMovementFilter.search)}"
          oninput="updateWarehouseMovementFilter('search', this.value)">
        <select class="form-select" style="max-width:150px" onchange="updateWarehouseMovementFilter('type', this.value)">
          <option value="all"             ${warehouseMovementFilter.type === 'all'             ? 'selected' : ''}>All Types</option>
          <option value="opening_balance" ${warehouseMovementFilter.type === 'opening_balance' ? 'selected' : ''}>Opening</option>
          <option value="stock_in"        ${warehouseMovementFilter.type === 'stock_in'        ? 'selected' : ''}>Stock In</option>
          <option value="stock_out"       ${warehouseMovementFilter.type === 'stock_out'       ? 'selected' : ''}>Stock Out</option>
        </select>
        <select class="form-select" style="max-width:150px" onchange="updateWarehouseMovementFilter('status', this.value)">
          <option value="all"      ${warehouseMovementFilter.status === 'all'      ? 'selected' : ''}>All Status</option>
          <option value="executed" ${warehouseMovementFilter.status === 'executed' ? 'selected' : ''}>Executed</option>
          <option value="pending"  ${warehouseMovementFilter.status === 'pending'  ? 'selected' : ''}>Pending</option>
          <option value="rejected" ${warehouseMovementFilter.status === 'rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Type</th><th>Description</th>
              <th>Cartons</th><th>Status</th><th>By</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${
              filteredMoves.length
                ? filteredMoves.slice(0, 50).map(m => `
                  <tr>
                    <td class="mono" style="font-size:11px">${whDate(m.createdAt)}</td>
                    <td><span class="badge ${warehouseTypeBadgeClass(m.type)}">${escapeHtml(formatWarehouseType(m.type))}</span></td>
                    <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                      ${escapeHtml(m.description || m.requisitionNo || '—')}
                    </td>
                    <td class="mono" style="text-align:center">${Number(m.cartons || 0)}</td>
                    <td>${warehouseStatusBadge(m.status)}</td>
                    <td style="color:var(--gray-400);font-size:12px">${escapeHtml(m.createdByName || '—')}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="viewWarehouseReq('${m.id}')">View</button>
                    </td>
                  </tr>`)
                  .join('')
                : `<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:24px">
                     No warehouse movements yet.
                   </td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================
// WAREHOUSE LOCATIONS (admin) — add/edit warehouses, assign staff
// ============================================================
let editingWarehouseId = null;

// getUsers()/lumoda_users is a local-only-mode cache that's never kept in
// sync with real Supabase accounts (only the Users admin page fetches live
// profiles, and only to render its own table) — reading it here showed
// stale/empty staff data. Fetch live profiles from Supabase instead.
async function getLiveStaffAccounts() {
  if (!window.LumodaSupabase?.isConfigured?.()) return [];
  try {
    const profiles = await window.LumodaSupabase.loadProfiles();
    return profiles.map(p => ({ id: p.id, fullName: p.full_name, username: p.username, role: p.role, active: p.active !== false }));
  } catch (error) {
    console.warn('Could not load staff accounts', error);
    return [];
  }
}

async function renderWarehousesPage() {
  const body = document.getElementById('warehouses-body');
  if (!body) return;
  await syncWarehouseCacheFromServer();

  const warehouses = getWarehousesLocal();
  const assignments = (await window.LumodaSupabase?.loadWarehouseStaffAssignments?.().catch(() => [])) || [];
  const users = (await getLiveStaffAccounts()).filter(u => u.role === 'warehouse_manager' || u.role === 'admin');
  const balances  = getWarehouseBalancesLocal();
  const movements = getWarehouseMovementsLocal();

  body.innerHTML = warehouses.map(w => {
    const assignedIds = assignments.filter(a => a.warehouse_id === w.id).map(a => a.profile_id);
    const staffPills = users
      .filter(u => u.role === 'admin' || assignedIds.includes(u.id))
      .map(u => u.role === 'admin'
        ? `<span class="badge badge-info" style="margin:1px">${escapeHtml(u.fullName)} · admin</span>`
        : `<span class="badge badge-neutral" style="margin:1px">${escapeHtml(u.fullName)}</span>`
      ).join(' ');
    // A warehouse can only be deleted once it's never held stock or moved
    // anything — the database itself enforces this (foreign keys block the
    // delete), this is just so the button reflects that upfront.
    const isEmpty = !balances.some(b => b.warehouseId === w.id) && !movements.some(m => m.warehouseId === w.id);
    return `
      <tr>
        <td class="mono">${escapeHtml(w.code)}</td>
        <td style="font-weight:500">${escapeHtml(w.name)}</td>
        <td style="color:var(--gray-400)">${escapeHtml(w.address || '—')}</td>
        <td>${w.active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Inactive</span>'}</td>
        <td>${staffPills || '<span style="color:var(--gray-400);font-size:12px">None yet</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick="openWarehouseLocationModal('${w.id}')">Edit</button>
          <button class="btn btn-secondary btn-sm" onclick="openWarehouseStaffModal('${w.id}')">Assign Staff</button>
          <button class="btn btn-secondary btn-sm" ${isEmpty ? `onclick="deleteWarehouseLocation('${w.id}')"` : 'disabled'} title="${isEmpty ? 'Delete this warehouse' : 'Only warehouses with no stock or movement history can be deleted — deactivate it instead'}" style="${isEmpty ? 'color:#991b1b' : 'opacity:.5;cursor:not-allowed'}">Delete</button>
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:24px">No warehouses yet.</td></tr>`;
}

async function deleteWarehouseLocation(id) {
  const w = getWarehousesLocal().find(x => x.id === id);
  if (!w) return;
  if (!confirm(`Delete warehouse "${w.name}"? This cannot be undone.`)) return;
  try {
    await window.LumodaSupabase.deleteWarehouse(id);
    if (typeof addAudit === 'function') addAudit('Warehouse Deleted', `${whCurrentUserName()} deleted warehouse ${w.name} (${w.code})`);
    toast('Warehouse deleted');
    await renderWarehousesPage();
  } catch (error) {
    console.error('Delete warehouse failed:', error);
    const msg = error?.code === '23503'
      ? 'Can\'t delete — this warehouse still has stock or movement history. Deactivate it instead.'
      : (error.message || 'Could not delete warehouse');
    toast(msg, 'error');
  }
}

function openWarehouseLocationModal(id) {
  editingWarehouseId = id || null;
  const w = id ? getWarehousesLocal().find(x => x.id === id) : null;
  document.getElementById('warehouse-location-modal-title').textContent = w ? 'Edit Warehouse' : 'Add Warehouse';
  document.getElementById('wh-loc-code').value    = w?.code    || '';
  document.getElementById('wh-loc-name').value    = w?.name    || '';
  document.getElementById('wh-loc-address').value = w?.address || '';
  document.getElementById('wh-loc-active').checked = w ? !!w.active : true;
  document.getElementById('wh-loc-error').style.display = 'none';
  openModal('warehouse-location-modal');
}

async function saveWarehouseLocation() {
  const code    = document.getElementById('wh-loc-code').value.trim().toUpperCase();
  const name    = document.getElementById('wh-loc-name').value.trim();
  const address = document.getElementById('wh-loc-address').value.trim();
  const active  = document.getElementById('wh-loc-active').checked;
  const errEl   = document.getElementById('wh-loc-error');
  if (!code || !name) {
    errEl.textContent = 'Code and name are required.';
    errEl.style.display = 'block';
    return;
  }
  try {
    await window.LumodaSupabase.saveWarehouse({ id: editingWarehouseId, code, name, address, active });
    if (typeof addAudit === 'function') addAudit('Warehouse Saved', `${whCurrentUserName()} ${editingWarehouseId ? 'edited' : 'added'} warehouse ${name} (${code})`);
    closeModal('warehouse-location-modal');
    toast('Warehouse saved');
    await renderWarehousesPage();
  } catch (error) {
    console.error('Save warehouse failed:', error);
    errEl.textContent = error.message || 'Could not save warehouse';
    errEl.style.display = 'block';
  }
}

let assigningWarehouseId = null;

async function openWarehouseStaffModal(warehouseId) {
  assigningWarehouseId = warehouseId;
  const w = getWarehousesLocal().find(x => x.id === warehouseId);
  document.getElementById('warehouse-staff-modal-title').textContent = 'Assign Staff — ' + (w?.name || '');
  await renderWarehouseStaffList();
  openModal('warehouse-staff-modal');
}

async function renderWarehouseStaffList() {
  const container = document.getElementById('warehouse-staff-list');
  if (!container) return;
  const assignments = (await window.LumodaSupabase?.loadWarehouseStaffAssignments?.().catch(() => [])) || [];
  const assignedIds = assignments.filter(a => a.warehouse_id === assigningWarehouseId).map(a => a.profile_id);
  const managers = (await getLiveStaffAccounts()).filter(u => u.role === 'warehouse_manager' && u.active);

  if (!managers.length) {
    container.innerHTML = `<div style="padding:12px;color:var(--gray-400);font-size:13px">No warehouse manager accounts yet — create one under User Management first.</div>`;
    return;
  }

  container.innerHTML = managers.map(u => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;border-bottom:1px solid var(--gray-50)">
      <input type="checkbox" style="width:14px;height:14px;margin:0"
        ${assignedIds.includes(u.id) ? 'checked' : ''}
        onchange="toggleWarehouseStaffAssignment('${u.id}', this.checked)">
      ${escapeHtml(u.fullName)} <span style="color:var(--gray-400);font-family:var(--font-mono)">@${escapeHtml(u.username)}</span>
    </label>
  `).join('');
}

async function toggleWarehouseStaffAssignment(profileId, checked) {
  try {
    if (checked) {
      await window.LumodaSupabase.assignStaffToWarehouse(profileId, assigningWarehouseId);
    } else {
      await window.LumodaSupabase.removeStaffFromWarehouse(profileId, assigningWarehouseId);
    }
    if (typeof addAudit === 'function') addAudit('Warehouse Staff Assignment', `${whCurrentUserName()} ${checked ? 'assigned' : 'removed'} staff for a warehouse`);
    await renderWarehousesPage();
  } catch (error) {
    console.error('Assignment failed:', error);
    toast(error.message || 'Could not update assignment', 'error');
    await renderWarehouseStaffList(); // revert checkbox state on failure
  }
}

// ============================================================
// OPENING BALANCE / CSV
// ============================================================
// Every write action needs one specific target warehouse — block with a
// clear message if the switcher is set to 'all' or nothing's selected yet.
function requireActiveWarehouse() {
  if (currentWarehouseId && currentWarehouseId !== 'all') return true;
  toast('Pick a single warehouse first (top of the page) before recording stock', 'error');
  return false;
}

function openWarehouseOpeningBalanceModal() {
  if (!requireActiveWarehouse()) return;
  document.getElementById('wh-ob-code').value        = '';
  document.getElementById('wh-ob-description').value = '';
  document.getElementById('wh-ob-cartons').value     = '';
  document.getElementById('wh-ob-notes').value       = '';
  openModal('warehouse-opening-modal');
}

function openWarehouseCsvModal() {
  if (!requireActiveWarehouse()) return;
  openModal('warehouse-csv-modal');
}

function parseWarehouseCsv(text) {
  const lines   = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const row    = {};
    headers.forEach((header, index) => { row[header] = values[index] || ''; });
    return row;
  });
}

async function importWarehouseCsv() {
  const fileInput = document.getElementById('warehouse-csv-file');
  const file      = fileInput?.files?.[0];
  if (!file) { toast('Please select a CSV file first', 'error'); return; }
  try {
    const text      = await file.text();
    const rows      = parseWarehouseCsv(text);
    const validRows = rows
      .map(row => ({
        itemCode:     String(row.item_code || row.code || row.sku || '').trim(),
        description:  String(row.item_name || row.name || row.description || '').trim(),
        cartons:      Number(row.cartons || row.quantity || row.stock || 0),
        reorderLevel: Number(row.reorder_level || 10),
        unitPrice:    Number(row.unit_price || row.price || 0)
      }))
      .filter(row => row.description && row.cartons > 0);

    if (!validRows.length) { toast('No valid warehouse items found in CSV', 'error'); return; }

    for (const item of validRows) {
      await window.LumodaSupabase.postWarehouseMovementDirect({
        type: 'opening_balance', description: item.description, cartons: item.cartons,
        notes: 'Warehouse CSV import', created_by_name: whCurrentUserName(),
        warehouse_id: currentWarehouseId,
        items: [{ itemCode: whSafeCode(item.itemCode, item.description), description: item.description, cartons: item.cartons, unitPrice: item.unitPrice, reorderLevel: item.reorderLevel }]
      });
    }
    if (typeof addAudit === 'function') addAudit('Warehouse CSV Import', `${whCurrentUserName()} imported ${validRows.length} warehouse item(s)`);
    closeModal('warehouse-csv-modal');
    toast(`${validRows.length} warehouse item(s) imported`);
    await syncWarehouseCacheFromServer();
    renderWarehouse();
  } catch (error) {
    console.error('Warehouse CSV import failed:', error);
    toast(error.message || 'Warehouse CSV import failed', 'error');
  }
}

async function saveWarehouseOpeningBalance() {
  const description = document.getElementById('wh-ob-description').value.trim();
  const codeRaw     = document.getElementById('wh-ob-code').value.trim();
  const cartons     = Number(document.getElementById('wh-ob-cartons').value || 0);
  const notes       = document.getElementById('wh-ob-notes').value.trim();
  if (!description || cartons <= 0) { toast('Description and cartons are required', 'error'); return; }
  const itemCode = whSafeCode(codeRaw, description);
  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type: 'opening_balance', description, cartons, notes,
      created_by_name: whCurrentUserName(),
      warehouse_id: currentWarehouseId,
      items: [{ itemCode, description, cartons }]
    });
    if (!result?.success) { toast(result?.error || 'Opening balance failed', 'error'); return; }
    closeModal('warehouse-opening-modal');
    toast('Opening balance saved');
    await syncWarehouseCacheFromServer();
    renderWarehouse();
  } catch (error) {
    console.error('Opening balance failed:', error);
    toast(error.message || 'Opening balance failed', 'error');
  }
}

// ============================================================
// STOCK IN — MULTI-ITEM (new)
// ============================================================
let warehouseStockInItems = [];

function openWarehouseStockInModal() {
  if (!requireActiveWarehouse()) return;
  warehouseStockInItems = [];
  document.getElementById('wh-in-supplier').value = '';
  document.getElementById('wh-in-notes').value    = '';

  // Populate datalist for item search
  const list = document.getElementById('warehouse-stockin-items');
  if (list) {
    list.innerHTML = getScopedWarehouseBalances().map(item =>
      `<option value="${escapeHtml(item.itemName)}">${escapeHtml(item.itemName)} (${escapeHtml(item.itemCode)})</option>`
    ).join('');
  }

  // Add first row and render
  _addStockInRow();
  openModal('warehouse-stockin-modal');
}

function _addStockInRow(item = {}) {
  warehouseStockInItems.push({
    itemCode:    item.itemCode    || '',
    description: item.description || '',
    cartons:     item.cartons     || ''
  });
  _renderStockInRows();
}

function _removeStockInRow(index) {
  warehouseStockInItems.splice(index, 1);
  _renderStockInRows();
}

function _updateStockInItem(index, field, value) {
  if (!warehouseStockInItems[index]) return;
  warehouseStockInItems[index][field] = field === 'cartons' ? Number(value || 0) : value;
}

function _selectStockInItem(index, value) {
  if (!warehouseStockInItems[index]) return;
  warehouseStockInItems[index].description = value;
  const q    = value.toLowerCase().trim();
  // Match against the catalog-merged list (same source the datalist itself
  // is built from), not just items that already have a balance row here —
  // otherwise a freshly-added, never-stocked item can't be selected.
  const item = getScopedWarehouseBalances().find(x =>
    String(x.itemName || '').toLowerCase() === q ||
    String(x.itemCode || '').toLowerCase() === q
  );
  if (item) {
    warehouseStockInItems[index].itemCode    = item.itemCode;
    warehouseStockInItems[index].description = item.itemName;
    _renderStockInRows();
  }
}

function _renderStockInRows() {
  // Stock In now uses the same modal layout as Stock Out
  // We inject into wh-in-description's parent — but since we're
  // repurposing the modal, we target a container div instead.
  const container = document.getElementById('wh-stockin-rows-container');
  if (!container) return;

  container.innerHTML = warehouseStockInItems.map((item, index) => `
    <tr>
      <td style="min-width:130px">
        <input class="form-input" style="min-width:110px"
          value="${escapeHtml(item.itemCode || '')}"
          oninput="_updateStockInItem(${index}, 'itemCode', this.value)"
          placeholder="Item code">
      </td>
      <td style="min-width:280px">
        <input class="form-input" style="min-width:260px"
          list="si-list-${index}"
          value="${escapeHtml(item.description || '')}"
          oninput="_selectStockInItem(${index}, this.value)"
          placeholder="Search product name">
        <datalist id="si-list-${index}">
          ${getWarehouseBalancesLocal().map(p =>
            `<option value="${escapeHtml(p.itemName)}">${escapeHtml(p.itemName)} (${escapeHtml(p.itemCode)})</option>`
          ).join('')}
        </datalist>
      </td>
      <td style="min-width:120px">
        <input class="form-input" type="number" min="1"
          style="min-width:100px"
          value="${item.cartons || ''}"
          oninput="_updateStockInItem(${index}, 'cartons', this.value)"
          placeholder="Cartons">
      </td>
      <td style="width:50px;text-align:center">
        <button class="remove-btn" onclick="_removeStockInRow(${index})">×</button>
      </td>
    </tr>
  `).join('');
}

async function saveWarehouseStockIn() {
  const supplier = document.getElementById('wh-in-supplier').value.trim();
  const notes    = document.getElementById('wh-in-notes').value.trim();

  if (!supplier) { toast('Supplier name is required', 'error'); return; }

  const validItems = warehouseStockInItems
    .map(item => ({
      itemCode:    whSafeCode(item.itemCode, item.description),
      description: String(item.description || '').trim(),
      cartons:     Number(item.cartons || 0)
    }))
    .filter(item => item.description && item.cartons > 0);

  if (!validItems.length) { toast('Add at least one item with a quantity', 'error'); return; }

  const totalCartons = validItems.reduce((sum, item) => sum + item.cartons, 0);
  const description  = `${validItems.length} item(s) from ${supplier}`;

  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type:              'stock_in',
      supplier,
      description,
      cartons:           totalCartons,
      notes,
      created_by_name:   whCurrentUserName(),
      warehouse_id:      currentWarehouseId,
      items:             validItems
    });

    if (!result?.success) { toast(result?.error || 'Stock in failed', 'error'); return; }

    if (typeof addAudit === 'function') {
      addAudit('Warehouse Stock In',
        `${whCurrentUserName()} received ${totalCartons} carton(s) from ${supplier} — ${validItems.length} product(s)`);
    }

    closeModal('warehouse-stockin-modal');
    toast(`Stock In saved — ${totalCartons} cartons, ${validItems.length} items`);
    await syncWarehouseCacheFromServer();
    renderWarehouse();
  } catch (error) {
    console.error('Stock in failed:', error);
    toast(error.message || 'Stock in failed', 'error');
  }
}

// ============================================================
// ADJUSTMENT
// ============================================================
function openWarehouseAdjustmentModal() {
  if (!requireActiveWarehouse()) return;
  const list = document.getElementById('warehouse-adjustment-items');
  document.getElementById('wh-adjust-item').value    = '';
  document.getElementById('wh-adjust-type').value    = 'add';
  document.getElementById('wh-adjust-cartons').value = '';
  document.getElementById('wh-adjust-reason').value  = '';
  if (list) {
    list.innerHTML = getScopedWarehouseBalances().map(item =>
      `<option value="${escapeHtml(item.itemName)}">${escapeHtml(item.itemName)} (${escapeHtml(item.itemCode)}) — Available: ${item.availableCartons}</option>`
    ).join('');
  }
  openModal('warehouse-adjustment-modal');
}

async function saveWarehouseAdjustment() {
  const itemName = document.getElementById('wh-adjust-item').value.trim();
  const type     = document.getElementById('wh-adjust-type').value;
  const cartons  = Number(document.getElementById('wh-adjust-cartons').value || 0);
  const reason   = document.getElementById('wh-adjust-reason').value.trim();
  if (!itemName || cartons <= 0 || !reason) { toast('Item, cartons, and reason are required', 'error'); return; }
  const item = getScopedWarehouseBalances().find(x => String(x.itemName || '').toLowerCase() === itemName.toLowerCase());
  if (!item) { toast('Select a valid warehouse item', 'error'); return; }
  if (type === 'remove' && cartons > Number(item.availableCartons || 0)) { toast('Cannot remove more than available stock', 'error'); return; }
  const movementType = type === 'add' ? 'stock_in' : 'stock_out';
  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type: movementType, description: `Adjustment: ${item.itemName}`,
      cartons, notes: reason, created_by_name: whCurrentUserName(),
      warehouse_id: currentWarehouseId,
      items: [{ itemCode: item.itemCode, description: item.itemName, cartons }]
    });
    if (!result?.success) { toast(result?.error || 'Adjustment failed', 'error'); return; }
    if (typeof addAudit === 'function') addAudit('Warehouse Adjustment', `${whCurrentUserName()} ${type === 'add' ? 'added' : 'removed'} ${cartons} carton(s) of ${item.itemName}. Reason: ${reason}`);
    closeModal('warehouse-adjustment-modal');
    toast('Adjustment saved');
    await syncWarehouseCacheFromServer();
    renderWarehouse();
  } catch (error) {
    console.error('Adjustment failed:', error);
    toast(error.message || 'Adjustment failed', 'error');
  }
}

// ============================================================
// STOCK OUT / REQUISITION
// ============================================================
let warehouseRequisitionItems = [];

function openWarehouseStockOutModal() {
  if (!requireActiveWarehouse()) return;
  warehouseRequisitionItems = [];
  document.getElementById('wh-out-issue-to').value    = 'Alabar';
  document.getElementById('wh-out-storekeeper').value = whCurrentUserName();
  document.getElementById('wh-out-notes').value       = '';
  addWarehouseRequisitionRow();
  openModal('warehouse-stockout-modal');
}

function addWarehouseRequisitionRow() {
  warehouseRequisitionItems.push({ itemCode: '', description: '', cartons: 0 });
  renderWarehouseRequisitionRows();
}

function removeWarehouseRequisitionRow(index) {
  warehouseRequisitionItems.splice(index, 1);
  renderWarehouseRequisitionRows();
}

function updateWarehouseReqItem(index, field, value) {
  if (!warehouseRequisitionItems[index]) return;
  warehouseRequisitionItems[index][field] = field === 'cartons' ? Number(value || 0) : value;
}

function selectWarehouseItem(index, value) {
  if (!warehouseRequisitionItems[index]) return;
  const q    = String(value || '').toLowerCase().trim();
  warehouseRequisitionItems[index].description = value;
  const item = getScopedWarehouseBalances().find(x =>
    String(x.itemName || '').toLowerCase() === q ||
    String(x.itemCode || '').toLowerCase() === q
  );
  if (!item) return;
  warehouseRequisitionItems[index].itemCode    = item.itemCode;
  warehouseRequisitionItems[index].description = item.itemName;
  renderWarehouseRequisitionRows();
}

function renderWarehouseRequisitionRows() {
  const body = document.getElementById('warehouse-requisition-items-body');
  if (!body) return;
  body.innerHTML = warehouseRequisitionItems.map((item, index) => `
    <tr>
      <td style="min-width:140px">
        <input class="form-input" style="min-width:120px"
          value="${escapeHtml(item.itemCode || '')}"
          oninput="updateWarehouseReqItem(${index}, 'itemCode', this.value)"
          placeholder="e.g. BL001">
      </td>
      <td style="min-width:320px">
        <input class="form-input" style="min-width:300px"
          list="warehouse-items-list-${index}"
          value="${escapeHtml(item.description || '')}"
          oninput="selectWarehouseItem(${index}, this.value)"
          placeholder="Search product name">
        <datalist id="warehouse-items-list-${index}">
          ${getScopedWarehouseBalances().map(p =>
            `<option value="${escapeHtml(p.itemName)}">${escapeHtml(p.itemName)} (${escapeHtml(p.itemCode)}) — Available: ${p.availableCartons}</option>`
          ).join('')}
        </datalist>
      </td>
      <td style="min-width:140px">
        <input class="form-input" type="number" min="0" style="min-width:120px"
          value="${item.cartons || ''}"
          oninput="updateWarehouseReqItem(${index}, 'cartons', this.value)"
          placeholder="Cartons">
      </td>
      <td style="width:60px;text-align:center">
        <button class="remove-btn" onclick="removeWarehouseRequisitionRow(${index})">×</button>
      </td>
    </tr>
  `).join('');
}

async function saveWarehouseStockOut() {
  const issueTo     = document.getElementById('wh-out-issue-to').value;
  const storekeeper = document.getElementById('wh-out-storekeeper').value.trim();
  const notes       = document.getElementById('wh-out-notes').value.trim();

  const validItems = warehouseRequisitionItems
    .map(item => ({
      itemCode:    whSafeCode(item.itemCode, item.description),
      description: String(item.description || '').trim(),
      cartons:     Number(item.cartons || 0)
    }))
    .filter(item => item.description && item.cartons > 0);

  if (!storekeeper || !validItems.length) { toast('Storekeeper and at least one item are required', 'error'); return; }

  for (const reqItem of validItems) {
    const stockItem = getScopedWarehouseBalances().find(x =>
      String(x.itemCode || '').toLowerCase() === String(reqItem.itemCode || '').toLowerCase()
    );
    if (!stockItem) { toast(`Item not found in warehouse: ${reqItem.description}`, 'error'); return; }
    if (Number(reqItem.cartons || 0) > Number(stockItem.availableCartons || 0)) {
      toast(`Not enough stock for ${reqItem.description} (available: ${stockItem.availableCartons})`, 'error');
      return;
    }
  }

  const requisitionNo  = 'REQ-' + Date.now();
  const totalCartons   = validItems.reduce((sum, item) => sum + Number(item.cartons || 0), 0);

  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type:            'stock_out',
      requisition_no:  requisitionNo,
      issue_to:        issueTo,
      storekeeper,
      description:     `${validItems.length} item(s) issued to ${issueTo}`,
      cartons:         totalCartons,
      notes,
      created_by_name: whCurrentUserName(),
      warehouse_id:    currentWarehouseId,
      items:           validItems
    });

    if (!result?.success) { toast(result?.error || 'Stock out failed', 'error'); return; }
    if (typeof addAudit === 'function') addAudit('Warehouse Stock Out', `${whCurrentUserName()} issued ${totalCartons} carton(s) to ${issueTo}`);
    closeModal('warehouse-stockout-modal');
    toast('Stock out saved');
    await syncWarehouseCacheFromServer();
    renderWarehouse();
  } catch (error) {
    console.error('Stock out failed:', error);
    toast(error.message || 'Stock out failed', 'error');
  }
}

// ============================================================
// VIEW / PRINT REQUISITION
// ============================================================
function viewWarehouseReq(movementId) {
  const movement = getWarehouseMovementsLocal().find(x => x.id === movementId);
  if (!movement) { toast('Movement not found', 'error'); return; }

  const body      = document.getElementById('warehouse-view-body');
  if (!body) return;

  const isStockIn  = movement.type === 'stock_in';
  const isOpening  = movement.type === 'opening_balance';
  const isStockOut = movement.type === 'stock_out';
  const title      = isStockIn ? 'Warehouse Stock In'
                   : isOpening ? 'Warehouse Opening Balance'
                   : 'Warehouse Requisition / Stock Out';

  body.innerHTML = `
    <div style="margin-bottom:18px">
      <h2 style="margin-bottom:10px;font-size:16px">${title}</h2>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:5px 16px;font-size:13px">
        ${movement.requisitionNo ? `<span style="color:var(--gray-400)">Requisition No</span><strong>${escapeHtml(movement.requisitionNo)}</strong>` : ''}
        ${isStockIn  ? `<span style="color:var(--gray-400)">Supplier</span><span>${escapeHtml(movement.supplier || '—')}</span>` : ''}
        ${isStockOut ? `<span style="color:var(--gray-400)">Issue To</span><span>${escapeHtml(movement.issueTo || '—')}</span>` : ''}
        ${isStockOut ? `<span style="color:var(--gray-400)">Storekeeper</span><span>${escapeHtml(movement.storekeeper || '—')}</span>` : ''}
        <span style="color:var(--gray-400)">Type</span><span>${escapeHtml(formatWarehouseType(movement.type))}</span>
        <span style="color:var(--gray-400)">Status</span><span>${warehouseStatusBadge(movement.status)}</span>
        <span style="color:var(--gray-400)">By</span><span>${escapeHtml(movement.createdByName || '—')}</span>
        <span style="color:var(--gray-400)">Date</span><span>${whDate(movement.createdAt)}</span>
      </div>
    </div>
    <div style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>Item Code</th><th>Description</th><th style="text-align:right">Cartons</th>
        </tr>
      </thead>
      <tbody>
        ${(movement.items || []).map(item => `
          <tr>
            <td class="mono">${escapeHtml(item.itemCode || '')}</td>
            <td>${escapeHtml(item.description || '')}</td>
            <td class="mono" style="text-align:right;font-weight:600">${Number(item.cartons || 0)}</td>
          </tr>`).join('')}
        <tr style="border-top:2px solid var(--gray-200)">
          <td colspan="2" style="text-align:right;font-weight:600;padding:10px 13px">Total Cartons</td>
          <td class="mono" style="text-align:right;font-weight:700;font-size:15px;color:var(--brand-brown)">
            ${(movement.items || []).reduce((s, i) => s + Number(i.cartons || 0), 0)}
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    ${movement.notes ? `<div style="margin-top:14px;padding:10px;background:var(--gray-50);border-radius:var(--radius);font-size:13px"><strong>Notes:</strong> ${escapeHtml(movement.notes)}</div>` : ''}
  `;

  document.getElementById('warehouse-view-title').textContent = title;
  openModal('warehouse-view-modal');
}

function printWarehouseReq() {
  const content   = document.getElementById('warehouse-view-body');
  const printArea = document.getElementById('print-area');
  if (!content?.innerHTML.trim()) { toast('Nothing to print', 'error'); return; }
  if (!printArea) { toast('Print area not found', 'error'); return; }
  printArea.innerHTML = `
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#000;max-width:760px;margin:0 auto">
      <div style="background:#5C2D0A;color:white;padding:12px 16px;text-align:center">
        <div style="font-size:18px;font-weight:700;letter-spacing:1px">LUMODA ENTERPRISE</div>
        <div style="font-style:italic;font-size:11px;opacity:.85">The cook's helper</div>
        <div style="font-size:10px;opacity:.75">Warehouse Movement Record</div>
      </div>
      <div style="padding:14px;border:2px solid #5C2D0A;border-top:0">${content.innerHTML}</div>
    </div>`;
  setTimeout(() => window.print(), 100);
}

// ============================================================
// PRODUCTS / SUPPLIERS BASIC SUPPORT
// ============================================================
function openWarehouseProductModal() {
  // Adding an item touches the shared catalog, not a specific warehouse's
  // stock, so unlike Stock In/Out this doesn't require one to be selected.
  document.getElementById('wh-prod-code').value     = '';
  document.getElementById('wh-prod-name').value     = '';
  document.getElementById('wh-prod-category').value = '';
  document.getElementById('wh-prod-reorder').value  = getDefaultReorderLevel();
  openModal('warehouse-product-modal');
}

async function saveWarehouseProduct() {
  const name = document.getElementById('wh-prod-name').value.trim();
  if (!name) { toast('Product name is required', 'error'); return; }
  const code     = whSafeCode(document.getElementById('wh-prod-code').value, name);
  const category = document.getElementById('wh-prod-category').value.trim() || 'General';
  const reorder  = Number(document.getElementById('wh-prod-reorder').value) || getDefaultReorderLevel();
  try {
    await window.LumodaSupabase.saveWarehouseProduct({ code, name, category, reorder });
    if (typeof addAudit === 'function') addAudit('Warehouse Item Added', `${whCurrentUserName()} added item "${name}" (${code})`);
    closeModal('warehouse-product-modal');
    toast('Item added — it\'s now available in every warehouse');
    await renderWarehouse();
  } catch (error) {
    console.error('Save warehouse item failed:', error);
    toast(error.message || 'Could not save item', 'error');
  }
}
async function saveWarehouseSupplier(payload) {
  if (!window.LumodaSupabase?.saveWarehouseSupplier) return null;
  return window.LumodaSupabase.saveWarehouseSupplier(payload);
}

// ============================================================
// GLOBAL EXPORTS
// ============================================================
window.renderWarehouse                = renderWarehouse;
window.openWarehouseOpeningBalanceModal = openWarehouseOpeningBalanceModal;
window.saveWarehouseOpeningBalance    = saveWarehouseOpeningBalance;
window.openWarehouseStockInModal      = openWarehouseStockInModal;
window.saveWarehouseStockIn           = saveWarehouseStockIn;
window.selectWarehouseStockInItem     = _selectStockInItem;
window._addStockInRow                 = _addStockInRow;
window._removeStockInRow              = _removeStockInRow;
window._updateStockInItem             = _updateStockInItem;
window._selectStockInItem             = _selectStockInItem;
window._renderStockInRows             = _renderStockInRows;
window.openWarehouseStockOutModal     = openWarehouseStockOutModal;
window.saveWarehouseStockOut          = saveWarehouseStockOut;
window.openWarehouseCsvModal          = openWarehouseCsvModal;
window.importWarehouseCsv             = importWarehouseCsv;
window.addWarehouseRequisitionRow     = addWarehouseRequisitionRow;
window.removeWarehouseRequisitionRow  = removeWarehouseRequisitionRow;
window.updateWarehouseReqItem         = updateWarehouseReqItem;
window.selectWarehouseItem            = selectWarehouseItem;
window.syncWarehouseCacheFromServer   = syncWarehouseCacheFromServer;
window.viewWarehouseReq               = viewWarehouseReq;
window.printWarehouseReq              = printWarehouseReq;
window.openWarehouseAdjustmentModal   = openWarehouseAdjustmentModal;
window.saveWarehouseAdjustment        = saveWarehouseAdjustment;
window.updateWarehouseMovementFilter  = updateWarehouseMovementFilter;
window.loadMoreLowStock               = loadMoreLowStock;
window.loadMoreBalance                = loadMoreBalance;
window.filterBalanceSearch            = filterBalanceSearch;