ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS executive_sales text;
ALTER TABLE public.payment_proofs ADD COLUMN IF NOT EXISTS executive_sales text;
CREATE INDEX IF NOT EXISTS idx_payment_proofs_exec_sales ON public.payment_proofs(executive_sales);
CREATE INDEX IF NOT EXISTS idx_customers_exec_sales ON public.customers(executive_sales);