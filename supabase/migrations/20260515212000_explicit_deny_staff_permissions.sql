DROP POLICY IF EXISTS staff_permissions_client_deny ON public.staff_permissions;
CREATE POLICY staff_permissions_client_deny
ON public.staff_permissions
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
