// ============================================================
// LUMODA ENTERPRISE - warehouse.js
// Warehouse module only — SERVER-AUTHORITATIVE
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
    .trim()
    .toUpperCase()
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
  if (s === 'pending') return '<span class="badge badge-warning">Pending</span>';
  if (s === 'executed') return '<span class="badge badge-success">Executed</span>';
  if (s === 'rejected') return '<span class="badge badge-danger">Rejected</span>';
  return `<span class="badge badge-neutral">${escapeHtml(s)}</span>`;
}

function formatWarehouseType(type) {
  const labels = {
    opening_balance: 'Opening Balance',
    stock_in: 'Stock In',
    stock_out: 'Stock Out',
    adjustment: 'Adjustment'
  };
  return labels[type] || type || '—';
}

// ============================================================
// NORMALIZERS
// ============================================================

function normalizeWarehouseMovement(row) {
  return {
    id: row.id,
    type: row.type,
    requisitionNo: row.requisition_no || row.requisitionNo || '',
    issueTo: row.issue_to || row.issueTo || '',
    storekeeper: row.storekeeper || '',
    supplier: row.supplier || '',
    description: row.description || '',
    cartons: Number(row.cartons || 0),
    notes: row.notes || '',
    items: Array.isArray(row.items) ? row.items : [],
    status: row.status || 'executed',
    createdByName: row.created_by_name || row.createdByName || 'Unknown',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now()),
    approvedAt: row.approved_at ? new Date(row.approved_at).getTime() : (row.approvedAt || null),
    rejectionReason: row.rejection_reason || row.rejectionReason || ''
  };
}

function normalizeWarehouseProduct(row) {
  return {
    id: row.id,
    code: row.code || '',
    name: row.name || '',
    category: row.category || 'General',
    reorder: Number(row.reorder_level || row.reorder || 0),
    createdByName: row.created_by_name || row.createdByName || 'Unknown',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now())
  };
}

function normalizeWarehouseSupplier(row) {
  return {
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    location: row.location || '',
    notes: row.notes || '',
    createdByName: row.created_by_name || row.createdByName || 'Unknown',
    createdAt: row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now())
  };
}

function normalizeWarehouseBalance(row) {
  return {
    id: row.id,
    itemCode: row.item_code || row.itemCode || '',
    itemName: row.item_name || row.itemName || row.description || '',
    totalCartons: Number(row.total_cartons || row.totalCartons || 0),
    reservedCartons: Number(row.reserved_cartons || row.reservedCartons || 0),
    availableCartons: Number(row.available_cartons || row.availableCartons || 0),
    reorderLevel: Number(row.reorder_level || row.reorderLevel || 10),
    unitPrice: Number(row.unit_price || row.unitPrice || row.price || 0),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : (row.updatedAt || Date.now())
  };
}

// ============================================================
// SYNC
// ============================================================

async function syncWarehouseCacheFromServer() {
  if (!isWarehouseSyncEnabled()) return;

  try {
    const [movements, products, suppliers, balances] = await Promise.all([
      window.LumodaSupabase.loadWarehouseMovements?.().catch(() => []),
      window.LumodaSupabase.loadWarehouseProducts?.().catch(() => []),
      window.LumodaSupabase.loadWarehouseSuppliers?.().catch(() => []),
      window.LumodaSupabase.loadWarehouseStockBalance?.().catch(() => [])
    ]);

    if (Array.isArray(movements)) saveWarehouseMovementsLocal(movements.map(normalizeWarehouseMovement));
    if (Array.isArray(products)) saveWarehouseProductsLocal(products.map(normalizeWarehouseProduct));
    if (Array.isArray(suppliers)) saveWarehouseSuppliersLocal(suppliers.map(normalizeWarehouseSupplier));
    if (Array.isArray(balances)) saveWarehouseBalancesLocal(balances.map(normalizeWarehouseBalance));
  } catch (error) {
    console.warn('Warehouse sync failed', error);
  }
}

