-- 20260822000001_seed_chart_of_accounts.sql

CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_agency_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- ASSETS (1000)
    INSERT INTO public.chart_of_accounts (agency_id, code, name, account_type, is_active)
    VALUES 
        (p_agency_id, '1000', 'Cash & Cash Equivalents', 'ASSET', true),
        (p_agency_id, '1200', 'Accounts Receivable (DZD)', 'ASSET', true),
        (p_agency_id, '1201', 'Accounts Receivable (SAR)', 'ASSET', true),
        (p_agency_id, '1500', 'Fixed Assets', 'ASSET', true)
    ON CONFLICT DO NOTHING;

    -- LIABILITIES (2000)
    INSERT INTO public.chart_of_accounts (agency_id, code, name, account_type, is_active)
    VALUES 
        (p_agency_id, '2000', 'Accounts Payable (AP)', 'LIABILITY', true),
        (p_agency_id, '2100', 'Accrued Liabilities', 'LIABILITY', true),
        (p_agency_id, '2200', 'Unearned Revenue (Deposits)', 'LIABILITY', true),
        (p_agency_id, '2500', 'Long-term Debt', 'LIABILITY', true)
    ON CONFLICT DO NOTHING;

    -- EQUITY (3000)
    INSERT INTO public.chart_of_accounts (agency_id, code, name, account_type, is_active)
    VALUES 
        (p_agency_id, '3000', 'Owner''s Equity', 'EQUITY', true),
        (p_agency_id, '3100', 'Retained Earnings', 'EQUITY', true)
    ON CONFLICT DO NOTHING;

    -- REVENUE (4000)
    INSERT INTO public.chart_of_accounts (agency_id, code, name, account_type, is_active)
    VALUES 
        (p_agency_id, '4000', 'Revenue (DZD)', 'REVENUE', true),
        (p_agency_id, '4001', 'Revenue (SAR)', 'REVENUE', true),
        (p_agency_id, '4200', 'Visa Services Revenue', 'REVENUE', true),
        (p_agency_id, '4300', 'Ticketing Revenue', 'REVENUE', true)
    ON CONFLICT DO NOTHING;

    -- EXPENSES (5000)
    INSERT INTO public.chart_of_accounts (agency_id, code, name, account_type, is_active)
    VALUES 
        (p_agency_id, '5000', 'Cost of Goods Sold (Hotels/Flights)', 'EXPENSE', true),
        (p_agency_id, '5100', 'Visa Processing Fees', 'EXPENSE', true),
        (p_agency_id, '6000', 'Payroll Expenses', 'EXPENSE', true),
        (p_agency_id, '6100', 'Marketing & Advertising', 'EXPENSE', true),
        (p_agency_id, '6200', 'Rent & Utilities', 'EXPENSE', true),
        (p_agency_id, '6900', 'Bank Fees & Charges', 'EXPENSE', true)
    ON CONFLICT DO NOTHING;
END;
$$;

-- Seed existing agencies
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT DISTINCT agency_id FROM public.invoices -- approximation for existing agencies
    LOOP
        PERFORM public.seed_default_chart_of_accounts(rec.agency_id);
    END LOOP;
END;
$$;
