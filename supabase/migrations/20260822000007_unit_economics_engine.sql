
-- Add group_id to journal_entries to trace ledger events to operational units.
-- IF NOT EXISTS added because the bare ADD COLUMN made this file unreplayable.
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_journal_entries_group ON public.journal_entries(group_id);

-- The get_group_profitability defined here never worked: it was SECURITY DEFINER
-- with no SET search_path, it had no agency/branch filter (any authenticated
-- caller could read any group's economics), and its body referenced columns and
-- a table that do not exist in this schema -- jl.credit_dzd, jl.debit_dzd,
-- jl.credit_sar, jl.debit_sar, jl.entry_id and a table `accounts`, where the real
-- names are journal_lines.debit / .credit / .journal_entry_id and
-- public.chart_of_accounts.account_type. plpgsql bodies are not name-resolved at
-- CREATE time, so Postgres accepted it and it failed only when called.
-- Dropped here and defined correctly in 20260830120000_crm_vertical_slice.sql,
-- so databases that already applied this migration get the repair too.
DROP FUNCTION IF EXISTS public.get_group_profitability(UUID);
