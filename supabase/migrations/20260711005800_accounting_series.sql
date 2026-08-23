CREATE OR REPLACE FUNCTION public.get_accounting_series(
    p_currency_code TEXT,
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
    v_from DATE := COALESCE(p_date_from, (CURRENT_DATE - INTERVAL '12 months')::DATE);
    v_to DATE := COALESCE(p_date_to, CURRENT_DATE);
    v_result JSONB;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'm', month_date,
            'rev', revenue,
            'exp', expenses,
            'profit', revenue - expenses
        ) ORDER BY month_date
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT 
            TO_CHAR(je.created_at, 'YYYY-MM') as month_date,
            ROUND(SUM(CASE WHEN ca.account_type = 'REVENUE' THEN jl.credit - jl.debit ELSE 0 END), 2) as revenue,
            ROUND(SUM(CASE WHEN ca.account_type = 'EXPENSE' THEN jl.debit - jl.credit ELSE 0 END), 2) as expenses
        FROM public.journal_entries je
        JOIN public.journal_lines jl ON jl.journal_entry_id = je.id
        JOIN public.chart_of_accounts ca ON ca.id = jl.account_id
        WHERE je.agency_id = v_agency
          AND je.status = 'POSTED'
          AND jl.currency_code = p_currency_code
          AND je.created_at >= v_from
          AND je.created_at < (v_to + INTERVAL '1 day')
        GROUP BY TO_CHAR(je.created_at, 'YYYY-MM')
    ) aggregated;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_accounting_series(TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_accounting_series(TEXT, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_payment_methods_series(
    p_currency_code TEXT,
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
    v_from DATE := COALESCE(p_date_from, (CURRENT_DATE - INTERVAL '12 months')::DATE);
    v_to DATE := COALESCE(p_date_to, CURRENT_DATE);
    v_result JSONB;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'method', method,
            'dzd', amount,
            'count', cnt
        ) ORDER BY amount DESC
    ), '[]'::jsonb)
    INTO v_result
    FROM (
        SELECT 
            COALESCE(p.method, 'UNKNOWN') as method,
            ROUND(SUM(CASE WHEN p_currency_code = 'DZD' THEN p.amount_dzd ELSE p.amount_sar END), 2) as amount,
            COUNT(*) as cnt
        FROM public.payments p
        WHERE p.agency_id = v_agency
          AND p.status = 'CONFIRMED'
          AND COALESCE(p.received_at, p.created_at) >= v_from
          AND COALESCE(p.received_at, p.created_at) < (v_to + INTERVAL '1 day')
        GROUP BY COALESCE(p.method, 'UNKNOWN')
    ) aggregated;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_payment_methods_series(TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payment_methods_series(TEXT, DATE, DATE) TO authenticated;
