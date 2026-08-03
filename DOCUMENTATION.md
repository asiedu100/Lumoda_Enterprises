# Lumoda Enterprise — System Documentation

> Business system for **Lumoda Enterprise (Maa Lucy's Place)**, a wholesale & retail kitchenware
> business with two branches in Kumasi, Ghana (**Alabar** and **Morocco (K.O)**).

This document describes what the system is made of, how the pieces fit together, and where to
look when you need to change something. It complements (and links out to) the deeper, topic-specific
docs already in the repo — see [Related Documents](#related-documents).

---

## 1. Overview

The codebase contains **two separate web apps that share one Supabase backend**:

| App | Location | Audience | Purpose |
|---|---|---|---|
| **Storefront** | repo root (`index.html`, `site.js`, `site.css`) | Public / customers | Marketing site: product gallery, top sellers, contact & location info, WhatsApp ordering |
| **Staff App** | [app/](app/) (`index.html`, `js/*.js`, `warehouse.js`, `styles.css`) | Staff & admins | Installable PWA "Business Management Suite" — sales, invoicing, customers, inventory, warehouse, users, audit log |

Both are plain HTML/CSS/JavaScript (no build step, no framework, no bundler). The staff app talks
to **Supabase** (Postgres + Auth + Edge Functions) for authentication and, increasingly, for data —
see [§5 Data Model](#5-data--storage-model-important) for the current transition state.

Live site: `https://lumoda.netlify.app` (deployed via Netlify). "Powered by MRASYSTEMS" is shown in
the footer/login screen.

---

## 2. Repository Structure

```
.
├── index.html, site.js, site.css        Public storefront (single page)
├── images/                              Storefront gallery/product photos
├── app/                                 Staff PWA ("Business Management Suite")
│   ├── index.html                       All pages/screens (SPA, shown/hidden via .page.active)
│   ├── js/                              Core app, split by concern (plain <script> tags, no bundler):
│   │   ├── core.js                        Storage helpers, formatters, globals, navigate()/renderPage() dispatch
│   │   ├── auth.js                        Login, session/inactivity timeout, password change, role checks
│   │   ├── invoices.js                    Invoices, cash sales, sharing/printing, edit feature
│   │   ├── customers.js                   Customer CRUD
│   │   ├── products.js                    Product CRUD, stock adjustments, CSV import
│   │   ├── dashboard.js                   Dashboard rendering
│   │   ├── reports.js                     Reports page
│   │   ├── admin.js                       User management, audit log, approvals, sessions panel
│   │   └── bootstrap.js                   App init, session restore, service worker, global exports (loads last)
│   ├── warehouse.js                     Warehouse module: stock in/out, requisitions, balances
│   ├── supabase-client.js               Thin wrapper around the Supabase JS client (window.LumodaSupabase)
│   ├── supabase-config.js               Local Supabase URL + anon key (gitignored; see .example file)
│   ├── styles.css                       Staff app styles
│   ├── manifest.json                    PWA manifest (installable app metadata)
│   └── icons/                           PWA icons
├── supabase/
│   └── functions/create-staff-account/  Edge Function: creates Auth user + profile for new staff
├── supabase-schema.sql                  Core schema: profiles, products, customers, invoices, etc.
├── supabase-warehouse-schema.sql        Warehouse schema: products, suppliers, movements, requisitions
├── supabase-config.example.js           Template for app/supabase-config.js
├── SUPABASE_DEPLOYMENT_GUIDE.md         Security model + Supabase setup steps
├── SUPABASE_MIGRATION_STEPS.md          Step-by-step DB migration instructions
├── WAREHOUSE_V2_PLAN.md                 Design doc for a server-authoritative warehouse ledger (V2)
└── README.md                            One-line project summary
```

`.history/` is an editor auto-save folder (VS Code Local History extension), not part of the
shipped app — safe to ignore.

---

## 3. Public Storefront

A static single page ([index.html](index.html)) styled by [site.css](site.css) and animated/interactive
via [site.js](site.js). Sections: hero, "why choose us" values, category gallery with a lightbox
(Bowls, Cookware, Glassware, Knives, Tools, Appliances), a "Top Sellers" product grid, and a contact
section with click-to-call numbers, WhatsApp deep link, and embedded Google Maps for both branches.
A "Staff Login →" link in the header/footer sends staff to `/app/`.

There is no backend dependency here — it's informational/marketing only, safe to deploy as static
files to any host (currently Netlify).

---

## 4. Staff App ("Business Management Suite")

A single-page app served from [app/index.html](app/index.html). Pages are `<div class="page">`
elements toggled by `navigate(page)` in [app/js/core.js](app/js/core.js).

### 4.1 Authentication & Sessions
- Login accepts a **username or email**; if a username is given, [app/js/auth.js](app/js/auth.js)
  resolves it to the corresponding Supabase Auth email before calling `signInWithPassword`
  (`resolveSupabaseLoginEmail`).
- First-time / admin-reset accounts are routed through a **"set your permanent password"** screen
  (`must_change_password` flag on the `profiles` row).
- Sessions auto-expire after inactivity; a warning modal counts down before forced sign-out
  (`registerSession`, `resetInactivityTimer`, `showSessionWarning` in [app/js/auth.js](app/js/auth.js)).
- An "Active Sessions" panel on the dashboard shows who else is currently signed in (admin/manager view).
- The app is offline-aware — an "● Offline" badge appears when the network drops, since a PWA
  manifest ([app/manifest.json](app/manifest.json)) makes it installable on desktop/mobile.

### 4.2 Roles & Branches
Three roles exist in the schema (`public.user_role` / `profiles.role`):

- **admin** — full access, all branches (`location = 'All'`)
- **warehouse_manager** — warehouse module, all branches (`location = 'All'`)
- **staff** — scoped to a single branch: **Alabar** or **Morocco**

The UI adapts to role via `buildNavForRole()`, `isAdmin()`, `requireAdmin()`, and
`canEditInvoice()` / `requireInvoiceEdit()` in [app/js/auth.js](app/js/auth.js) — e.g. staff cannot edit product
prices, manage users, or delete invoices (enforced both in the UI and, per the security guide, at the
database layer with Row Level Security).

A location switcher (`switchLocFilter`) lets admins/managers filter every list (invoices, cash sales,
customers, products, stock history) by **All / Alabar / Morocco**.

### 4.3 Modules / Pages

| Section | Pages | What it does |
|---|---|---|
| Overview | Dashboard, Reports | Today/week sales totals, cash vs. MoMo split, pending amounts, recent invoices, low-stock alerts, 7-day sales chart |
| Sales | Cash Sales, Invoices, Customers | Create cash sales or customer invoices (retail / wholesale / carton pricing), track payment status (paid / pending / partial), manage a customer directory |
| Inventory | Products, Warehouse, Stock History | Product catalog with per-branch stock counts and reorder levels; warehouse stock-in / stock-out / adjustments / requisitions; a chronological stock movement log |
| Admin | User Management, Audit Log, Approvals | Create/manage staff accounts, review a log of sensitive actions, approve pending requests (e.g. warehouse requisitions) |

The **Warehouse** module ([app/warehouse.js](app/warehouse.js)) is its own subsystem: it tracks
carton-level stock for warehouse items separately from branch retail stock, with suppliers,
stock-in/out movements, opening balances, low-stock views, CSV import, and printable requisition
slips.

### 4.4 UI conventions worth knowing
- Currency is formatted as `GH₵` via `fmtGHS()`.
- Invoice numbers are zero-padded sequential strings generated server-side
  (`generate_invoice_number()`, starting at `000000` from sequence value `2388`).
- All list views support inline search/filter (`filterInvoices`, `filterCashSales`,
  `filterCustomers`, etc.) rather than server-side pagination.

---

## 5. Data & Storage Model (important)

The app is **mid-migration** from a local-first design to a Supabase-authoritative one — this shows
up in the code and is worth understanding before making changes:

- **Today**: most business data (users, invoices, customers, products, stock history) is read/written
  through `localStorage` helpers in [app/js/core.js](app/js/core.js) (`getUsers`, `getInvoices`, `getProducts`, …).
  Supabase is synced in one direction as a cache (`syncSupabaseCache()`), and login/session state is
  the main thing backed directly by Supabase Auth.
- **Target** (documented in [SUPABASE_DEPLOYMENT_GUIDE.md](SUPABASE_DEPLOYMENT_GUIDE.md)): Supabase
  becomes the single source of truth — invoices go through the `create_invoice` RPC (validates stock,
  recalculates totals, deducts inventory, writes stock history + audit log), deletions go through
  `soft_delete_invoice`, and product imports go through `import_products`. `localStorage` is dropped
  entirely for business data.
- The **warehouse** module has its own analogous V1 → V2 plan in
  [WAREHOUSE_V2_PLAN.md](WAREHOUSE_V2_PLAN.md): moving from local-first stock tracking to a
  server-authoritative ledger (`warehouse_stock_balance`, `warehouse_stock_journal`, an approval
  workflow, and an atomic `post_warehouse_movement` RPC).

**Practical implication:** when fixing bugs or adding features, check whether the relevant data still
lives in `localStorage` or has already been migrated to Supabase — the two guides above are the
source of truth for what's "done" vs. "planned."

---

## 6. Backend (Supabase)

### 6.1 Core schema — [supabase-schema.sql](supabase-schema.sql)

| Table | Purpose |
|---|---|
| `profiles` | Staff/admin identity: username, role (`admin` / `warehouse_manager` / `staff`), branch (`Alabar` / `Morocco` / `All`), active flag, forced password-change flag |
| `products` | Catalog: SKU, category, retail/wholesale/carton prices, per-branch stock (`stock_alabar`, `stock_morocco`), reorder level |
| `customers` | Customer directory per branch |
| `invoices` | Sales header: number, customer, branch, total, status (`paid`/`pending`/`partial`), payment method, soft-delete flag |
| `invoice_items` | Line items per invoice, with sale type (retail/wholesale/carton) and a generated `total` column |
| `stock_history` | Audit trail of stock changes tied to sales/adjustments |
| `audit_logs` | General action log (via `log_audit()`) |

Key database functions: `generate_invoice_number`, `create_invoice` / `create_invoice_no_stock`,
`soft_delete_invoice` / `soft_delete_invoice_no_stock`, `import_products`, `generate_product_sku`,
`is_admin`, `can_access_location`, `current_profile_role/location`, `complete_password_change`,
`touch_updated_at` (updated_at trigger helper), `log_audit`. 23 Row Level Security policies enforce
the branch/role rules described in §4.2 at the database layer.

### 6.2 Warehouse schema — [supabase-warehouse-schema.sql](supabase-warehouse-schema.sql)

`warehouse_products`, `warehouse_suppliers`, `warehouse_movements`, `warehouse_requisitions`,
`warehouse_requisition_items` — carton-level inventory kept separate from the retail `products` table.
See [WAREHOUSE_V2_PLAN.md](WAREHOUSE_V2_PLAN.md) for the planned additions
(`warehouse_stock_balance`, `warehouse_stock_journal`, a `status` column on movements for an
approval workflow).

### 6.3 Edge Functions

- [supabase/functions/create-staff-account](supabase/functions/create-staff-account/index.js) — runs
  server-side with the `service_role` key to create a new Supabase Auth user **and** its matching
  `profiles` row in one step, so the `service_role` key never has to touch the browser.

### 6.4 Security model

Documented in full in [SUPABASE_DEPLOYMENT_GUIDE.md](SUPABASE_DEPLOYMENT_GUIDE.md); the key rules:

- Row Level Security is enabled on every table; the anon key is safe in the browser *because* of RLS.
- Staff can only see/act on rows for their own branch; admins see everything.
- Staff cannot edit products/prices, manage users, or delete invoices.
- Business-critical writes (invoice creation/deletion, product import, user creation) go through
  database functions or the Edge Function rather than raw table inserts, so validation and audit
  logging can't be bypassed from the client.

---

## 7. Configuration

The staff app reads its Supabase connection details from `app/supabase-config.js`, which is
**gitignored** and must be created locally/per-deployment from the template:

```js
// app/supabase-config.js
window.LUMODA_SUPABASE = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_KEY'
};
```

Only the **anon** key belongs here — never the `service_role` key (that one is used only inside the
`create-staff-account` Edge Function, server-side).

---

## 8. Local Development

No build tooling is required — this is static HTML/CSS/JS.

1. Serve the repo root with any static file server (e.g. `npx serve .` or the VS Code "Live Server"
   extension) so relative paths and the `/app/` route resolve correctly.
2. Copy `supabase-config.example.js` to `app/supabase-config.js` and fill in your project's URL and
   anon key (see [SUPABASE_DEPLOYMENT_GUIDE.md](SUPABASE_DEPLOYMENT_GUIDE.md) for full setup,
   including creating the first admin user).
3. Open `/` for the storefront, `/app/` for the staff login.

## 9. Deployment

The site is deployed to Netlify (`lumoda.netlify.app`) as static files. Per the deployment checklist
in [SUPABASE_DEPLOYMENT_GUIDE.md](SUPABASE_DEPLOYMENT_GUIDE.md): deploy `index.html` at the site
root, ensure `app/supabase-config.js` is present with only the anon key, serve over HTTPS, and verify
RLS blocks unauthenticated access before going live.

---

## 10. Related Documents

- [SUPABASE_DEPLOYMENT_GUIDE.md](SUPABASE_DEPLOYMENT_GUIDE.md) — security model, setup steps, and the
  localStorage → Supabase migration plan for the core app.
- [SUPABASE_MIGRATION_STEPS.md](SUPABASE_MIGRATION_STEPS.md) — step-by-step database migration
  instructions.
- [WAREHOUSE_V2_PLAN.md](WAREHOUSE_V2_PLAN.md) — design for moving the warehouse module to a
  server-authoritative stock ledger with an approval workflow.

## 11. Known Gaps / Roadmap

- Core business data (invoices, products, customers) is still primarily `localStorage`-backed on the
  client; the Supabase-authoritative RPC flow described in §5 is defined in SQL but not yet fully wired
  up end-to-end across `app/js/*.js`.
- The warehouse module is on "V1" (local-first, one-way sync); "V2" (server-authoritative, with
  approvals and a full audit journal) is designed but not yet implemented — see
  [WAREHOUSE_V2_PLAN.md](WAREHOUSE_V2_PLAN.md).
- No automated tests or CI configuration exist in the repo at this time.
