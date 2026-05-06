
-- Region enum
CREATE TYPE public.region AS ENUM ('MTR', 'FTR');

-- App role enum
CREATE TYPE public.app_role AS ENUM ('admin');

-- Customers table
CREATE TABLE public.customers (
  mdn TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region public.region NOT NULL,
  exchange_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read customers"
  ON public.customers FOR SELECT
  USING (true);

-- Payment proofs table
CREATE TABLE public.payment_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mdn TEXT NOT NULL REFERENCES public.customers(mdn) ON DELETE CASCADE,
  region public.region NOT NULL,
  exchange_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mdn)
);

CREATE INDEX idx_payment_proofs_region ON public.payment_proofs(region);
CREATE INDEX idx_payment_proofs_exchange ON public.payment_proofs(exchange_id);

ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users see their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Payment proofs policies
CREATE POLICY "Anyone can insert payment proofs"
  ON public.payment_proofs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update own MDN proof (upsert)"
  ON public.payment_proofs FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can read all payment proofs"
  ON public.payment_proofs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete payment proofs"
  ON public.payment_proofs FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
);

-- Storage policies
CREATE POLICY "Anyone can upload to payment-proofs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'payment-proofs');

CREATE POLICY "Anyone can update payment-proofs files (for re-upload)"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'payment-proofs')
  WITH CHECK (bucket_id = 'payment-proofs');

CREATE POLICY "Admins can read payment-proofs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "Admins can delete payment-proofs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin')
  );
