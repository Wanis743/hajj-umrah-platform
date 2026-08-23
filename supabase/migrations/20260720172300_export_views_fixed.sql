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
                    'full_name', full_name,
                    'passport_number', passport_number,
                    'phone', phone,
                    'birth_date', birth_date,
                    'wilaya', wilaya,
                    'gender', gender,
                    'visa_status', visa_status,
                    'payment_status', payment_status,
                    'status', status,
                    'departure_airport', departure_airport,
                    'created_at', created_at
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
                    'booking_reference', b.reference,
                    'status', b.status,
                    'amount_dzd', b.total_price_dzd,
                    'amount_sar', b.total_price_sar,
                    'payment_method', (SELECT method FROM public.payments p WHERE p.booking_id = b.id ORDER BY created_at LIMIT 1),
                    'created_at', b.created_at
                ) ORDER BY b.created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM public.bookings b
            WHERE b.agency_id = v_agency
              AND (p_date_from IS NULL OR b.created_at >= p_date_from)
              AND (p_date_to IS NULL OR b.created_at < (p_date_to + INTERVAL '1 day'));

        WHEN 'payments' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'amount_dzd', py.amount_dzd,
                    'payment_method', py.method,
                    'payment_date', COALESCE(py.received_at, py.created_at),
                    'status', py.status,
                    'notes', py.notes
                ) ORDER BY COALESCE(py.received_at, py.created_at)
            ), '[]'::jsonb)
            INTO v_result
            FROM public.payments py
            WHERE py.agency_id = v_agency
              AND (p_date_from IS NULL OR COALESCE(py.received_at, py.created_at) >= p_date_from)
              AND (p_date_to IS NULL OR COALESCE(py.received_at, py.created_at) < (p_date_to + INTERVAL '1 day'));

        WHEN 'groups' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'code', code,
                    'name', name,
                    'capacity', capacity,
                    'departure_date', departure_date,
                    'status', status
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
                    'visa_number', visa_number,
                    'status', status,
                    'application_date', created_at,
                    'issue_date', created_at,
                    'expiry_date', expiry_date
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
                    'provider', provider,
                    'operation_type', operation_type,
                    'internal_status', status,
                    'external_reference', external_ref,
                    'evidence_status', 'N/A',
                    'sla_hours', 24
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
