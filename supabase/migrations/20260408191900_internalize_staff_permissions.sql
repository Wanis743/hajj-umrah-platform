ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_permissions FROM anon, authenticated;
DROP POLICY IF EXISTS staff_permissions_admin_read ON public.staff_permissions;
DROP POLICY IF EXISTS staff_permissions_admin_write ON public.staff_permissions;
