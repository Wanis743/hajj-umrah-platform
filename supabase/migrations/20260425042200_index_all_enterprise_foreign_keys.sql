create index if not exists idx_bank_accounts_currency on public.bank_accounts(currency_code);
-- Two relations named in this pass never existed when it was written, and
-- `create index if not exists` on a missing table is an error, not a no-op --
-- so a fresh replay of the ledger stopped here. public.crm_followups is created
-- later (20260830120000, which also creates this index); public.bank_statement_lines
-- was never created at all -- the reconciliation module (20260822000002) calls
-- that table public.bank_transactions. Guarded rather than deleted so the
-- historical intent stays on the record.
do $guard$
begin
  if to_regclass('public.crm_followups') is not null then
    create index if not exists idx_crm_followups_lead on public.crm_followups(lead_id);
  end if;
  if to_regclass('public.bank_statement_lines') is not null then
    create index if not exists idx_bank_statement_lines_currency on public.bank_statement_lines(currency_code);
    create index if not exists idx_bank_statement_lines_matched_payment on public.bank_statement_lines(matched_payment_id);
  end if;
end
$guard$;
create index if not exists idx_chart_of_accounts_currency on public.chart_of_accounts(currency_code);
create index if not exists idx_chart_of_accounts_parent on public.chart_of_accounts(parent_id);
create index if not exists idx_credit_notes_invoice on public.credit_notes(invoice_id);
create index if not exists idx_exchange_rates_quote_currency on public.exchange_rates(quote_currency);
create index if not exists idx_journal_entries_fiscal_period on public.journal_entries(fiscal_period_id);
create index if not exists idx_journal_lines_currency on public.journal_lines(currency_code);
create index if not exists idx_missing_pilgrim_events_group on public.missing_pilgrim_events(group_id);
create index if not exists idx_missing_pilgrim_events_pilgrim on public.missing_pilgrim_events(pilgrim_id);
create index if not exists idx_payment_allocations_invoice on public.payment_allocations(invoice_id);
create index if not exists idx_payment_allocations_payment on public.payment_allocations(payment_id);
create index if not exists idx_supplier_bills_currency on public.supplier_bills(currency_code);
create index if not exists idx_supplier_bills_supplier on public.supplier_bills(supplier_id);
