-- 20260824090600_auto_reconcile_truthful.sql (V12 §5.5)
-- Rewrite matching to the REAL column set: match UNMATCHED bank transactions to unreconciled
-- journal lines of the account by exact amount + date window (+/-3 days), direction-aware,
-- then flag lines reconciled and stamp who/when (§5.5: persist who matched).

CREATE OR REPLACE FUNCTION public.auto_reconcile_bank_statement(p_statement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_agency UUID;
    v_account UUID;
    v_matched_count INT := 0;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    SELECT bs.bank_account_id INTO v_account
    FROM public.bank_statements bs
    WHERE bs.id = p_statement_id AND bs.agency_id = v_agency;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Statement not found or unauthorized' USING ERRCODE = '404';
    END IF;

    UPDATE public.bank_transactions bt
    SET status = 'MATCHED',
        matched_ledger_line_id = sub.jl_id,
        matched_at = NOW(),
        matched_by = auth.uid()
    FROM (
        SELECT bt.id AS bt_id, jl.id AS jl_id
        FROM public.bank_transactions bt
        JOIN public.bank_statements bs ON bs.id = bt.statement_id
        LEFT JOIN public.bank_accounts ba ON ba.id = bs.bank_account_id
        JOIN public.journal_lines jl
          ON jl.account_id = COALESCE(ba.ledger_account_id, jl.account_id)
         AND jl.is_reconciled = false
         AND (
               (bt.type = 'DEBIT'  AND jl.debit  = bt.amount AND jl.credit = 0)
            OR (bt.type = 'CREDIT' AND jl.credit = bt.amount AND jl.debit  = 0)
             )
         AND jl.created_at::DATE BETWEEN (bt.transaction_date - INTERVAL '3 days')::DATE
                                    AND (bt.transaction_date + INTERVAL '3 days')::DATE
        WHERE bt.statement_id = p_statement_id AND bt.status = 'UNMATCHED'
    ) sub
    WHERE bt.id = sub.bt_id;

    GET DIAGNOSTICS v_matched_count = ROW_COUNT;

    UPDATE public.journal_lines
    SET is_reconciled = true
    WHERE id IN (
        SELECT matched_ledger_line_id FROM public.bank_transactions
        WHERE statement_id = p_statement_id AND status = 'MATCHED'
    );

    RETURN jsonb_build_object('success', true, 'matched', v_matched_count);
END;
$fn$;
