-- Fix post_journal_entry RPC
CREATE OR REPLACE FUNCTION public.post_journal_entry(
    p_reference TEXT,
    p_description TEXT,
    p_entry_date DATE,
    p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_agency UUID;
    v_journal_id UUID;
    v_total_debit NUMERIC := 0;
    v_total_credit NUMERIC := 0;
    v_line JSONB;
    v_acc_agency UUID;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Validate Debit = Credit
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_total_debit := v_total_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
        v_total_credit := v_total_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);

        SELECT agency_id INTO v_acc_agency FROM public.chart_of_accounts WHERE id = (v_line->>'account_id')::UUID;
        IF v_acc_agency IS NULL OR v_acc_agency <> v_agency THEN
            RAISE EXCEPTION 'Invalid account ID %', v_line->>'account_id' USING ERRCODE = 'P0002';
        END IF;
    END LOOP;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Debit and Credit must be equal (Debit: %, Credit: %)', v_total_debit, v_total_credit USING ERRCODE = 'P0001';
    END IF;

    IF v_total_debit = 0 THEN
        RAISE EXCEPTION 'Journal entry must have non-zero amounts' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.journal_entries (
        agency_id, reference, description, entry_date, status, total_debit, total_credit
    ) VALUES (
        v_agency, p_reference, p_description, p_entry_date, 'DRAFT', v_total_debit, v_total_credit
    ) RETURNING id INTO v_journal_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        INSERT INTO public.journal_lines (
            journal_entry_id, account_id, debit, credit, currency_code, memo, branch_id, package_id
        ) VALUES (
            v_journal_id,
            (v_line->>'account_id')::UUID,
            COALESCE((v_line->>'debit')::NUMERIC, 0),
            COALESCE((v_line->>'credit')::NUMERIC, 0),
            COALESCE(v_line->>'currency_code', 'SAR'),
            v_line->>'memo',
            NULLIF(v_line->>'branch_id', '')::UUID,
            NULLIF(v_line->>'package_id', '')::UUID
        );
    END LOOP;

    RETURN jsonb_build_object('success', true, 'journal_id', v_journal_id);
END;
$body$;

CREATE OR REPLACE FUNCTION public.auto_reconcile_bank_statement(p_statement_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_agency UUID;
    v_statement RECORD;
    v_matched_count INT := 0;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    SELECT bs.*, ba.ledger_account_id 
    INTO v_statement 
    FROM public.bank_statements bs
    JOIN public.bank_accounts ba ON bs.bank_account_id = ba.id
    WHERE bs.id = p_statement_id AND bs.agency_id = v_agency;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Statement not found or unauthorized' USING ERRCODE = '404';
    END IF;

    UPDATE public.bank_transactions bt
    SET status = 'MATCHED', matched_ledger_line_id = sub.jl_id, matched_at = NOW(), matched_by = auth.uid()
    FROM (
        SELECT bt.id as bt_id, jl.id as jl_id
        FROM public.bank_transactions bt
        JOIN public.journal_lines jl ON 
            jl.account_id = v_statement.ledger_account_id
            AND jl.is_reconciled = false
            AND (
               (bt.type = 'DEBIT' AND jl.debit = bt.amount AND jl.credit = 0)
               OR (bt.type = 'CREDIT' AND jl.credit = bt.amount AND jl.debit = 0)
            )
            AND jl.created_at::DATE BETWEEN (bt.transaction_date - INTERVAL '3 days')::DATE AND (bt.transaction_date + INTERVAL '3 days')::DATE
        WHERE bt.statement_id = p_statement_id AND bt.status = 'UNMATCHED'
    ) sub
    WHERE bt.id = sub.bt_id;

    GET DIAGNOSTICS v_matched_count = ROW_COUNT;

    UPDATE public.journal_lines
    SET is_reconciled = true
    WHERE id IN (
        SELECT matched_ledger_line_id FROM public.bank_transactions WHERE statement_id = p_statement_id AND status = 'MATCHED'
    );

    RETURN jsonb_build_object('success', true, 'matched', v_matched_count);
END;
$body$;