// ============================================================
// MOVEMENT FILTERS
// ============================================================

let warehouseMovementFilter = {
  search: '',
  type: 'all',
  status: 'all'
};

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

    const matchesType =
      warehouseMovementFilter.type === 'all' ||
      m.type === warehouseMovementFilter.type;

    const matchesStatus =
      warehouseMovementFilter.status === 'all' ||
      m.status === warehouseMovementFilter.status;

    return matchesSearch && matchesType && matchesStatus;
  });
}

// ============================================================
// RENDER WAREHOUSE
// ============================================================

async function renderWarehouse() {
  const body = document.getElementById('warehouse-body');
  if (!body) return;

  await syncWarehouseCacheFromServer();

  const movements = getWarehouseMovementsLocal();
  const balances = getWarehouseBalancesLocal();
  const filteredMovements = getFilteredWarehouseMovements(movements);

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
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:18px">
      <div class="stat-card">
        <div class="stat-label">Warehouse Items</div>
        <div class="stat-value">${balances.length}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Low Stock Items</div>
        <div class="stat-value">${lowStockItems.length}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Stock In Today</div>
        <div class="stat-value">${stockInToday}</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Stock Out Today</div>
        <div class="stat-value">${stockOutToday}</div>
      </div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="btn btn-primary" onclick="openWarehouseOpeningBalanceModal()">Opening Balance</button>
      <button class="btn btn-primary" onclick="openWarehouseStockInModal()">+ Stock In</button>
      <button class="btn btn-warning" onclick="openWarehouseAdjustmentModal()">Adjustment</button>
      <button class="btn btn-secondary" onclick="openWarehouseStockOutModal()">Stock Out / Requisition</button>
      <button class="btn btn-secondary" onclick="openWarehouseCsvModal()">⬆ Import CSV</button>
      <button class="btn btn-secondary" onclick="renderWarehouse()">↻ Refresh</button>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <div class="card-title">Low Stock Alerts</div>
      </div>

      ${
        lowStockItems.length
          ? `
            <div style="padding:12px">
              ${lowStockItems.map(b => `
                <div style="padding:12px;border:1px solid #facc15;background:#fef9c3;border-radius:10px;margin-bottom:10px">
                  <strong>${escapeHtml(b.itemName)}</strong>
                  <div style="font-size:13px;margin-top:4px">
                    Available: <strong>${b.availableCartons}</strong> cartons
                  </div>
                  <div style="font-size:13px">
                    Reorder Level: ${b.reorderLevel || 10}
                  </div>
                </div>
              `).join('')}
            </div>
          `
          : `<div style="padding:20px;color:var(--gray-400)">No low stock items.</div>`
      }
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <div class="card-title">Warehouse Stock Balance</div>
      </div>

      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>Total Cartons</th>
              <th>Reserved</th>
              <th>Closing Balance</th>
              <th>Reorder Level</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>

          <tbody>
            ${
              balances.length
                ? balances.map(b => `
                  <tr>
                    <td class="mono">${escapeHtml(b.itemCode)}</td>
                    <td>${escapeHtml(b.itemName)}</td>
                    <td>${b.totalCartons}</td>
                    <td>${b.reservedCartons}</td>
                    <td><strong>${b.availableCartons}</strong></td>
                    <td>${b.reorderLevel || 10}</td>
                    <td>
                      ${
                        Number(b.availableCartons || 0) <= Number(b.reorderLevel || 10)
                          ? '<span class="badge badge-danger">Reorder</span>'
                          : '<span class="badge badge-success">OK</span>'
                      }
                    </td>
                    <td>${whDate(b.updatedAt)}</td>
                  </tr>
                `).join('')
                : `<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:20px">No warehouse stock yet. Add Opening Balance or Stock In.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Recent Warehouse Movements</div>

        <input
          class="form-input"
          style="max-width:220px"
          placeholder="Search movements..."
          value="${escapeHtml(warehouseMovementFilter.search)}"
          oninput="updateWarehouseMovementFilter('search', this.value)">

        <select
          class="form-select"
          style="max-width:160px"
          onchange="updateWarehouseMovementFilter('type', this.value)">
          <option value="all" ${warehouseMovementFilter.type === 'all' ? 'selected' : ''}>All Types</option>
          <option value="opening_balance" ${warehouseMovementFilter.type === 'opening_balance' ? 'selected' : ''}>Opening</option>
          <option value="stock_in" ${warehouseMovementFilter.type === 'stock_in' ? 'selected' : ''}>Stock In</option>
          <option value="stock_out" ${warehouseMovementFilter.type === 'stock_out' ? 'selected' : ''}>Stock Out</option>
        </select>

        <select
          class="form-select"
          style="max-width:160px"
          onchange="updateWarehouseMovementFilter('status', this.value)">
          <option value="all" ${warehouseMovementFilter.status === 'all' ? 'selected' : ''}>All Status</option>
          <option value="executed" ${warehouseMovementFilter.status === 'executed' ? 'selected' : ''}>Executed</option>
          <option value="pending" ${warehouseMovementFilter.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="rejected" ${warehouseMovementFilter.status === 'rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </div>

      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Description</th>
              <th>Cartons</th>
              <th>Status</th>
              <th>By</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${
              filteredMovements.length
                ? filteredMovements.slice(0, 50).map(m => `
                  <tr>
                    <td>${whDate(m.createdAt)}</td>
                    <td>${formatWarehouseType(m.type)}</td>
                    <td>${escapeHtml(m.description || m.requisitionNo || '—')}</td>
                    <td>${Number(m.cartons || 0)}</td>
                    <td>${warehouseStatusBadge(m.status)}</td>
                    <td>${escapeHtml(m.createdByName || '—')}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="viewWarehouseReq('${m.id}')">
                        View
                      </button>
                    </td>
                  </tr>
                `).join('')
                : `<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:20px">No warehouse movements yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================
// OPENING BALANCE / CSV
// ============================================================

function openWarehouseOpeningBalanceModal() {
  document.getElementById('wh-ob-code').value = '';
  document.getElementById('wh-ob-description').value = '';
  document.getElementById('wh-ob-cartons').value = '';
  document.getElementById('wh-ob-notes').value = '';
  openModal('warehouse-opening-modal');
}

function openWarehouseCsvModal() {
  openModal('warehouse-csv-modal');
}

function parseWarehouseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

async function importWarehouseCsv() {
  const fileInput = document.getElementById('warehouse-csv-file');
  const file = fileInput?.files?.[0];

  if (!file) {
    toast('Please select a CSV file first', 'error');
    return;
  }

  try {
    const text = await file.text();
    const rows = parseWarehouseCsv(text);

    const validRows = rows
      .map(row => ({
        itemCode: String(row.item_code || row.code || row.sku || '').trim(),
        description: String(row.item_name || row.name || row.description || '').trim(),
        cartons: Number(row.cartons || row.quantity || row.stock || 0),
        reorderLevel: Number(row.reorder_level || 10),
        unitPrice: Number(row.unit_price || row.price || 0)
      }))
      .filter(row => row.description && row.cartons > 0);

    if (validRows.length === 0) {
      toast('No valid warehouse items found in CSV', 'error');
      return;
    }

    for (const item of validRows) {
      await window.LumodaSupabase.postWarehouseMovementDirect({
        type: 'opening_balance',
        description: item.description,
        cartons: item.cartons,
        notes: 'Warehouse CSV import',
        created_by_name: whCurrentUserName(),
        items: [{
          itemCode: whSafeCode(item.itemCode, item.description),
          description: item.description,
          cartons: item.cartons,
          unitPrice: item.unitPrice,
          reorderLevel: item.reorderLevel
        }]
      });
    }

    if (typeof addAudit === 'function') {
  addAudit(
    'Warehouse CSV Import',
    `${whCurrentUserName()} imported ${validRows.length} warehouse item(s)`
  );
}

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
  const codeRaw = document.getElementById('wh-ob-code').value.trim();
  const cartons = Number(document.getElementById('wh-ob-cartons').value || 0);
  const notes = document.getElementById('wh-ob-notes').value.trim();

  if (!description || cartons <= 0) {
    toast('Description and cartons are required', 'error');
    return;
  }

  const itemCode = whSafeCode(codeRaw, description);

  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type: 'opening_balance',
      description,
      cartons,
      notes,
      created_by_name: whCurrentUserName(),
      items: [{ itemCode, description, cartons }]
    });

    if (!result?.success) {
      toast(result?.error || 'Opening balance failed', 'error');
      return;
    }

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
// STOCK IN
// ============================================================

function openWarehouseStockInModal() {
  document.getElementById('wh-in-supplier').value = '';
  document.getElementById('wh-in-code').value = '';
  document.getElementById('wh-in-description').value = '';
  document.getElementById('wh-in-cartons').value = '';
  document.getElementById('wh-in-notes').value = '';

  const list = document.getElementById('warehouse-stockin-items');

  if (list) {
    list.innerHTML = getWarehouseBalancesLocal().map(item => `
      <option value="${escapeHtml(item.itemName)}">
        ${escapeHtml(item.itemName)} (${escapeHtml(item.itemCode)}) - Available: ${item.availableCartons}
      </option>
    `).join('');
  }

  openModal('warehouse-stockin-modal');
}

function selectWarehouseStockInItem(value) {
  const q = String(value || '').toLowerCase().trim();
  const item = getWarehouseBalancesLocal().find(x =>
    String(x.itemName || '').toLowerCase() === q ||
    String(x.itemCode || '').toLowerCase() === q
  );

  document.getElementById('wh-in-description').value = value;

  if (!item) return;

  document.getElementById('wh-in-description').value = item.itemName;
  document.getElementById('wh-in-code').value = item.itemCode;
}

async function saveWarehouseStockIn() {
  const supplier = document.getElementById('wh-in-supplier').value.trim();
  const description = document.getElementById('wh-in-description').value.trim();
  const codeRaw = document.getElementById('wh-in-code').value.trim();
  const cartons = Number(document.getElementById('wh-in-cartons').value || 0);
  const notes = document.getElementById('wh-in-notes').value.trim();

  if (!supplier || !description || cartons <= 0) {
    toast('Supplier, description, and cartons are required', 'error');
    return;
  }

  const itemCode = whSafeCode(codeRaw, description);

  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type: 'stock_in',
      supplier,
      description,
      cartons,
      notes,
      created_by_name: whCurrentUserName(),
      items: [{ itemCode, description, cartons }]
    });

    if (!result?.success) {
      toast(result?.error || 'Stock in failed', 'error');
      return;
    }
    if (typeof addAudit === 'function') {
  addAudit(
    'Warehouse Stock In',
    `${whCurrentUserName()} added ${cartons} carton(s) of ${description} from ${supplier}`
  );
}

    closeModal('warehouse-stockin-modal');
    toast('Stock In saved');
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
  const list = document.getElementById('warehouse-adjustment-items');

  document.getElementById('wh-adjust-item').value = '';
  document.getElementById('wh-adjust-type').value = 'add';
  document.getElementById('wh-adjust-cartons').value = '';
  document.getElementById('wh-adjust-reason').value = '';

  if (list) {
    list.innerHTML = getWarehouseBalancesLocal().map(item => `
      <option value="${escapeHtml(item.itemName)}">
        ${escapeHtml(item.itemName)} (${escapeHtml(item.itemCode)}) - Available: ${item.availableCartons}
      </option>
    `).join('');
  }

  openModal('warehouse-adjustment-modal');
}

