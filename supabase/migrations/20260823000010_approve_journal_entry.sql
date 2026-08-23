-- Migration: 20260823000010_approve_journal_entry.sql
-- Slice 3 (rebuild): server-side DRAFT -> POSTED approval for journal entries.
--
-- Why: post_journal_entry intentionally creates DRAFT rows; no RPC existed to
-- approve/post them. Per Master Rebuild Spec section 51 we build the real
-- capability rather than faking the UI, and section 35 requires server-side
-- authorization, scope checks, transactional writes and audit.
--
-- Contract notes:
-- - Mirrors close_fiscal_period's authorization ladder:
--     require_admin_aal2 -> role/permission check -> row lock -> agency scope.
-- - Idempotent on replay: approving an already-POSTED entry returns success
--   without mutating (section 34). VOID entries reject with P0002.
-- - Period integrity: the entry's fiscal period must still be OPEN; the
--   resolved fiscal_period_id is stamped onto the entry when missing.
-- - Balance enforcement stays in the existing constraint trigger
--   (ensure_journal_balance / protect_posted_journals); this function never
--   bypasses them because it performs a plain UPDATE that fires them.
-- - Audited to public.audit_logs with actor, role, scope, correlation id and
--   structured details (section 64 POST taxonomy).

-- Approval timestamp column (did not exist before this migration).
ALTER TABLE public.journal_entries
ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.approve_journal_entry(
    p_journal_id UUID,
    p_correlation_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body
DECLARE
    v_agency UUID;
    v_branch UUID;
    v_entry public.journal_entries%ROWTYPE;
    v_period_id UUID;
BEGIN
    -- AAL2 gate for admins (same as close_fiscal_period).
    PERFORM public.require_admin_aal2();

    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Authorization: admins OR explicitly granted approvers.
    IF public.staff_role() <> 'ADMIN' AND NOT public.has_permission('journal_entries', 'approve') THEN
        RAISE EXCEPTION 'Not authorized to approve journal entries' USING ERRCODE = '42501';
    END IF;

    -- Lock the row; verify agency scope server-side (section 35).
    SELECT * INTO v_entry
    FROM public.journal_entries
    WHERE id = p_journal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found', p_journal_id USING ERRCODE = 'P0002';
    END IF;

    IF v_entry.agency_id <> v_agency THEN
        RAISE EXCEPTION 'Journal entry outside caller agency scope' USING ERRCODE = '42501';
    END IF;

    -- Idempotent replay: already approved.
    IF v_entry.status = 'POSTED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'journal_entry_id', v_entry.id,
            'status', 'POSTED',
            'posted_at', COALESCE(v_entry.posted_at, NOW()),
            'idempotent_replay', true
        );
    END IF;

    IF v_entry.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only DRAFT entries can be approved (current status: %)', v_entry.status USING ERRCODE = 'P0002';
    END IF;

    -- Fiscal period must be open at approval time, not just creation time.
    v_period_id := public.assert_open_fiscal_period(v_agency, v_entry.entry_date);

    UPDATE public.journal_entries
    SET status = 'POSTED',
        fiscal_period_id = COALESCE(fiscal_period_id, v_period_id),
        posted_at = NOW()
    WHERE id = v_entry.id;

    v_branch := public.staff_branch_id();

    INSERT INTO public.audit_logs (
        action, resource, resource_id, user_email,
        details, actor_id, actor_role, agency_id, branch_id, correlation_id
    ) VALUES (
        'POST',
        'journal_entries',
        v_entry.id::TEXT,
        COALESCE(auth.email(), NULL),
        jsonb_build_object(
            'reference', v_entry.reference,
            'entry_date', v_entry.entry_date,
            'reason', p_reason,
            'fiscal_period_id', v_period_id
        ),
        auth.uid(),
        public.staff_role(),
        v_agency,
        v_branch,
        p_correlation_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'journal_entry_id', v_entry.id,
        'status', 'POSTED',
        'posted_at', NOW(),
        'fiscal_period_id', v_period_id
    );
END;
$body;

REVOKE ALL ON FUNCTION public.approve_journal_entry(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_journal_entry(UUID, UUID, TEXT) TO authenticated;
