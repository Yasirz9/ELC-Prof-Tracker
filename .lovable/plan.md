## Plan: Multi-feature Admin Upgrade

### 1. ZIP + Excel Attachment
- In `getBulkZip` server fn, also generate an Excel (`.xlsx`) summary using `exceljs` (or `xlsx` lib).
- Excel will include ALL customers from `customers` table joined with `payment_proofs`:
  - Columns: MDN, Name, Region, Exchange ID, Executive Sales, Due Amount, Discount, Proof Status (Submitted/Pending), Amount Paid, Uploaded At, Storage Path.
- Embed as `_summary.xlsx` inside the ZIP.

### 2. Date-wise ZIP Structure
- Restructure paths inside ZIP to: `{DD MMM}/{Region}/{filename}` (e.g. `07 May/MTR/0300xxxxxxx.jpg`).
- Drop exchange-level folder.
- Only regions with data appear (natural — only matched rows produce folders).

### 3. User Management (Super Admin)
- Add `super_admin` to `app_role` enum + region column on `user_roles` (nullable; null = all regions for super_admin).
- Migration: `region` column on `user_roles`, helper functions `is_super_admin(uuid)`, `get_user_region(uuid)`.
- Designate `muhammad.yasir7` as super_admin.
- Admin tab "Users":
  - Super admin sees user list + create form (email, password, region MTR/FTR/All, role admin).
  - Server fns: `listUsers`, `createUser`, `deleteUser`, `updateUserRegion` — all guarded with `requireSuperAdmin`.
- Region scoping: every admin server fn (`listProofs`, `getExecutiveStats`, `getBulkZip`, `importCustomers`) reads caller's region; if non-null, force-filter to that region and reject mismatched filters.

### 4. CSV Upload Hardening
- Client-side: detect missing required columns (mdn, name, region, exchange_id), show row-level errors, show duplicate MDN warnings (within file), preview count, success/error toast with counts.
- Server-side `importCustomers`: return `{ inserted, updated, skipped, errors[] }` instead of just count; validate region enum; trim whitespace; reject empty/invalid rows with row index in error message.

### 5. Overview UI Redesign
- Replace card grid with a sortable table:
  - Columns: Executive Sales, Region, Proof Count, Total Amount (PKR), Avg Amount.
  - Sticky header, zebra rows, hover, sort indicators.
- Add Region filter (All / MTR / FTR) alongside existing date range.
- Top KPI strip kept (Total Proofs, Total Amount, Active Executives) but cleaner.
- For non-super-admin users with assigned region, region filter is locked to their region.

### Technical Notes
- Use `exceljs` (Worker-compatible, pure JS).
- Migration file for `super_admin` role + `region` on `user_roles`.
- Update `requireAdmin` → returns `{ userId, role, region }`; new `requireSuperAdmin`.
- Update `src/integrations/supabase/types.ts` will regenerate after migration (auto).
- New file: `src/server/users.functions.ts` for user mgmt fns.

### Out of scope (confirm if needed)
- Login UI changes — current admin login already works; no separate "regional user" login flow beyond the same auth.
