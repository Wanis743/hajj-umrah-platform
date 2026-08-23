CREATE OR REPLACE FUNCTION public.get_data_quality_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency UUID;
    v_total INT;
    v_with_passport INT;
    v_dup_emails INT;
    v_missing_phone INT;
    v_missing_birth INT;
    v_stale_bookings INT;
    v_orphan_bookings INT;
    v_orphan_payments INT;
    v_open_alerts INT;
    v_open_incidents INT;
    v_expired_docs INT;
    v_soon_expiry INT;
    v_groups_no_guide INT;
    v_groups_no_transport INT;
    v_visa_counts JSONB;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Pilgrims metrics
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE passport_number IS NOT NULL AND TRIM(passport_number) <> ''),
        COUNT(*) FILTER (WHERE phone IS NULL OR TRIM(phone) = ''),
        COUNT(*) FILTER (WHERE birth_date IS NULL)
    INTO v_total, v_with_passport, v_missing_phone, v_missing_birth
    FROM public.pilgrims
    WHERE agency_id = v_agency;

    SELECT COUNT(*) INTO v_dup_emails
    FROM (
        SELECT LOWER(TRIM(email))
        FROM public.pilgrims
        WHERE agency_id = v_agency AND email IS NOT NULL AND TRIM(email) <> ''
        GROUP BY LOWER(TRIM(email))
        HAVING COUNT(*) > 1
    ) dup;

    -- Bookings metrics
    SELECT 
        COUNT(*) FILTER (WHERE status = 'PENDING' AND created_at < NOW() - INTERVAL '7 days'),
        COUNT(*) FILTER (WHERE pilgrim_id IS NULL)
    INTO v_stale_bookings, v_orphan_bookings
    FROM public.bookings
    WHERE agency_id = v_agency;

    -- Payments metrics
    SELECT COUNT(*)
    INTO v_orphan_payments
    FROM public.payments p
    LEFT JOIN public.bookings b ON b.id = p.booking_id
    WHERE p.agency_id = v_agency AND b.id IS NULL;

    -- Alerts and Incidents
    SELECT COUNT(*) INTO v_open_alerts
    FROM public.alerts
    WHERE agency_id = v_agency AND acknowledged = FALSE;

    SELECT COUNT(*) INTO v_open_incidents
    FROM public.incidents
    WHERE agency_id = v_agency AND UPPER(status) NOT IN ('RESOLVED', 'CLOSED');

    -- Documents
    SELECT 
        COUNT(*) FILTER (WHERE expiry_date < CURRENT_DATE),
        COUNT(*) FILTER (WHERE expiry_date > CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '30 days')
    INTO v_expired_docs, v_soon_expiry
    FROM public.documents
    WHERE agency_id = v_agency AND expiry_date IS NOT NULL;

    -- Groups
    SELECT 
        COUNT(*) FILTER (WHERE guide_id IS NULL),
        COUNT(*) FILTER (WHERE transport_id IS NULL)
    INTO v_groups_no_guide, v_groups_no_transport
    FROM public.groups
    WHERE agency_id = v_agency;

    -- Visa counts
    SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
    INTO v_visa_counts
    FROM (
        SELECT COALESCE(status, 'UNKNOWN') as status, COUNT(*) as cnt
        FROM public.visas
        WHERE agency_id = v_agency
        GROUP BY COALESCE(status, 'UNKNOWN')
    ) v;

    RETURN jsonb_build_object(
        'total_pilgrims', v_total,
        'with_passport', v_with_passport,
        'dup_emails', v_dup_emails,
        'missing_phone', v_missing_phone,
        'missing_birth', v_missing_birth,
        'stale_bookings', v_stale_bookings,
        'orphan_bookings', v_orphan_bookings,
        'orphan_payments', v_orphan_payments,
        'open_alerts', v_open_alerts,
        'open_incidents', v_open_incidents,
        'expired_docs', v_expired_docs,
        'soon_expiry', v_soon_expiry,
        'groups_no_guide', v_groups_no_guide,
        'groups_no_transport', v_groups_no_transport,
        'visa_counts', v_visa_counts
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_data_quality_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot() TO authenticated;
