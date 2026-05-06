
DROP POLICY "Anyone can insert payment proofs" ON public.payment_proofs;
DROP POLICY "Anyone can update own MDN proof (upsert)" ON public.payment_proofs;
DROP POLICY "Anyone can upload to payment-proofs" ON storage.objects;
DROP POLICY "Anyone can update payment-proofs files (for re-upload)" ON storage.objects;

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon, authenticated;
