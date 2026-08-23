-- 20260822000002_reconciliation_module.sql

CREATE TABLE IF NOT EXISTS public.bank_statements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    bank_account_id UUID REFERENCES public.bank_accounts(id),
    statement_date DATE NOT NULL,
    start_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    end_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'RECONCILED', 'LOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    UNIQUE(bank_account_id, statement_date)
);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    statement_id UUID REFERENCES public.bank_statements(id) ON DELETE CASCADE,
    transaction_date DATE NOT NULL,
    amount NUMERIC(18,2) NOT NULL,
    description TEXT,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'UNMATCHED' CHECK(status IN ('UNMATCHED', 'MATCHED', 'IGNORED')),
    matched_journal_line_id UUID REFERENCES public.journal_lines(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_tx_statement ON public.bank_transactions(statement_id);
CREATE INDEX idx_bank_tx_status ON public.bank_transactions(status);

-- Enable RLS
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

-- Policies for bank_statements
CREATE POLICY "Staff can view bank statements in scope"
    ON public.bank_statements FOR SELECT
    USING (public.row_in_staff_scope(agency_id, NULL));

CREATE POLICY "Finance can insert bank statements"
    ON public.bank_statements FOR INSERT
    WITH CHECK (public.row_in_staff_scope(agency_id, NULL) AND public.has_permission('journal_entries', 'create'));

CREATE POLICY "Finance can update bank statements"
    ON public.bank_statements FOR UPDATE
    USING (public.row_in_staff_scope(agency_id, NULL) AND public.has_permission('journal_entries', 'update'))
    WITH CHECK (public.row_in_staff_scope(agency_id, NULL) AND public.has_permission('journal_entries', 'update'));

-- Policies for bank_transactions (Inherit agency_id through statement_id via helper or join, but for simplicity we rely on statement_id)
CREATE POLICY "Staff can view bank tx"
    ON public.bank_transactions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.bank_statements s 
        WHERE s.id = bank_transactions.statement_id 
        AND public.row_in_staff_scope(s.agency_id, NULL)
    ));

CREATE POLICY "Finance can modify bank tx"
    ON public.bank_transactions FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.bank_statements s 
        WHERE s.id = bank_transactions.statement_id 
        AND public.row_in_staff_scope(s.agency_id, NULL)
        AND public.has_permission('journal_entries', 'update')
    ));

-- RPC for auto-matching (Naive exact amount matching)
CREATE OR REPLACE FUNCTION public.auto_reconcile_bank_statement(p_statement_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_statement public.bank_statements%ROWTYPE;
    v_match_count INT := 0;
    v_tx RECORD;
    v_jl_id UUID;
BEGIN
    SELECT * INTO v_statement FROM public.bank_statements WHERE id = p_statement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Statement not found';
    END IF;

    -- Only allow if finance role/perms
    IF NOT public.has_permission('journal_entries', 'update') AND public.staff_role() <> 'ADMIN' THEN
        RAISE EXCEPTION 'Not authorized to reconcile';
    END IF;

    FOR v_tx IN 
        SELECT * FROM public.bank_transactions 
        WHERE statement_id = p_statement_id AND status = 'UNMATCHED'
    LOOP
        -- Find a matching journal line with same amount (positive = debit, negative = credit) and account
        SELECT id INTO v_jl_id
        FROM public.journal_lines
        WHERE account_id = v_statement.bank_account_id
          AND ( (v_tx.amount > 0 AND debit = v_tx.amount) OR (v_tx.amount < 0 AND credit = ABS(v_tx.amount)) )
          AND id NOT IN (SELECT matched_journal_line_id FROM public.bank_transactions WHERE matched_journal_line_id IS NOT NULL)
        LIMIT 1;

        IF v_jl_id IS NOT NULL THEN
            UPDATE public.bank_transactions 
            SET status = 'MATCHED', matched_journal_line_id = v_jl_id
            WHERE id = v_tx.id;
            
            v_match_count := v_match_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'matched_count', v_match_count);
END;
$$;
