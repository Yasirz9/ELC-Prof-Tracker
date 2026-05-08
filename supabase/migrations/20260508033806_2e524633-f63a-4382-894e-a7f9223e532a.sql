
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS region public.region NULL;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.get_admin_region(_user_id uuid)
RETURNS public.region LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT region FROM public.user_roles
  WHERE user_id = _user_id AND role IN ('admin','super_admin')
  ORDER BY (role = 'super_admin') DESC
  LIMIT 1
$$;

-- Promote yasir to super_admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::public.app_role FROM auth.users
WHERE email = 'muhammad.yasir7@admin.local'
ON CONFLICT DO NOTHING;
