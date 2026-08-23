-- external_operations schema migration

CREATE TABLE IF NOT EXISTS external_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    branch_uuid UUID,
    provider TEXT NOT NULL CHECK (provider IN ('NUSUK', 'AIRLINE', 'HOTEL', 'TRANSPORT', 'INSURANCE', 'BANK', 'GOVT', 'OTHER')),
    operation_type TEXT NOT NULL,
    pilgrim_id UUID, -- References pilgrims if applicable
    booking_id UUID, -- References bookings if applicable
    group_id UUID, -- References groups if applicable
    internal_status TEXT NOT NULL CHECK (internal_status IN ('NOT_STARTED', 'READY', 'SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED')) DEFAULT 'NOT_STARTED',
    external_reference TEXT,
    external_status TEXT,
    evidence_status TEXT NOT NULL CHECK (evidence_status IN ('PENDING', 'ATTACHED', 'VERIFIED', 'REJECTED')) DEFAULT 'PENDING',
    evidence_notes TEXT,
    sla_hours INTEGER,
    submitted_at TIMESTAMPTZ,
    sla_deadline TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    responsible_staff_id UUID,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID
);

CREATE TABLE IF NOT EXISTS external_operation_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES external_operations(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT,
    description TEXT,
    uploaded_by UUID,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')) DEFAULT 'PENDING'
);

CREATE TABLE IF NOT EXISTS external_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    pilgrim_id UUID,
    booking_id UUID,
    ref_type TEXT NOT NULL CHECK (ref_type IN ('NUSUK_ID', 'VISA_NO', 'AIRLINE_PNR', 'HOTEL_CONF', 'INSURANCE_POLICY', 'TRANSPORT_CONF', 'OTHER')),
    ref_value TEXT NOT NULL,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS and Audit Triggers
ALTER TABLE external_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_operation_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY op_select ON external_operations FOR SELECT TO authenticated USING (public.row_in_staff_scope(agency_id, branch_uuid));
CREATE POLICY op_insert ON external_operations FOR INSERT TO authenticated WITH CHECK (public.row_in_staff_scope(agency_id, branch_uuid));
CREATE POLICY op_update ON external_operations FOR UPDATE TO authenticated USING (public.row_in_staff_scope(agency_id, branch_uuid));
CREATE POLICY op_delete ON external_operations FOR DELETE TO authenticated USING (public.row_in_staff_scope(agency_id, branch_uuid));

CREATE POLICY evid_select ON external_operation_evidence FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM external_operations o WHERE o.id = operation_id AND public.row_in_staff_scope(o.agency_id, o.branch_uuid)));
CREATE POLICY evid_insert ON external_operation_evidence FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM external_operations o WHERE o.id = operation_id AND public.row_in_staff_scope(o.agency_id, o.branch_uuid)));
CREATE POLICY evid_update ON external_operation_evidence FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM external_operations o WHERE o.id = operation_id AND public.row_in_staff_scope(o.agency_id, o.branch_uuid)));
CREATE POLICY evid_delete ON external_operation_evidence FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM external_operations o WHERE o.id = operation_id AND public.row_in_staff_scope(o.agency_id, o.branch_uuid)));

CREATE POLICY ref_select ON external_references FOR SELECT TO authenticated USING (public.row_in_staff_scope(agency_id, NULL));
CREATE POLICY ref_insert ON external_references FOR INSERT TO authenticated WITH CHECK (public.row_in_staff_scope(agency_id, NULL));
CREATE POLICY ref_update ON external_references FOR UPDATE TO authenticated USING (public.row_in_staff_scope(agency_id, NULL));
CREATE POLICY ref_delete ON external_references FOR DELETE TO authenticated USING (public.row_in_staff_scope(agency_id, NULL));

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'write_audit_log') THEN
    CREATE TRIGGER trg_audit_ext_operations AFTER INSERT OR UPDATE OR DELETE ON external_operations FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
    CREATE TRIGGER trg_audit_ext_evidence AFTER INSERT OR UPDATE OR DELETE ON external_operation_evidence FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
    CREATE TRIGGER trg_audit_ext_references AFTER INSERT OR UPDATE OR DELETE ON external_references FOR EACH ROW EXECUTE FUNCTION public.write_audit_log();
  END IF;
END $$;

