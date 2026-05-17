# LUMODA Supabase Security And Deployment Guide

This app can use Supabase, but the secure version must treat Supabase as the backend. The browser should never contain admin secrets, password hashes, or service-role keys.

## What Supabase Will Handle

- Auth: staff/admin login with email and password.
- The frontend accepts a username or email, then resolves the Supabase email before sign-in.
- Database: products, customers, invoices, invoice items, stock history, audit logs.
- Authorization: Row Level Security policies in Postgres.
- Admin-only actions: protected by RLS or a Supabase Edge Function.

## Files Added

- `supabase-schema.sql`: database tables, indexes, RLS policies, and starter products.
- `supabase-config.example.js`: browser config template for the project URL and anon key.
- `supabase/functions/create-staff-account/index.ts`: secure staff-account creation endpoint.

## Setup Steps

1. Create/open your Supabase project: `xpctbysjglslrfjlilur`.
2. In Supabase Dashboard, go to `SQL Editor`.
3. Run all of `supabase-schema.sql`.
4. Go to `Authentication > Users`.
5. Create your first admin user.
6. Copy that user's UUID.
7. Run this SQL, replacing the values:

```sql
insert into public.profiles (id, username, full_name, role, location, active)
values (
  'PASTE_AUTH_USER_UUID_HERE',
  'admin',
  'System Administrator',
  'admin',
  'All',
  true
);
```

8. Add the admin email to the `profiles` row so username-to-email login lookup works for the first admin account too.
9. Confirm `supabase-config.js` contains:

```js
window.LUMODA_SUPABASE = {
  url: 'https://xpctbysjglslrfjlilur.supabase.co',
  anonKey: 'sb_publishable_B5YJOitQCz9rWA2bmFZE3w_jAoDlFdu'
};
```

The anon key is okay in frontend code only because RLS is enabled. Never paste the `service_role` key into this project.

## Security Rules To Keep

- Keep RLS enabled on every table.
- Staff can only see rows for their own branch.
- Admin can see all branches.
- Staff cannot edit products or prices.
- Staff cannot manage users.
- Staff cannot delete invoices.
- Invoice totals are recalculated by the `create_invoice` database function.
- Invoice creation should go through `create_invoice`, not direct table inserts.
- Product CSV import should go through `import_products`; it generates SKUs such as `LMD-15L-WATER-JUG-6027`.
- User creation should happen through the Supabase Edge Function in `supabase/functions/create-staff-account/index.ts` using the service-role key on the server side.

## Frontend Migration Plan

The current `app.js` is still localStorage-based. Convert it in stages:

1. Replace custom login with `supabase.auth.signInWithPassword`.
2. Replace `getUsers()` with reads from `profiles`.
3. Replace products/customers/invoices/local stock arrays with Supabase table queries.
4. Replace `createInvoice()` with the `create_invoice` database RPC:
   - validates the user and branch
   - verifies stock
   - uses the database product price
   - recalculates totals
   - inserts invoice and items
   - deducts stock
   - writes stock history and audit log
5. Replace invoice deletion with the `soft_delete_invoice` database RPC.
6. Replace product CSV import with the `import_products` database RPC.
7. Replace admin user creation with the Edge Function that creates both the Auth user and the `profiles` row.
8. Remove the hardcoded default admin password and custom password hashing from `app.js`.
9. Stop storing business data in `localStorage`.

## Deployment Checklist

- Deploy `index.html` at the site root.
- Remove any stray zip archive or duplicate HTML files from the public deploy folder.
- Add missing PWA icon files or remove them from `manifest.json`.
- Deploy over HTTPS.
- Add `supabase-config.js` with only anon key, never service-role key.
- Confirm RLS blocks unauthenticated access.
- Test staff account access for Alabar and Morocco separately.
- Test admin account access to all branches.
- Test stock cannot go negative.
- Test malicious text like `<img src=x onerror=alert(1)>` does not execute.

## Official References

- Supabase JavaScript install/CDN: https://supabase.com/docs/reference/javascript/installing
- Supabase email/password sign-in: https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
