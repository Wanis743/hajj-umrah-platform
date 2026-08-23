CREATE OR REPLACE FUNCTION create_external_operation(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id UUID;
    v_agency_id UUID;
    v_branch_uuid UUID;
    v_pilgrim_id UUID;
    v_booking_id UUID;
    v_group_id UUID;
BEGIN
    if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
    v_agency_id := public.current_staff_agency_id();
    v_branch_uuid := public.current_staff_branch_id();
    
    -- Parse UUIDs safely
    BEGIN
        v_pilgrim_id := (p_payload->>'pilgrim_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        v_pilgrim_id := NULL;
    END;

    BEGIN
        v_booking_id := (p_payload->>'booking_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        v_booking_id := NULL;
    END;

    BEGIN
        v_group_id := (p_payload->>'group_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        v_group_id := NULL;
    END;

    -- Validate Entity Ownership
    IF v_pilgrim_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM pilgrims WHERE id = v_pilgrim_id AND agency_id = v_agency_id) THEN
            RAISE EXCEPTION 'Pilgrim does not belong to your agency' USING errcode='42501';
        END IF;
    END IF;

    IF v_booking_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM bookings WHERE id = v_booking_id AND agency_id = v_agency_id) THEN
            RAISE EXCEPTION 'Booking does not belong to your agency' USING errcode='42501';
        END IF;
    END IF;

    IF v_group_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM groups WHERE id = v_group_id AND agency_id = v_agency_id) THEN
            RAISE EXCEPTION 'Group does not belong to your agency' USING errcode='42501';
        END IF;
    END IF;

    INSERT INTO external_operations (
        agency_id, branch_uuid, provider, operation_type, pilgrim_id, booking_id, group_id, internal_status,
        external_reference, external_status, evidence_status, notes, created_by
    ) VALUES (
        v_agency_id,
        v_branch_uuid,
        p_payload->>'provider',
        p_payload->>'operation_type',
        v_pilgrim_id,
        v_booking_id,
        v_group_id,
        COALESCE(p_payload->>'internal_status', 'NOT_STARTED'),
        p_payload->>'external_reference',
        p_payload->>'external_status',
        COALESCE(p_payload->>'evidence_status', 'NONE'),
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
        notes = COALESCE(p_payload->>'notes', notes),
        updated_at = NOW()
    WHERE id = p_id;
    
    RETURN jsonb_build_object('id', p_id);
END;
$$;
REVOKE ALL ON FUNCTION update_external_operation(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_external_operation(UUID, JSONB) TO authenticated;

