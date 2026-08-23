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
            'id', je.id,
            'created_at', je.created_at,
            'reference', je.reference,
            'entry_date', je.entry_date,
            'description', je.description,
            'status', je.status,
            'total_debit', je.total_debit,
            'total_credit', je.total_credit,
            'lines', je.lines
        ) ORDER BY je.entry_date DESC, je.created_at DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT 
            e.id, e.created_at, e.reference, e.entry_date, e.description, e.status,
            COALESCE(SUM(l.debit), 0) as total_debit,
            COALESCE(SUM(l.credit), 0) as total_credit,
            jsonb_agg(jsonb_build_object(
                'account_code', c.code,
                'account_name', c.name,
                'debit', l.debit,
                'credit', l.credit,
                'memo', l.memo
            )) as lines
        FROM public.journal_entries e
        LEFT JOIN public.journal_lines l ON l.journal_entry_id = e.id
        LEFT JOIN public.chart_of_accounts c ON c.id = l.account_id
        WHERE e.agency_id = v_agency
        GROUP BY e.id, e.created_at, e.reference, e.entry_date, e.description, e.status
        ORDER BY e.entry_date DESC, e.created_at DESC
        LIMIT limit_rows
    ) je;

    RETURN v_result;
END;
$$;
