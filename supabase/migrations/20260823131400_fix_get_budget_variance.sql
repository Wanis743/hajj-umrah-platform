-- 20260823131400_fix_get_budget_variance.sql (rebuild-authored, slice 8)
-- The RPC referenced chart_of_accounts.type; the live column is account_type.
-- Rebuilt to also return the variance rows in the documented JSONB shape.

CREATE OR REPLACE FUNCTION public.get_budget_variance(p_budget_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_period_id UUID;
    v_start DATE;
    v_end DATE;
    v_agency UUID;
    v_result JSONB;
BEGIN
    SELECT period_id INTO v_period_id FROM public.fiscal_budgets WHERE id = p_budget_id;
    IF v_period_id IS NULL THEN
        RAISE EXCEPTION 'Budget not found: %', p_budget_id USING ERRCODE = 'P0002';
    END IF;

    SELECT start_date, end_date INTO v_start, v_end FROM public.fiscal_periods WHERE id = v_period_id;

    WITH Budgeted AS (
        SELECT bl.account_id, SUM(bl.amount_dzd) AS budgeted_dzd
        FROM public.budget_lines bl
        WHERE bl.budget_id = p_budget_id
        GROUP BY bl.account_id
    ),
    Actuals AS (
        SELECT jl.account_id, SUM(jl.debit - jl.credit) AS actual_balance_dzd
        FROM public.journal_lines jl
        JOIN public.journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.status = 'POSTED'
          AND je.entry_date BETWEEN v_start AND v_end
        GROUP BY jl.account_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'account_id', a.account_id,
            'code', c.code,
            'name', c.name,
            'type', c.account_type,
            'budgeted_dzd', COALESCE(b.budgeted_dzd, 0),
            'actual_dzd', COALESCE(a.actual_balance_dzd, 0),
            'variance_dzd', COALESCE(b.budgeted_dzd, 0) - COALESCE(a.actual_balance_dzd, 0),
            'variance_pct', CASE
                WHEN COALESCE(b.budgeted_dzd, 0) > 0
                    THEN ROUND(((COALESCE(b.budgeted_dzd,0) - COALESCE(a.actual_balance_dzd,0)) / b.budgeted_dzd) * 100, 2)
                ELSE 0 END
        ) ORDER BY c.code), '[]'::jsonb)
    INTO v_result
    FROM Budgeted b
    FULL OUTER JOIN Actuals a ON a.account_id = b.account_id
    JOIN public.chart_of_accounts c ON c.id = COALESCE(b.account_id, a.account_id);

    RETURN v_result;
END;
$body$;
