-- 20260822000000_harden_financial_core.sql

-- 1. Ensure invoices table has paid amounts for caching
ALTER TABLE public.invoices
ADD COLUMN IF NOT EXISTS paid_dzd NUMERIC(14,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS paid_sar NUMERIC(14,2) DEFAULT 0;

-- 2. Add trigger to enforce Double-Entry Integrity on journal_lines
CREATE OR REPLACE FUNCTION public.check_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_total_debit NUMERIC;
    v_total_credit NUMERIC;
BEGIN
    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO v_total_debit, v_total_credit
    FROM public.journal_lines
    WHERE journal_entry_id = NEW.journal_entry_id;

    IF v_total_debit != v_total_credit THEN
        RAISE EXCEPTION 'Journal entry % is unbalanced: Dr % vs Cr %', NEW.journal_entry_id, v_total_debit, v_total_credit USING ERRCODE = 'P0004';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_journal_balance ON public.journal_lines;
CREATE CONSTRAINT TRIGGER ensure_journal_balance
AFTER INSERT OR UPDATE ON public.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.check_journal_balance();

-- 3. Prevent modification of posted journals
CREATE OR REPLACE FUNCTION public.protect_posted_journals()
RETURNS TRIGGER AS $$
DECLARE
    v_status TEXT;
BEGIN
    -- For UPDATE or DELETE, we check the OLD record
    IF TG_OP = 'DELETE' THEN
        SELECT status INTO v_status FROM public.journal_entries WHERE id = OLD.journal_entry_id;
        IF v_status = 'POSTED' THEN
            RAISE EXCEPTION 'Cannot delete lines of a POSTED journal entry. Reverse it instead.' USING ERRCODE = 'P0005';
        END IF;
        RETURN OLD;
    END IF;
    
    SELECT status INTO v_status FROM public.journal_entries WHERE id = NEW.journal_entry_id;
    IF v_status = 'POSTED' THEN
        RAISE EXCEPTION 'Cannot modify lines of a POSTED journal entry. Reverse it instead.' USING ERRCODE = 'P0005';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_posted_journals_trg ON public.journal_lines;
CREATE TRIGGER protect_posted_journals_trg
BEFORE UPDATE OR DELETE ON public.journal_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_posted_journals();

-- 4. Fix receive_invoice_payment RPC
CREATE OR REPLACE FUNCTION public.receive_invoice_payment(
    p_invoice_id UUID,
    p_amount NUMERIC,
    p_currency_code TEXT, -- 'DZD' or 'SAR'
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
    v_invoice_total_dzd NUMERIC;
    v_invoice_total_sar NUMERIC;
    v_invoice_paid_dzd NUMERIC;
    v_invoice_paid_sar NUMERIC;
    v_amount_dzd NUMERIC := 0;
    v_amount_sar NUMERIC := 0;
BEGIN
    v_agency := public.current_staff_agency_id();
    IF v_agency IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    IF p_currency_code = 'DZD' THEN
        v_amount_dzd := p_amount;
    ELSIF p_currency_code = 'SAR' THEN
        v_amount_sar := p_amount;
    ELSE
        RAISE EXCEPTION 'Invalid currency code' USING ERRCODE = 'P0001';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_payment_id FROM public.payments WHERE agency_id = v_agency AND idempotency_key = p_idempotency_key;
        IF v_payment_id IS NOT NULL THEN
            RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'duplicate', true);
        END IF;
    END IF;

    SELECT status, total_dzd, total_sar, paid_dzd, paid_sar 
    INTO v_invoice_status, v_invoice_total_dzd, v_invoice_total_sar, v_invoice_paid_dzd, v_invoice_paid_sar
    FROM public.invoices
    WHERE id = p_invoice_id AND agency_id = v_agency
    FOR UPDATE;

    IF v_invoice_status NOT IN ('ISSUED', 'PARTIALLY_PAID') THEN
        RAISE EXCEPTION 'Invoice is not open for payment' USING ERRCODE = 'P0003';
    END IF;

    INSERT INTO public.payments (
        agency_id,
        amount_dzd,
        amount_sar,
        method,
        status,
        received_at,
        reference,
        idempotency_key
    ) VALUES (
        v_agency,
        v_amount_dzd,
        v_amount_sar,
        'BANK_TRANSFER',
        'CONFIRMED',
        p_payment_date,
        p_reference,
        p_idempotency_key
    ) RETURNING id INTO v_payment_id;

    INSERT INTO public.payment_allocations (
        agency_id,
        payment_id,
        invoice_id,
        amount_dzd,
        amount_sar
    ) VALUES (
        v_agency,
        v_payment_id,
        p_invoice_id,
        v_amount_dzd,
        v_amount_sar
    );

    UPDATE public.invoices
    SET paid_dzd = COALESCE(paid_dzd, 0) + v_amount_dzd,
        paid_sar = COALESCE(paid_sar, 0) + v_amount_sar,
        status = CASE 
            WHEN (COALESCE(paid_dzd, 0) + v_amount_dzd >= total_dzd) AND (COALESCE(paid_sar, 0) + v_amount_sar >= total_sar) THEN 'PAID'
            ELSE 'PARTIALLY_PAID'
        END
    WHERE id = p_invoice_id;

    SELECT id INTO v_journal_id FROM public.journal_entries
    WHERE agency_id = v_agency AND idempotency_key = p_idempotency_key;

    IF v_journal_id IS NULL THEN
        INSERT INTO public.journal_entries (
            agency_id, reference, description, entry_date, status, idempotency_key
        ) VALUES (
            v_agency, p_reference, 'Invoice Payment Receipt', p_payment_date, 'POSTED', p_idempotency_key
        ) RETURNING id INTO v_journal_id;

        INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency_code, memo)
        VALUES (v_journal_id, p_bank_account_id, p_amount, 0, p_currency_code, 'Payment Receipt');

        INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, currency_code, memo)
        VALUES (v_journal_id, p_ar_account_id, 0, p_amount, p_currency_code, 'Clear AR for Invoice');
    END IF;

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'journal_id', v_journal_id);
END;
$$;