-- Hardened RPCs
CREATE OR REPLACE FUNCTION create_external_operation(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID;
    v_agency_id UUID;
    v_branch_uuid UUID;
BEGIN
    if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
    v_agency_id := public.current_staff_agency_id();
    v_branch_uuid := public.current_staff_branch_id();
    
    INSERT INTO external_operations (
        agency_id, branch_uuid, provider, operation_type, pilgrim_id, booking_id, group_id, internal_status,
        external_reference, external_status, evidence_status, notes, created_by
    ) VALUES (
        v_agency_id,
        v_branch_uuid,
        p_payload->>'provider',
        p_payload->>'operation_type',
        (p_payload->>'pilgrim_id')::UUID,
        (p_payload->>'booking_id')::UUID,
        (p_payload->>'group_id')::UUID,
        COALESCE(p_payload->>'internal_status', 'NOT_STARTED'),
        p_payload->>'external_reference',
        p_payload->>'external_status',
        COALESCE(p_payload->>'evidence_status', 'PENDING'),
        p_payload->>'notes',
        auth.uid()
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION create_external_operation(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_external_operation(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION update_external_operation(p_id UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_op external_operations%ROWTYPE;
BEGIN
    if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
    SELECT * INTO v_op FROM external_operations WHERE id = p_id FOR UPDATE;
    if not found then raise exception 'Operation not found' using errcode='42501'; end if;
    if not public.row_in_staff_scope(v_op.agency_id, v_op.branch_uuid) then raise exception 'Unauthorized scope' using errcode='42501'; end if;

    UPDATE external_operations SET
        internal_status = COALESCE(p_payload->>'internal_status', internal_status),
        external_reference = COALESCE(p_payload->>'external_reference', external_reference),
        external_status = COALESCE(p_payload->>'external_status', external_status),
        evidence_status = COALESCE(p_payload->>'evidence_status', evidence_status),
        evidence_notes = COALESCE(p_payload->>'evidence_notes', evidence_notes),
        notes = COALESCE(p_payload->>'notes', notes),
        updated_at = NOW()
    WHERE id = p_id;
    RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION update_external_operation(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_external_operation(UUID, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION delete_external_operation(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_op external_operations%ROWTYPE;
BEGIN
    if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
    SELECT * INTO v_op FROM external_operations WHERE id = p_id FOR UPDATE;
    if not found then raise exception 'Operation not found' using errcode='42501'; end if;
    if not public.row_in_staff_scope(v_op.agency_id, v_op.branch_uuid) then raise exception 'Unauthorized scope' using errcode='42501'; end if;

    DELETE FROM external_operations WHERE id = p_id;
    RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION delete_external_operation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_external_operation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION attach_external_evidence(p_operation_id UUID, p_storage_path TEXT, p_file_name TEXT, p_file_type TEXT, p_description TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID;
    v_op external_operations%ROWTYPE;
    expected_prefix TEXT;
BEGIN
    if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
    SELECT * INTO v_op FROM external_operations WHERE id = p_operation_id FOR UPDATE;
    if not found then raise exception 'Operation not found' using errcode='42501'; end if;
    if not public.row_in_staff_scope(v_op.agency_id, v_op.branch_uuid) then raise exception 'Unauthorized scope' using errcode='42501'; end if;

    expected_prefix := v_op.agency_id::TEXT || '/external_operations/' || p_operation_id::TEXT || '/';
    if p_storage_path not like (expected_prefix || '%') then raise exception 'Invalid storage path scope' using errcode='42501'; end if;

    INSERT INTO external_operation_evidence (
        operation_id, storage_path, file_name, file_type, description, uploaded_by
    ) VALUES (
        p_operation_id, p_storage_path, p_file_name, p_file_type, p_description, auth.uid()
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION attach_external_evidence(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attach_external_evidence(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION add_external_reference(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID;
    v_agency_id UUID;
BEGIN
    if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
    v_agency_id := public.current_staff_agency_id();
    
    INSERT INTO external_references (
        agency_id, pilgrim_id, booking_id, ref_type, ref_value, notes, created_by
    ) VALUES (
        v_agency_id,
        (p_payload->>'pilgrim_id')::UUID,
        (p_payload->>'booking_id')::UUID,
        p_payload->>'ref_type',
        p_payload->>'ref_value',
        p_payload->>'notes',
        auth.uid()
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION add_external_reference(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_external_reference(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION delete_external_reference(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_ref external_references%ROWTYPE;
BEGIN
    if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
    SELECT * INTO v_ref FROM external_references WHERE id = p_id FOR UPDATE;
    if not found then raise exception 'Reference not found' using errcode='42501'; end if;
    if not public.row_in_staff_scope(v_ref.agency_id, NULL) then raise exception 'Unauthorized scope' using errcode='42501'; end if;

    DELETE FROM external_references WHERE id = p_id;
    RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION delete_external_reference(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_external_reference(UUID) TO authenticated;
