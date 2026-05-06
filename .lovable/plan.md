# Payment Proof System

Adapting the Next.js + Supabase design from your README to this TanStack Start + Lovable Cloud project.

## What gets built

### User-facing upload page (`/`)
- Form: enter MDN → fetches customer record (region, exchange ID, name) → shows confirmation → upload file
- Validates file: jpeg / png / pdf, max 5 MB
- File stored at `<region>/<exchange_id>/<mdn>.<ext>` (original filename discarded)
- Upserts a `payment_proofs` row

### Admin dashboard (`/admin`, protected)
- Login via Lovable Cloud auth (email/password)
- Table of all proofs with filters (region, exchange ID, search by MDN)
- Per-file download (signed URL) + bulk ZIP download by scope (all / region / exchange)
- Admin role enforced via `user_roles` table (separate from profiles, with `has_role` security-definer function)

### Backend (Lovable Cloud)
- **Tables**
  - `customers` — `mdn` (pk), `name`, `region` (enum: MTR/FTR), `exchange_id`
  - `payment_proofs` — `id`, `mdn` (fk), `region`, `exchange_id`, `storage_path`, `mime_type`, `size_bytes`, `uploaded_at`
  - `user_roles` — `user_id`, `role` (admin)
- **RLS**
  - `customers`: public read (for MDN lookup on the upload page)
  - `payment_proofs`: insert allowed for anyone (public upload), select/delete only for admins via `has_role`
  - `user_roles`: select own row only
- **Storage bucket** `payment-proofs` (private)
- **Server functions** (`createServerFn`)
  - `getCustomerByMdn(mdn)` — public
  - `uploadProof({ mdn, file })` — public, validates + stores + upserts
  - `listProofs(filters)` — admin only
  - `getSignedUrl(path)` — admin only
  - `getBulkZip(scope)` — admin only, streams a ZIP of signed file contents

## Tech notes (technical)

- Use `createServerFn` (not Edge Functions) for all backend logic, per TanStack pattern.
- `requireSupabaseAuth` middleware on admin functions; check `has_role(uid, 'admin')` server-side.
- ZIP generation via `fflate` (pure JS, Worker-compatible — `archiver`/`yazl` won't work in Cloudflare Workers).
- Public upload uses the anon client; admin reads use the authenticated client. No service-role from client paths.
- Region as Postgres enum (`MTR`, `FTR`) matching the README.
- File naming + path builder kept identical to the README spec.

## Out of scope (for v1)
- Admin user signup UI — first admin is granted via SQL after signup (I'll show you how).
- Email notifications, audit log, multi-file uploads per MDN.

## Seed data
I'll add a couple of sample customers so you can test the upload flow immediately.

---

Ready to build. Confirm and I'll enable Lovable Cloud and ship it.
