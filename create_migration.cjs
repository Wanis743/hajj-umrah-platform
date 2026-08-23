const fs = require('fs');
const path = require('path');

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260822000007_unit_economics_engine.sql');

const sql = \
-- Add group_id to journal_entries to trace ledger events to operational units
ALTER TABLE journal_entries ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- Create an RPC to aggregate real-time revenue and cost per group
CREATE OR REPLACE FUNCTION get_group_profitability(p_group_id UUID)
RETURNS TABLE (
    total_revenue_dzd NUMERIC,
    total_revenue_sar NUMERIC,
    total_cost_dzd NUMERIC,
    total_cost_sar NUMERIC,
    margin_dzd NUMERIC,
    margin_sar NUMERIC,
    margin_percentage NUMERIC
) AS \\\$\\\$
DECLARE
    v_rev_dzd NUMERIC := 0;
    v_rev_sar NUMERIC := 0;
    v_cost_dzd NUMERIC := 0;
    v_cost_sar NUMERIC := 0;
    v_margin_pct NUMERIC := 0;
BEGIN
    -- Aggregate Revenue (Credits to Income accounts tagged with group_id)
    SELECT 
        COALESCE(SUM(jl.credit_dzd) - SUM(jl.debit_dzd), 0),
        COALESCE(SUM(jl.credit_sar) - SUM(jl.debit_sar), 0)
    INTO v_rev_dzd, v_rev_sar
    FROM journal_lines jl
    JOIN journal_entries je ON jl.entry_id = je.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE je.group_id = p_group_id AND a.type = 'INCOME';

    -- Aggregate Cost (Debits to Expense accounts tagged with group_id)
    SELECT 
        COALESCE(SUM(jl.debit_dzd) - SUM(jl.credit_dzd), 0),
        COALESCE(SUM(jl.debit_sar) - SUM(jl.credit_sar), 0)
    INTO v_cost_dzd, v_cost_sar
    FROM journal_lines jl
    JOIN journal_entries je ON jl.entry_id = je.id
    JOIN accounts a ON jl.account_id = a.id
    WHERE je.group_id = p_group_id AND a.type = 'EXPENSE';

    IF v_rev_dzd > 0 THEN
        v_margin_pct := ((v_rev_dzd - v_cost_dzd) / v_rev_dzd) * 100;
    END IF;

    RETURN QUERY SELECT 
        v_rev_dzd,
        v_rev_sar,
        v_cost_dzd,
        v_cost_sar,
        (v_rev_dzd - v_cost_dzd),
        (v_rev_sar - v_cost_sar),
        v_margin_pct;
END;
\\\$\\\$ LANGUAGE plpgsql SECURITY DEFINER;
\;

fs.writeFileSync(migrationPath, sql, 'utf8');
console.log('Created ' + migrationPath);