async function saveWarehouseAdjustment() {
  const itemName = document.getElementById('wh-adjust-item').value.trim();
  const type = document.getElementById('wh-adjust-type').value;
  const cartons = Number(document.getElementById('wh-adjust-cartons').value || 0);
  const reason = document.getElementById('wh-adjust-reason').value.trim();

  if (!itemName || cartons <= 0 || !reason) {
    toast('Item, cartons, and reason are required', 'error');
    return;
  }

  const item = getWarehouseBalancesLocal().find(x =>
    String(x.itemName || '').toLowerCase() === itemName.toLowerCase()
  );

  if (!item) {
    toast('Select a valid warehouse item', 'error');
    return;
  }

  if (type === 'remove' && cartons > Number(item.availableCartons || 0)) {
    toast('Cannot remove more than available stock', 'error');
    return;
  }

  const movementType = type === 'add' ? 'stock_in' : 'stock_out';

  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type: movementType,
      description: `Adjustment: ${item.itemName}`,
      cartons,
      notes: reason,
      created_by_name: whCurrentUserName(),
      items: [{
        itemCode: item.itemCode,
        description: item.itemName,
        cartons
      }]
    });

    if (!result?.success) {
      toast(result?.error || 'Adjustment failed', 'error');
      return;
    }

    if (typeof addAudit === 'function') {
  addAudit(
    'Warehouse Adjustment',
    `${whCurrentUserName()} ${type === 'add' ? 'added' : 'removed'} ${cartons} carton(s) of ${item.itemName}. Reason: ${reason}`
  );
}

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
  warehouseRequisitionItems = [];
  document.getElementById('wh-out-issue-to').value = 'Alabar';
  document.getElementById('wh-out-storekeeper').value = whCurrentUserName();
  document.getElementById('wh-out-notes').value = '';
  addWarehouseRequisitionRow();
  openModal('warehouse-stockout-modal');
}

