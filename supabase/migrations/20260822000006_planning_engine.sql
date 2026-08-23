CREATE TABLE IF NOT EXISTS public.fiscal_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    period_id UUID NOT NULL REFERENCES public.fiscal_periods(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'LOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.budget_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_id UUID NOT NULL REFERENCES public.fiscal_budgets(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
    amount_dzd NUMERIC(14,2) NOT NULL DEFAULT 0,
    amount_sar NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(budget_id, account_id)
);

ALTER TABLE public.fiscal_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_all ON public.fiscal_budgets FOR ALL TO authenticated USING (public.row_in_staff_scope(agency_id, NULL)) WITH CHECK (public.row_in_staff_scope(agency_id, NULL));
CREATE POLICY staff_all ON public.budget_lines FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.fiscal_budgets b WHERE b.id = budget_id AND public.row_in_staff_scope(b.agency_id, NULL)));

CREATE OR REPLACE FUNCTION public.get_budget_variance(p_budget_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
DECLARE
    v_period_id UUID;
    v_start DATE;
    v_end DATE;
    v_result JSONB;
BEGIN
    SELECT period_id INTO v_period_id FROM public.fiscal_budgets WHERE id = p_budget_id;
    SELECT start_date, end_date INTO v_start, v_end FROM public.fiscal_periods WHERE id = v_period_id;

    WITH Actuals AS (
        SELECT 
            jl.account_id,
            SUM(jl.debit - jl.credit) AS actual_balance_dzd 
        FROM public.journal_lines jl
        JOIN public.journal_entries je ON je.id = jl.journal_entry_id
        WHERE je.status = 'POSTED' 
          AND je.entry_date >= v_start AND je.entry_date <= v_end
        GROUP BY jl.account_id
    ),
    Budgets AS (
        SELECT account_id, amount_dzd AS budgeted_dzd
        FROM public.budget_lines
        WHERE budget_id = p_budget_id
    ),
    Combined AS (
        SELECT 
            c.id AS account_id,
            c.code,
            c.name,
            c.type,
            COALESCE(b.budgeted_dzd, 0) AS budgeted_dzd,
            COALESCE(a.actual_balance_dzd, 0) AS raw_actual,
            CASE 
                WHEN c.type IN ('REVENUE', 'LIABILITY', 'EQUITY') THEN COALESCE(-a.actual_balance_dzd, 0)
                ELSE COALESCE(a.actual_balance_dzd, 0)
            END AS actual_dzd
        FROM public.chart_of_accounts c
        LEFT JOIN Budgets b ON b.account_id = c.id
        LEFT JOIN Actuals a ON a.account_id = c.id
        WHERE (b.budgeted_dzd IS NOT NULL OR a.actual_balance_dzd IS NOT NULL)
    )
    SELECT jsonb_agg(
        jsonb_build_object(
            'account_id', account_id,
            'code', code,
            'name', name,
            'type', type,
            'budgeted_dzd', budgeted_dzd,
            'actual_dzd', actual_dzd,
            'variance_dzd', budgeted_dzd - actual_dzd,
            'variance_pct', CASE WHEN budgeted_dzd > 0 THEN ROUND(((budgeted_dzd - actual_dzd) / budgeted_dzd) * 100, 2) ELSE 0 END
        )
    ) INTO v_result FROM Combined;

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$body$;
