-- 20260823120200_journal_line_agency_stamp.sql (rebuild-authored, slice-3 support)
--
-- The reviewed post_journal_entry RPC inserts journal_lines without agency_id,
-- but the live table declares it NOT NULL (the previous dev database evidently
-- differed). Rather than weakening the constraint, stamp the dimension from the
-- parent entry inside a BEFORE INSERT trigger -- single source of truth stays
-- the journal_entries row (spec section 15: every posting carries agency scope).

CREATE OR REPLACE FUNCTION public.stamp_journal_line_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_entry public.journal_entries%ROWTYPE;
BEGIN
    IF NEW.journal_entry_id IS NULL THEN
        RAISE EXCEPTION 'journal_line requires journal_entry_id' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_entry FROM public.journal_entries WHERE id = NEW.journal_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'journal_entry % not found', NEW.journal_entry_id USING ERRCODE = 'P0002';
    END IF;

    IF NEW.agency_id IS NULL THEN
        NEW.agency_id := v_entry.agency_id;
    END IF;
    IF NEW.branch_id IS NULL THEN
        NEW.branch_id := v_entry.branch_id;
    END IF;

    RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_stamp_journal_line_scope ON public.journal_lines;
CREATE TRIGGER trg_stamp_journal_line_scope
BEFORE INSERT ON public.journal_lines
FOR EACH ROW
EXECUTE FUNCTION public.stamp_journal_line_scope();
