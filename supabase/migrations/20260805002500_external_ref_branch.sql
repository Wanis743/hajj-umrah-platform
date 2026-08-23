ALTER TABLE external_references
ADD COLUMN IF NOT EXISTS branch_uuid UUID REFERENCES branches(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS ref_select ON external_references;
DROP POLICY IF EXISTS ref_insert ON external_references;
DROP POLICY IF EXISTS ref_update ON external_references;
DROP POLICY IF EXISTS ref_delete ON external_references;

CREATE POLICY ref_select ON external_references FOR SELECT TO authenticated USING (public.row_in_staff_scope(agency_id, branch_uuid));
CREATE POLICY ref_insert ON external_references FOR INSERT TO authenticated WITH CHECK (public.row_in_staff_scope(agency_id, branch_uuid));
CREATE POLICY ref_update ON external_references FOR UPDATE TO authenticated USING (public.row_in_staff_scope(agency_id, branch_uuid));
CREATE POLICY ref_delete ON external_references FOR DELETE TO authenticated USING (public.row_in_staff_scope(agency_id, branch_uuid));

DROP FUNCTION IF EXISTS add_external_reference(JSONB);
CREATE OR REPLACE FUNCTION add_external_reference(p_payload JSONB)
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
    
    INSERT INTO external_references (
        agency_id, branch_uuid, pilgrim_id, booking_id, ref_type, ref_value, notes, created_by
    ) VALUES (
        v_agency_id, v_branch_uuid,
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

