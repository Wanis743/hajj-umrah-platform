GRANT EXECUTE ON FUNCTION public.has_permission(text,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_permission(text,text) FROM anon;
