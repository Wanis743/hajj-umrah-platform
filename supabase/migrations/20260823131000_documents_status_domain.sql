-- 20260823131000_documents_status_domain.sql (rebuild-authored, slice 5 — DMS reconciliation)
--
-- Reconciles the two competing status vocabularies on public.documents:
--   live CHECK constraint: REQUIRED/RECEIVED/VALIDATED/REJECTED/EXPIRED
--     (matches the mounted DocumentCenter UI: DOC_STATI)
--   verify_document_command (business_command_authority): sets status='VERIFIED' →
--     violates the constraint, so document verification was broken at runtime.
--
-- Resolution (spec section 4/§54: UI state alone is never authoritative; the domain
-- action must work): align the RPC with the table's governed vocabulary. The UI's
-- verification concept maps to 'VALIDATED'. Update the RPC accordingly and add a
-- regression guard so the mismatch cannot silently return.

CREATE OR REPLACE FUNCTION public.verify_document_command(p_document_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_updated BOOLEAN;
BEGIN
    UPDATE public.documents d
    SET status = 'VALIDATED'
    WHERE d.id = p_document_id
      AND EXISTS (
        SELECT 1 FROM public.pilgrims p
        WHERE p.id = d.pilgrim_id
          AND public.row_in_staff_scope(p.agency_id, p.branch_id)
      )
    RETURNING TRUE INTO v_updated;

    IF NOT FOUND OR v_updated IS NOT TRUE THEN
      -- distinguish "not found" from "not allowed"
      IF EXISTS (SELECT 1 FROM public.documents WHERE id = p_document_id) THEN
        RAISE EXCEPTION 'Document not found in scope' USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'Document not found: %', p_document_id USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object('id', p_document_id, 'status', 'VALIDATED');
END;
$body$;

REVOKE ALL ON FUNCTION public.verify_document_command(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_document_command(UUID) TO authenticated;
