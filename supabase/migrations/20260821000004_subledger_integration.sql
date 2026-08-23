-- Migration: receive_invoice_payment RPC
CREATE OR REPLACE FUNCTION public.receive_invoice_payment(
    p_invoice_id UUID,
    p_amount NUMERIC,
    p_currency_code TEXT,
    p_payment_date DATE,
    p_reference TEXT,
    p_bank_account_id UUID,
    p_ar_account_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_agency UUID;
    v_payment_id UUID;
    v_journal_id UUID;
    v_invoice_status TEXT;
    v_invoice_total NUMERIC;
    v_invoice_paid NUMERIC;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Check Idempotency to prevent duplicate payments
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_payment_id FROM public.payments WHERE agency_id = v_agency AND idempotency_key = p_idempotency_key;
        IF v_payment_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'duplicate', true);
        END IF;
    END IF;

    -- Get Invoice Details
    SELECT status, amount, amount_paid INTO v_invoice_status, v_invoice_total, v_invoice_paid
    FROM public.invoices
    WHERE id = p_invoice_id AND agency_id = v_agency
    FOR UPDATE; -- Lock for concurrency

    IF v_invoice_status NOT IN ('ISSUED', 'PARTIAL') THEN
        RAISE EXCEPTION 'Invoice is not open for payment' USING ERRCODE = 'P0003';
    END IF;

    -- 1. Create Payment
    INSERT INTO public.payments (
        agency_id,
        amount,
        currency,
        status,
        payment_date,
        reference,
        idempotency_key
    ) VALUES (
        v_agency,
        p_amount,
        p_currency_code,
        'COMPLETED',
        p_payment_date,
        p_reference,
        p_idempotency_key
    ) RETURNING id INTO v_payment_id;

    -- 2. Allocate Payment to Invoice
    INSERT INTO public.payment_allocations (
        agency_id,
        payment_id,
        invoice_id,
        amount
    ) VALUES (
        v_agency,
        v_payment_id,
        p_invoice_id,
        p_amount
    );

    -- 3. Update Invoice Status and Paid Amount
    UPDATE public.invoices
    SET amount_paid = COALESCE(amount_paid, 0) + p_amount,
        status = CASE 
            WHEN COALESCE(amount_paid, 0) + p_amount >= amount THEN 'PAID'
            ELSE 'PARTIAL'
        END
    WHERE id = p_invoice_id;

    -- 4. Create Subledger Journal Entry (DR Bank, CR AR)
    SELECT id INTO v_journal_id FROM public.journal_entries
    WHERE agency_id = v_agency AND idempotency_key = p_idempotency_key;

    IF v_journal_id IS NULL THEN
        INSERT INTO public.journal_entries (
            agency_id, reference, description, entry_date, status, total_debit, total_credit, idempotency_key
        ) VALUES (
            v_agency, p_reference, 'Invoice Payment Receipt', p_payment_date, 'POSTED', p_amount, p_amount, p_idempotency_key
        ) RETURNING id INTO v_journal_id;

        -- DR Bank
        INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency_code, memo)
        VALUES (v_journal_id, p_bank_account_id, p_amount, 0, p_currency_code, 'Payment Receipt');

        -- CR Accounts Receivable
        INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency_code, memo)
        VALUES (v_journal_id, p_ar_account_id, 0, p_amount, p_currency_code, 'Clear AR for Invoice');
    END IF;

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'journal_id', v_journal_id);
END;
$$;