function addWarehouseRequisitionRow() {
  warehouseRequisitionItems.push({
    itemCode: '',
    description: '',
    cartons: 0
  });

  renderWarehouseRequisitionRows();
}

function removeWarehouseRequisitionRow(index) {
  warehouseRequisitionItems.splice(index, 1);
  renderWarehouseRequisitionRows();
}

function updateWarehouseReqItem(index, field, value) {
  if (!warehouseRequisitionItems[index]) return;

  if (field === 'cartons') {
    warehouseRequisitionItems[index][field] = Number(value || 0);
  } else {
    warehouseRequisitionItems[index][field] = value;
  }
}

function selectWarehouseItem(index, value) {
  if (!warehouseRequisitionItems[index]) return;

  const q = String(value || '').toLowerCase().trim();
  warehouseRequisitionItems[index].description = value;

  const item = getWarehouseBalancesLocal().find(x =>
    String(x.itemName || '').toLowerCase() === q ||
    String(x.itemCode || '').toLowerCase() === q
  );

  if (!item) return;

  warehouseRequisitionItems[index].itemCode = item.itemCode;
  warehouseRequisitionItems[index].description = item.itemName;

  renderWarehouseRequisitionRows();
}

function renderWarehouseRequisitionRows() {
  const body = document.getElementById('warehouse-requisition-items-body');
  if (!body) return;

  body.innerHTML = warehouseRequisitionItems.map((item, index) => `
    <tr>
      <td style="min-width:140px">
        <input
          class="form-input"
          style="min-width:120px"
          value="${escapeHtml(item.itemCode || '')}"
          oninput="updateWarehouseReqItem(${index}, 'itemCode', this.value)"
          placeholder="e.g. BL001">
      </td>

      <td style="min-width:320px">
        <input
          class="form-input"
          style="min-width:300px"
          list="warehouse-items-list-${index}"
          value="${escapeHtml(item.description || '')}"
          oninput="selectWarehouseItem(${index}, this.value)"
          placeholder="Search product name">

        <datalist id="warehouse-items-list-${index}">
          ${
            getWarehouseBalancesLocal().map(p => `
              <option value="${escapeHtml(p.itemName)}">
                ${escapeHtml(p.itemName)} (${escapeHtml(p.itemCode)}) - Available: ${p.availableCartons}
              </option>
            `).join('')
          }
        </datalist>
      </td>

      <td style="min-width:140px">
        <input
          class="form-input"
          style="min-width:120px"
          type="number"
          min="0"
          value="${item.cartons || ''}"
          oninput="updateWarehouseReqItem(${index}, 'cartons', this.value)"
          placeholder="Cartons supplied">
      </td>

      <td style="width:60px;text-align:center">
        <button
          class="remove-btn"
          onclick="removeWarehouseRequisitionRow(${index})">
          ×
        </button>
      </td>
    </tr>
  `).join('');
}

