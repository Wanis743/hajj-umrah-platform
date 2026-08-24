-- 20260824090000_grant_audit_logs_insert.sql (V12 §19 slice support)
-- The invoice audit trigger writes to audit_logs on behalf of authenticated staff;
-- without INSERT the whole invoice creation path fails with 42501.

GRANT INSERT ON TABLE public.audit_logs TO authenticated;
