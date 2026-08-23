-- 20260823120000_journal_entry_totals.sql (rebuild-authored, slice-3 support)
--
-- Restores the journal_entries total columns that several accounting RPCs
-- (post_journal_entry, get_recent_journal_entries v2, subledger integration,
-- automated ledger engine) depend on. The original migration that added these
-- columns is not present in the repository's migration history — it was
-- evidently applied to the previous dev database manually. This migration
-- recreates them idempotently so the reviewed accounting-vertical series can
-- apply cleanly to the live database.
--
-- Columns are maintained by trigger: on any journal_lines change, recompute
-- the parent entry's totals from its lines (single source of truth = lines).

ALTER TABLE public.journal_entries
ADD COLUMN IF NOT EXISTS total_debit NUMERIC(18, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_credit NUMERIC(18, 2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.refresh_journal_entry_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_entry_id UUID;
BEGIN
    v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    IF v_entry_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE public.journal_entries je
    SET total_debit = COALESCE(sub.total_debit, 0),
        total_credit = COALESCE(sub.total_credit, 0)
    FROM (
        SELECT SUM(debit) AS total_debit, SUM(credit) AS total_credit
        FROM public.journal_lines
        WHERE journal_entry_id = v_entry_id
    ) AS sub
    WHERE je.id = v_entry_id;

    RETURN NULL; -- AFTER trigger, no row return needed
END;
$body$;

DROP TRIGGER IF EXISTS trg_refresh_journal_totals ON public.journal_lines;
CREATE TRIGGER trg_refresh_journal_totals
AFTER INSERT OR DELETE OR UPDATE OF debit, credit
ON public.journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.refresh_journal_entry_totals();

-- Backfill existing entries from their lines.
UPDATE public.journal_entries je
SET total_debit = COALESCE(sub.total_debit, 0),
    total_credit = COALESCE(sub.total_credit, 0)
FROM (
    SELECT journal_entry_id, SUM(debit) AS total_debit, SUM(credit) AS total_credit
    FROM public.journal_lines
    GROUP BY journal_entry_id
) AS sub
WHERE je.id = sub.journal_entry_id;
