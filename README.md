# ELC Payment Proof Upload Portal

A regional proof-of-payment collection portal for PTCL ELC operations. Customers / sales agents upload payment screenshots against an MDN, and admins review, filter, and export proofs region-wise as a single date-organized ZIP with an Excel summary.

Live URL: https://elcupload.lovable.app

---

## 1. Tech Stack

| Layer | Tech |
|---|---|
| Framework | **TanStack Start v1** (React 19 + Vite 7, SSR on Cloudflare Workers) |
| Routing | TanStack Router (file-based, `src/routes/`) |
| Styling | Tailwind CSS v4 + shadcn/ui + semantic design tokens (`src/styles.css`) |
| Backend | **Lovable Cloud** (managed Supabase: Postgres + Auth + Storage) |
| Server logic | `createServerFn` (typed RPC) — no edge functions |
| Validation | Zod |
| Export | `jszip` + `exceljs` + `html-to-image` |

---

## 2. Features

### Public side (`/`)
- Lookup customer by **MDN**
- Shows Name, Region, Exchange ID, Executive Sales, Due Amount, Discount
- Upload proof screenshot (image/PDF)
- **Duplicate guard:** if proof already exists for MDN, shows  
  `Proof already uploaded on [date]` and blocks re-upload

### Admin side (`/admin`)
- Email/password login
- **Overview tab:**
  - KPIs: Total Proofs, Active Executives, Total Customers
  - Filters: date range, region (locked to assigned region for region-admins)
  - Sortable Executive Sales table → **Region · Executive · Count of Proof**
  - **Download Screenshot** of the performance table (PNG)
- **Proofs tab:** searchable list with previews, delete, download single
- **Customers tab:** CSV import (with row-level validation, dup detection)
- **Bulk ZIP export:**
  - Structure: `DD MMM / Region / MDN.ext`
  - Includes `_summary.xlsx` (all customers + proof status)
- **Users tab (super_admin only):**
  - Create / delete admin users
  - Assign region (`MTR`, `FTR`, `SLTR`, `CTR`, `GTR`, `LTR`, or `ALL`)

### Regions supported
`MTR · FTR · SLTR · CTR · GTR · LTR`

---

## 3. Data Model

### `customers`
| Column | Type | Notes |
|---|---|---|
| mdn | text PK | |
| name | text | |
| region | enum `region` | |
| exchange_id | text | |
| executive_sales | text | nullable |
| due_amount | numeric | default 0 |
| discount | numeric | default 0 |
| created_at | timestamptz | |

### `payment_proofs`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| mdn | text FK → customers.mdn (unique) | one proof per MDN |
| region | enum `region` | |
| exchange_id | text | |
| executive_sales | text | |
| storage_path | text | path in `payment-proofs` bucket |
| mime_type, size_bytes | | |
| amount_paid | numeric nullable | |
| uploaded_at | timestamptz | |

### `user_roles`
| Column | Type | Notes |
|---|---|---|
| user_id | uuid | references auth.users |
| role | enum `app_role` (`admin` / `super_admin`) | |
| region | enum `region` nullable | null = ALL regions |

### Enums
- `region`: `MTR | FTR | SLTR | CTR | GTR | LTR`
- `app_role`: `admin | super_admin`

### Security definer functions
- `has_role(user_id, role) → bool`
- `is_super_admin(user_id) → bool`
- `get_admin_region(user_id) → region`

### Storage
- Bucket **`payment-proofs`** (private). All access through server functions using service role.

---

## 4. Architecture

```
src/
├── routes/
│   ├── __root.tsx        ← shell
│   ├── index.tsx         ← public proof upload
│   └── admin.tsx         ← admin dashboard (tabs)
├── lib/
│   ├── proofs.functions.ts   ← createServerFn RPCs (client-callable)
│   ├── proofs.server.ts      ← supabaseAdmin + requireAdmin/SuperAdmin
│   ├── users.functions.ts    ← user management RPCs
│   └── proof-utils.ts        ← REGIONS list, helpers
├── integrations/supabase/
│   ├── client.ts             ← browser (anon)
│   ├── client.server.ts      ← service-role (server only)
│   ├── auth-middleware.ts    ← requireSupabaseAuth
│   └── types.ts              ← generated
└── styles.css                ← design tokens (oklch)
```

**Server boundary rule:** anything importing `client.server` lives in `*.server.ts`. Only `*.functions.ts` are imported from components — they call admin code through the RPC bridge.

---

## 5. Auth & Roles

- Email/password auth via Lovable Cloud.
- No public signup — only super_admin can create users (Users tab).
- Region admin: scoped to one region (filters auto-locked).
- Super admin: full access, can manage users.

**Current super admin**

| Email | Password |
|---|---|
| `muhammad.yasir7@ptclgroup.com` | `Yasir@123` |

> Change the password after first login via Admin → (your account).

---

## 6. CSV Import Format (Customers tab)

Required header row:
```
mdn,name,region,exchange_id,executive_sales,due_amount,discount
```
- `region` must be one of `MTR / FTR / SLTR / CTR / GTR / LTR`
- `mdn` is the unique key — re-import updates existing rows.

---

## 7. Bulk ZIP Export

`Admin → Download ZIP`:

```
07 May/
  MTR/
    03001234567.jpg
    03007654321.png
  FTR/
    ...
08 May/
  ...
_summary.xlsx        ← every customer + proof status (Submitted/Pending)
```

Honors region + date filters. Region admins only see their region's folder.

---

## 8. Local Development

This project is Lovable-managed. Local dev is optional:

```bash
bun install
bun run dev
```

The dev server is auto-managed in Lovable; do not run builds manually.

### Environment variables (auto-provisioned by Lovable Cloud)

| Var | Where |
|---|---|
| `VITE_SUPABASE_URL` | client + server |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client + server |
| `SUPABASE_URL` | server |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** (admin ops) |
| `LOVABLE_API_KEY` | reserved (AI gateway) |

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser. It is only imported inside `*.server.ts`.

---

## 9. Operational Notes

- **Re-uploading after a server outage:** `uploaded_at` is server-now, so re-uploads land in today's folder of the ZIP. Use the Customers/Proofs filter by date for reporting.
- **Deleting a proof:** Admin → Proofs → Delete. The storage object and DB row are both removed; the customer can then re-upload.
- **Region enum changes:** require a migration + update to `proof-utils.ts` REGIONS array + all Zod schemas + admin Select dropdowns.

---

## 10. Common Tasks

| Task | Where |
|---|---|
| Add a new region | DB migration on `region` enum + `proof-utils.ts` + Zod schemas in `*.functions.ts` + admin selects |
| Add a new admin | Super admin → Users tab → Create User |
| Reset a user's password | Currently manual (delete + recreate from Users tab) |
| Export today's proofs only | Overview → date filter → Download ZIP |

---

## 11. Project IDs

- Lovable Project ID: `45993b36-27d9-4cfb-afdf-97bdf5feecaf`
- Backend (Lovable Cloud) provisioned automatically.

---

## License

Internal PTCL Group use.
