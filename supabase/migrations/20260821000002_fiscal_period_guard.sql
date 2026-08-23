-- Migration: fiscal_period_guard
CREATE OR REPLACE FUNCTION public.guard_fiscal_period()
RETURNS TRIGGER AS $$
DECLARE
    v_period_status TEXT;
BEGIN
    SELECT status INTO v_period_status
    FROM public.fiscal_periods
    WHERE agency_id = NEW.agency_id
      AND NEW.entry_date >= start_date
      AND NEW.entry_date <= end_date
    LIMIT 1;

    IF v_period_status = 'CLOSED' OR v_period_status = 'LOCKED' THEN
        RAISE EXCEPTION 'Cannot post journal entry into a closed fiscal period'
        USING ERRCODE = 'P0002';
    END IF;

    -- If no period exists for the date, we might optionally block it, but for now we just guard closed periods.
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_fiscal_period ON public.journal_entries;
CREATE TRIGGER trg_guard_fiscal_period
BEFORE INSERT OR UPDATE OF entry_date, status, total_debit, total_credit
ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.guard_fiscal_period();
