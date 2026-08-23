CREATE OR REPLACE FUNCTION public.get_recent_journal_entries(
    limit_rows INT DEFAULT 50
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

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'created_at', created_at,
            'reference', reference,
            'account_code', account_code,
            'type', type,
            'amount', amount,
            'description', description
        ) ORDER BY created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT created_at, reference, account_code, type, amount, description
        FROM public.journal_entries
        WHERE agency_id = v_agency
        ORDER BY created_at DESC
        LIMIT limit_rows
    ) t;

    RETURN v_result;
END;
$$;
