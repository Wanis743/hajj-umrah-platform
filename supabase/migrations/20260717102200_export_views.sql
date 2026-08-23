CREATE OR REPLACE FUNCTION public.get_export_view(
    p_module TEXT,
    p_date_from DATE DEFAULT NULL,
    p_date_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency UUID;
    v_result JSONB;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    CASE p_module
        WHEN 'pilgrims' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'Reference', reference,
                    'FullName', full_name,
                    'Passport', passport_number,
                    'Nationality', nationality,
                    'Gender', gender,
                    'BirthDate', birth_date,
                    'Status', status,
                    'VisaStatus', visa_status,
                    'CreatedAt', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM public.pilgrims
            WHERE agency_id = v_agency
              AND (p_date_from IS NULL OR created_at >= p_date_from)
              AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'));

        WHEN 'bookings' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'BookingID', b.id,
                    'PilgrimName', p.full_name,
                    'Package', pk.name,
                    'Status', b.status,
                    'TotalPrice', b.total_price_dzd,
                    'CreatedAt', b.created_at
                ) ORDER BY b.created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM public.bookings b
            LEFT JOIN public.pilgrims p ON p.id = b.pilgrim_id
            LEFT JOIN public.packages pk ON pk.id = b.package_id
            WHERE b.agency_id = v_agency
              AND (p_date_from IS NULL OR b.created_at >= p_date_from)
              AND (p_date_to IS NULL OR b.created_at < (p_date_to + INTERVAL '1 day'));

        WHEN 'payments' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'PaymentID', py.id,
                    'BookingID', py.booking_id,
                    'AmountDZD', py.amount_dzd,
                    'Method', py.method,
                    'Status', py.status,
                    'ReceivedAt', py.received_at
                ) ORDER BY py.received_at
            ), '[]'::jsonb)
            INTO v_result
            FROM public.payments py
            WHERE py.agency_id = v_agency
              AND (p_date_from IS NULL OR COALESCE(py.received_at, py.created_at) >= p_date_from)
              AND (p_date_to IS NULL OR COALESCE(py.received_at, py.created_at) < (p_date_to + INTERVAL '1 day'));

        WHEN 'groups' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'GroupID', id,
                    'Code', code,
                    'Name', name,
                    'Status', status,
                    'CreatedAt', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM public.groups
            WHERE agency_id = v_agency
              AND (p_date_from IS NULL OR created_at >= p_date_from)
              AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'));

        WHEN 'visas' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'VisaID', id,
                    'PilgrimID', pilgrim_id,
                    'VisaNumber', visa_number,
                    'Status', status,
                    'ExpiryDate', expiry_date,
                    'CreatedAt', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM public.visas
            WHERE agency_id = v_agency
              AND (p_date_from IS NULL OR created_at >= p_date_from)
              AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'));

        WHEN 'external_operations' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'OperationID', id,
                    'Provider', provider,
                    'OperationType', operation_type,
                    'Status', status,
                    'ExternalRef', external_ref,
                    'CreatedAt', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM public.external_operations
            WHERE agency_id = v_agency
              AND (p_date_from IS NULL OR created_at >= p_date_from)
              AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'));

        ELSE
            RAISE EXCEPTION 'Export module not supported: %', p_module USING ERRCODE = '22023';
    END CASE;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_export_view(TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_export_view(TEXT, DATE, DATE) TO authenticated;
