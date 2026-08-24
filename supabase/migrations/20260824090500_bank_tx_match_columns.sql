-- 20260824090500_bank_tx_match_columns.sql (V12 §5.5)
-- auto_reconcile_bank_statement references columns that never existed in this lineage;
-- add the authoritative match bookkeeping it needs.

ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'DEBIT';
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS matched_ledger_line_id uuid REFERENCES public.journal_lines(id);
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS matched_at timestamptz;
ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS matched_by uuid REFERENCES auth.users(id);

ALTER TABLE public.journal_lines ADD COLUMN IF NOT EXISTS is_reconciled boolean NOT NULL DEFAULT false;

ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS ledger_account_id uuid REFERENCES public.chart_of_accounts(id);