async function saveWarehouseStockOut() {
  const issueTo = document.getElementById('wh-out-issue-to').value;
  const storekeeper = document.getElementById('wh-out-storekeeper').value.trim();
  const notes = document.getElementById('wh-out-notes').value.trim();

  const validItems = warehouseRequisitionItems
    .map(item => ({
      itemCode: whSafeCode(item.itemCode, item.description),
      description: String(item.description || '').trim(),
      cartons: Number(item.cartons || 0)
    }))
    .filter(item => item.description && item.cartons > 0);

  if (!storekeeper || validItems.length === 0) {
    toast('Storekeeper and at least one item are required', 'error');
    return;
  }

  for (const reqItem of validItems) {
    const stockItem = getWarehouseBalancesLocal().find(x =>
      String(x.itemCode || '').toLowerCase() === String(reqItem.itemCode || '').toLowerCase()
    );

    if (!stockItem) {
      toast(`Item not found in warehouse: ${reqItem.description}`, 'error');
      return;
    }

    if (Number(reqItem.cartons || 0) > Number(stockItem.availableCartons || 0)) {
      toast(`Not enough stock for ${reqItem.description}`, 'error');
      return;
    }
  }

  const requisitionNo = 'REQ-' + Date.now();

  const totalCartons = validItems.reduce(
    (sum, item) => sum + Number(item.cartons || 0),
    0
  );

  try {
    const result = await window.LumodaSupabase.postWarehouseMovementDirect({
      type: 'stock_out',
      requisition_no: requisitionNo,
      issue_to: issueTo,
      storekeeper,
      description: `${validItems.length} item(s) issued to ${issueTo}`,
      cartons: totalCartons,
      notes,
      created_by_name: whCurrentUserName(),
      items: validItems
    });

    if (!result?.success) {
  toast(result?.error || 'Stock out failed', 'error');
  return;
}

    if (typeof addAudit === 'function') {
  addAudit(
    'Warehouse Stock Out',
    `${whCurrentUserName()} issued ${totalCartons} carton(s) to ${issueTo}`
  );
}
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

  if (!movement) {
    toast('Movement not found', 'error');
    return;
  }

  const body = document.getElementById('warehouse-view-body');
  if (!body) return;

  const isStockIn = movement.type === 'stock_in';
  const isOpening = movement.type === 'opening_balance';
  const isStockOut = movement.type === 'stock_out';

  const title = isStockIn
    ? 'Warehouse Stock In'
    : isOpening
      ? 'Warehouse Opening Balance'
      : 'Warehouse Requisition / Stock Out';

  body.innerHTML = `
    <div style="margin-bottom:18px">
      <h2 style="margin-bottom:8px">${title}</h2>

      ${movement.requisitionNo ? `<div><strong>Requisition No:</strong> ${escapeHtml(movement.requisitionNo)}</div>` : ''}

      ${isStockIn ? `<div><strong>Supplier:</strong> ${escapeHtml(movement.supplier || '—')}</div>` : ''}

      ${isStockOut ? `<div><strong>Issue To:</strong> ${escapeHtml(movement.issueTo || '—')}</div>` : ''}

      ${isStockOut ? `<div><strong>Storekeeper:</strong> ${escapeHtml(movement.storekeeper || '—')}</div>` : ''}

      <div><strong>Type:</strong> ${escapeHtml(formatWarehouseType(movement.type))}</div>
      <div><strong>Status:</strong> ${escapeHtml(movement.status || 'executed')}</div>
      <div><strong>By:</strong> ${escapeHtml(movement.createdByName || '—')}</div>
      <div><strong>Date:</strong> ${whDate(movement.createdAt)}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item Code</th>
          <th>Description</th>
          <th>Cartons</th>
        </tr>
      </thead>

      <tbody>
        ${
          (movement.items || []).map(item => `
            <tr>
              <td>${escapeHtml(item.itemCode || '')}</td>
              <td>${escapeHtml(item.description || '')}</td>
              <td>${Number(item.cartons || 0)}</td>
            </tr>
          `).join('')
        }
      </tbody>
    </table>

    <div style="margin-top:16px">
      <strong>Notes:</strong><br>
      ${escapeHtml(movement.notes || '—')}
    </div>
  `;

  openModal('warehouse-view-modal');
}

function printWarehouseReq() {
  const content = document.getElementById('warehouse-view-body');
  const printArea = document.getElementById('print-area');

  if (!content || !content.innerHTML.trim()) {
    toast('Nothing to print', 'error');
    return;
  }

  if (!printArea) {
    toast('Print area not found', 'error');
    return;
  }

  printArea.innerHTML = `
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#000;max-width:760px;margin:0 auto">
      <div style="background:#5C2D0A;color:white;padding:12px 16px;text-align:center">
        <div style="font-size:18px;font-weight:700;letter-spacing:1px">LUMODA ENTERPRISE</div>
        <div style="font-style:italic;font-size:11px;opacity:.85">The cook's helper</div>
        <div style="font-size:10px;opacity:.75">Warehouse Movement Record</div>
      </div>

      <div style="padding:14px;border:2px solid #5C2D0A;border-top:0">
        ${content.innerHTML}
      </div>
    </div>
  `;

  setTimeout(() => {
    window.print();
  }, 100);
}
// ============================================================
// PRODUCTS / SUPPLIERS BASIC SUPPORT
// ============================================================

async function saveWarehouseProduct(payload) {
  if (!window.LumodaSupabase?.saveWarehouseProduct) return null;
  return window.LumodaSupabase.saveWarehouseProduct(payload);
}

async function saveWarehouseSupplier(payload) {
  if (!window.LumodaSupabase?.saveWarehouseSupplier) return null;
  return window.LumodaSupabase.saveWarehouseSupplier(payload);
}

// ============================================================
// GLOBAL EXPORTS
// ============================================================

window.renderWarehouse = renderWarehouse;

window.openWarehouseOpeningBalanceModal = openWarehouseOpeningBalanceModal;
window.saveWarehouseOpeningBalance = saveWarehouseOpeningBalance;

window.openWarehouseStockInModal = openWarehouseStockInModal;
window.saveWarehouseStockIn = saveWarehouseStockIn;
window.selectWarehouseStockInItem = selectWarehouseStockInItem;

window.openWarehouseStockOutModal = openWarehouseStockOutModal;
window.saveWarehouseStockOut = saveWarehouseStockOut;

window.openWarehouseCsvModal = openWarehouseCsvModal;
window.importWarehouseCsv = importWarehouseCsv;

window.addWarehouseRequisitionRow = addWarehouseRequisitionRow;
window.removeWarehouseRequisitionRow = removeWarehouseRequisitionRow;
window.updateWarehouseReqItem = updateWarehouseReqItem;
window.selectWarehouseItem = selectWarehouseItem;

window.syncWarehouseCacheFromServer = syncWarehouseCacheFromServer;
window.viewWarehouseReq = viewWarehouseReq;
window.printWarehouseReq = printWarehouseReq;

window.openWarehouseAdjustmentModal = openWarehouseAdjustmentModal;
window.saveWarehouseAdjustment = saveWarehouseAdjustment;

window.updateWarehouseMovementFilter = updateWarehouseMovementFilter;