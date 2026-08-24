-- 20260824090200_audit_financial_action_definer.sql (V12 §19 slice support)
--
-- audit_financial_action ran as SECURITY INVOKER, so invoice inserts via PostgREST
-- failed when the trigger wrote to audit_logs under RLS as the invoking role
-- (masked as 42703 by the plpgsql error path). The function only writes audit rows
-- stamped with server-derived scope; making it SECURITY DEFINER with a locked
-- search_path is the correct house pattern (matches close_fiscal_period).

CREATE OR REPLACE FUNCTION public.audit_financial_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
    INSERT INTO public.audit_logs (
        action, resource, resource_id, details,
        actor_id, actor_role, agency_id, branch_id
    ) VALUES (
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id::text, OLD.id::text),
        jsonb_build_object('source','controls_treasury_risk',
            'old', CASE WHEN TG_OP IN ('DELETE','UPDATE') THEN to_jsonb(OLD) END,
            'new', CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END),
        auth.uid(),
        public.staff_role(),
        public.current_staff_agency_id(),
        public.staff_branch_id()
    );
    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
    RETURN COALESCE(NEW, OLD);
END;
$fn$;
