-- 20260824090300_fix_check_journal_balance.sql (V12 §19 slice support)
--
-- check_journal_balance was written for journal_entries but attached to journal_lines,
-- where NEW.status/NEW.id don't exist → 42703 'record new has no field status' whenever
-- lines are inserted through paths that fire the trigger (PostgREST). Rewritten against
-- the actual journal_lines shape: verify the PARENT entry balances after this line lands.

CREATE OR REPLACE FUNCTION public.check_journal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_entry RECORD;
    v_total_debit NUMERIC;
    v_total_credit NUMERIC;
BEGIN
    SELECT status INTO v_entry FROM public.journal_entries WHERE id = NEW.journal_entry_id;

    IF NOT FOUND OR v_entry.status IS DISTINCT FROM 'POSTED' THEN
        RETURN NEW; -- only enforce balance on posted entries
    END IF;

    SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
      INTO v_total_debit, v_total_credit
    FROM public.journal_lines
    WHERE journal_entry_id = NEW.journal_entry_id;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Journal entry % is unbalanced: debit % <> credit %',
            NEW.journal_entry_id, v_total_debit, v_total_credit
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;
