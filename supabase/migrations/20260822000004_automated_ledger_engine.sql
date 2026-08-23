CREATE OR REPLACE FUNCTION public.get_or_create_account(p_agency_id UUID, p_code TEXT, p_name TEXT, p_type TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
DECLARE
    v_acc_id UUID;
BEGIN
    SELECT id INTO v_acc_id FROM public.chart_of_accounts WHERE agency_id = p_agency_id AND code = p_code;
    IF v_acc_id IS NULL THEN
        INSERT INTO public.chart_of_accounts (agency_id, code, name, account_type)
        VALUES (p_agency_id, p_code, p_name, p_type)
        RETURNING id INTO v_acc_id;
    END IF;
    RETURN v_acc_id;
END;
$body$;

-- Trigger function for Invoices
CREATE OR REPLACE FUNCTION public.trg_invoice_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
DECLARE
    v_agency UUID;
    v_ar_acc UUID;
    v_rev_acc UUID;
    v_journal_id UUID;
    v_ref TEXT;
BEGIN
    IF NEW.total_dzd IS NULL OR NEW.total_dzd <= 0 THEN
        RETURN NEW;
    END IF;

    SELECT agency_id INTO v_agency FROM public.bookings WHERE id = NEW.booking_id;
    IF v_agency IS NULL THEN
        RETURN NEW;
    END IF;

    v_ar_acc := public.get_or_create_account(v_agency, '1200', 'Accounts Receivable', 'ASSET');
    v_rev_acc := public.get_or_create_account(v_agency, '4100', 'Sales Revenue', 'REVENUE');

    v_ref := COALESCE(NEW.invoice_number, 'INV-' || substr(NEW.id::text, 1, 8));

    INSERT INTO public.journal_entries (
        agency_id, reference, description, entry_date, status, source_type, source_id, total_debit, total_credit
    ) VALUES (
        v_agency, v_ref, 'System generated for Invoice ' || v_ref, COALESCE(NEW.issued_at, NEW.created_at, NOW())::DATE, 'POSTED', 'INVOICE', NEW.id, NEW.total_dzd, NEW.total_dzd
    ) RETURNING id INTO v_journal_id;

    INSERT INTO public.journal_lines (agency_id, journal_entry_id, account_id, debit, credit, currency_code, memo)
    VALUES 
        (v_agency, v_journal_id, v_ar_acc, NEW.total_dzd, 0, COALESCE(NEW.currency, 'DZD'), 'Invoice AR'),
        (v_agency, v_journal_id, v_rev_acc, 0, NEW.total_dzd, COALESCE(NEW.currency, 'DZD'), 'Invoice Revenue');

    RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS invoice_ledger_trg ON public.invoices;
CREATE TRIGGER invoice_ledger_trg
AFTER INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_to_ledger();


-- Trigger function for Payments
CREATE OR REPLACE FUNCTION public.trg_payment_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
DECLARE
    v_agency UUID;
    v_cash_acc UUID;
    v_ar_acc UUID;
    v_journal_id UUID;
    v_ref TEXT;
    v_booking RECORD;
BEGIN
    IF NEW.amount_dzd IS NULL OR NEW.amount_dzd <= 0 THEN
        RETURN NEW;
    END IF;

    IF NEW.booking_id IS NOT NULL THEN
        SELECT agency_id, branch_id INTO v_booking FROM public.bookings WHERE id = NEW.booking_id;
        v_agency := v_booking.agency_id;
    ELSIF NEW.pilgrim_id IS NOT NULL THEN
        SELECT agency_id INTO v_agency FROM public.pilgrims WHERE id = NEW.pilgrim_id;
    END IF;

    IF v_agency IS NULL THEN
        RETURN NEW;
    END IF;

    v_cash_acc := public.get_or_create_account(v_agency, '1100', 'Cash / Bank', 'ASSET');
    v_ar_acc := public.get_or_create_account(v_agency, '1200', 'Accounts Receivable', 'ASSET');

    v_ref := COALESCE(NEW.receipt_number, NEW.reference, 'PAY-' || substr(NEW.id::text, 1, 8));

    INSERT INTO public.journal_entries (
        agency_id, branch_id, reference, description, entry_date, status, source_type, source_id, total_debit, total_credit
    ) VALUES (
        v_agency, v_booking.branch_id, v_ref, 'System generated for Payment ' || v_ref, COALESCE(NEW.received_at, NEW.created_at, NOW())::DATE, 'POSTED', 'PAYMENT', NEW.id, NEW.amount_dzd, NEW.amount_dzd
    ) RETURNING id INTO v_journal_id;

    INSERT INTO public.journal_lines (agency_id, journal_entry_id, account_id, debit, credit, currency_code, memo)
    VALUES 
        (v_agency, v_journal_id, v_cash_acc, NEW.amount_dzd, 0, COALESCE(NEW.currency, 'DZD'), 'Payment Received'),
        (v_agency, v_journal_id, v_ar_acc, 0, NEW.amount_dzd, COALESCE(NEW.currency, 'DZD'), 'Payment Applied to AR');

    RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS payment_ledger_trg ON public.payments;
CREATE TRIGGER payment_ledger_trg
AFTER INSERT ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_payment_to_ledger();
