ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS due_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.payment_proofs
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2);