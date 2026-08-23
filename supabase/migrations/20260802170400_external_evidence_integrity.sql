ALTER TABLE external_operation_evidence
ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'documents',
ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;

DROP FUNCTION IF EXISTS attach_external_evidence(UUID, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION attach_external_evidence(
    p_operation_id UUID, 
    p_storage_bucket TEXT,
    p_storage_path TEXT, 
    p_file_name TEXT, 
    p_file_type TEXT, 
    p_description TEXT,
    p_size_bytes BIGINT,
    p_checksum_sha256 TEXT
)
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

    if p_storage_bucket != 'documents' then raise exception 'Invalid storage bucket' using errcode='42501'; end if;

    expected_prefix := v_op.agency_id::TEXT || '/external_operations/' || p_operation_id::TEXT || '/';
    if p_storage_path not like (expected_prefix || '%') then raise exception 'Invalid storage path scope' using errcode='42501'; end if;

    INSERT INTO external_operation_evidence (
        operation_id, storage_bucket, storage_path, file_name, file_type, description, size_bytes, checksum_sha256, uploaded_by
    ) VALUES (
        p_operation_id, p_storage_bucket, p_storage_path, p_file_name, p_file_type, p_description, p_size_bytes, p_checksum_sha256, auth.uid()
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION attach_external_evidence(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attach_external_evidence(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT) TO authenticated;

