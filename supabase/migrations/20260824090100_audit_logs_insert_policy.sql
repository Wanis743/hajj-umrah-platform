-- 20260824090100_audit_logs_insert_policy.sql (V12 §19 slice support)
-- audit_logs had only a SELECT policy; audit-writing triggers failed RLS on INSERT.
-- Allow authenticated staff to insert rows stamped in their own scope; admin reads all
-- in-scope rows via the existing select policy.

CREATE POLICY audit_insert_authenticated ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    agency_id = private.current_staff_agency_id()
    OR (agency_id IS NULL AND branch_id IS NULL)
  );
