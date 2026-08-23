-- 20260821000000_unify_export_contract.sql

DROP FUNCTION IF EXISTS public.get_export_view(TEXT, DATE, DATE);
DROP FUNCTION IF EXISTS public.get_export_view(TEXT, DATE, DATE, INT, INT);

CREATE OR REPLACE FUNCTION public.get_export_view(
    p_module TEXT,
    p_date_from DATE DEFAULT NULL,
    p_date_to DATE DEFAULT NULL,
    p_limit INT DEFAULT 5000,
    p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency UUID;
    v_branch UUID;
    v_role TEXT;
    v_result JSONB;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Missing agency context' USING ERRCODE = '42501';
    END IF;

    -- Strict Role & Branch validation (P1-02, P1-08)
    SELECT role, branch_id INTO v_role, v_branch 
    FROM public.staff_profiles 
    WHERE user_id = auth.uid() AND is_active = true;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Inactive or missing profile' USING ERRCODE = '42501';
    END IF;

    IF p_limit > 10000 THEN
        RAISE EXCEPTION 'Export limit exceeded: maximum 10000 rows per chunk';
    END IF;

    -- Evaluate PII capability (P1-06)
    -- Only ADMIN can see sensitive PII fields.
    -- (This guarantees redaction at the database layer)

    CASE p_module
        WHEN 'pilgrims' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'full_name', full_name,
                    'passport_number', CASE WHEN v_role = 'ADMIN' THEN passport_number ELSE '[REDACTED]' END,
                    'phone', CASE WHEN v_role = 'ADMIN' THEN phone ELSE '[REDACTED]' END,
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
            FROM (
                SELECT * FROM public.pilgrims
                WHERE agency_id = v_agency
                  -- Branch isolation: Admin sees all, others see only their branch
                  AND (v_role = 'ADMIN' OR branch_id = v_branch)
                  AND (p_date_from IS NULL OR created_at >= p_date_from)
                  AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY created_at
                LIMIT p_limit OFFSET p_offset
            ) t;

        WHEN 'bookings' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'booking_reference', b.reference,
                    'status', b.status,
                    'amount_dzd', CASE WHEN v_role = 'ADMIN' THEN b.total_price_dzd ELSE NULL END,
                    'amount_sar', CASE WHEN v_role = 'ADMIN' THEN b.total_price_sar ELSE NULL END,
                    'payment_method', (SELECT method FROM public.payments p WHERE p.booking_id = b.id ORDER BY created_at LIMIT 1),
                    'created_at', b.created_at
                ) ORDER BY b.created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.bookings b
                WHERE b.agency_id = v_agency
                  AND (v_role = 'ADMIN' OR b.branch_id = v_branch)
                  AND (p_date_from IS NULL OR b.created_at >= p_date_from)
                  AND (p_date_to IS NULL OR b.created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY b.created_at
                LIMIT p_limit OFFSET p_offset
            ) b;

        WHEN 'payments' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'amount_dzd', CASE WHEN v_role = 'ADMIN' THEN py.amount_dzd ELSE NULL END,
                    'payment_method', py.method,
                    'payment_date', COALESCE(py.received_at, py.created_at),
                    'status', py.status,
                    'notes', py.notes
                ) ORDER BY COALESCE(py.received_at, py.created_at)
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.payments py
                WHERE py.agency_id = v_agency
                  -- Branch scoped via bookings
                  AND (v_role = 'ADMIN' OR (SELECT branch_id FROM public.bookings b WHERE b.id = py.booking_id) = v_branch)
                  AND (p_date_from IS NULL OR COALESCE(py.received_at, py.created_at) >= p_date_from)
                  AND (p_date_to IS NULL OR COALESCE(py.received_at, py.created_at) < (p_date_to + INTERVAL '1 day'))
                ORDER BY COALESCE(py.received_at, py.created_at)
                LIMIT p_limit OFFSET p_offset
            ) py;

        WHEN 'groups' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'code', code,
                    'name', name,
                    'departure_date', departure_date,
                    'capacity', capacity,
                    'guide_name', (SELECT name FROM public.staff_profiles WHERE user_id = guide_id LIMIT 1),
                    'status', status,
                    'created_at', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.groups
                WHERE agency_id = v_agency
                  AND (v_role = 'ADMIN' OR branch_id = v_branch)
                  AND (p_date_from IS NULL OR created_at >= p_date_from)
                  AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY created_at
                LIMIT p_limit OFFSET p_offset
            ) t;

        WHEN 'visas' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'pilgrim_name', (SELECT full_name FROM public.pilgrims p WHERE p.id = pilgrim_id LIMIT 1),
                    'passport_number', CASE WHEN v_role = 'ADMIN' THEN (SELECT passport_number FROM public.pilgrims p WHERE p.id = pilgrim_id LIMIT 1) ELSE '[REDACTED]' END,
                    'status', status,
                    'application_date', application_date,
                    'issue_date', issue_date,
                    'notes', notes
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT * FROM public.visas
                WHERE agency_id = v_agency
                  AND (v_role = 'ADMIN' OR (SELECT branch_id FROM public.pilgrims p WHERE p.id = pilgrim_id) = v_branch)
                  AND (p_date_from IS NULL OR created_at >= p_date_from)
                  AND (p_date_to IS NULL OR created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY created_at
                LIMIT p_limit OFFSET p_offset
            ) t;

        WHEN 'external_operations' THEN
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'reference', reference,
                    'operation_type', operation_type,
                    'provider_name', provider_name,
                    'amount', amount,
                    'currency', currency,
                    'status', status,
                    'evidence_status', (SELECT status FROM public.external_operation_evidence e WHERE e.operation_id = eo.id LIMIT 1),
                    'created_at', created_at
                ) ORDER BY created_at
            ), '[]'::jsonb)
            INTO v_result
            FROM (
                SELECT eo.*
                FROM public.external_operations eo
                WHERE eo.agency_id = v_agency
                  -- External ops might not have a branch, restrict to ADMIN only for safety
                  AND v_role = 'ADMIN'
                  AND (p_date_from IS NULL OR eo.created_at >= p_date_from)
                  AND (p_date_to IS NULL OR eo.created_at < (p_date_to + INTERVAL '1 day'))
                ORDER BY eo.created_at
                LIMIT p_limit OFFSET p_offset
            ) eo;

        ELSE
            RAISE EXCEPTION 'Unknown export module %', p_module USING ERRCODE = '22023';
    END CASE;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_export_view(TEXT, DATE, DATE, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_export_view(TEXT, DATE, DATE, INT, INT) TO authenticated;
