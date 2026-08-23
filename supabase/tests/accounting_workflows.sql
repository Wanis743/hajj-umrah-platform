-- Read-only accounting workflow invariants; no production writes.
-- These assertions validate the posted journal shapes produced by the ERP.
select 'invoice_journal_balances' as check_name,
       count(*) = 0 as pass
from (
  select je.source_id
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id = je.id
  where je.source_type = 'INVOICE' and je.status = 'POSTED'
  group by je.source_id
  having abs(sum(jl.debit) - sum(jl.credit)) > 0.01
) bad;

select 'posted_journal_has_reference' as check_name,
       count(*) = 0 as pass
from public.journal_entries
where status = 'POSTED' and nullif(trim(reference), '') is null;

select 'posted_journal_has_lines' as check_name,
       count(*) = 0 as pass
from public.journal_entries je
where je.status = 'POSTED'
  and not exists (select 1 from public.journal_lines jl where jl.journal_entry_id = je.id);

select 'balance_sheet_equation' as check_name,
       count(*) = 0 as pass
from public.balance_sheet
where abs(assets - (liabilities + equity)) > 0.01;

select 'fiscal_closed_period_has_no_posted_after_close' as check_name,
       count(*) = 0 as pass
from public.journal_entries je
join public.fiscal_periods fp on fp.id = je.fiscal_period_id
where fp.status = 'CLOSED'
  and je.created_at > coalesce(fp.closed_at, 'infinity'::timestamptz);
