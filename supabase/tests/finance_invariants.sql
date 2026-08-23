-- Every posted journal must balance by currency.
select count(*) = 0 as pass from (
  select jl.journal_entry_id, jl.currency_code
  from public.journal_lines jl
  join public.journal_entries je on je.id=jl.journal_entry_id
  group by jl.journal_entry_id, jl.currency_code
  having abs(sum(jl.debit)-sum(jl.credit)) > 0.01
) bad;

-- No sensitive record may be missing agency/branch scope where required.
select (
  (select count(*) from public.bookings where agency_id is null or branch_id is null) = 0 and
  (select count(*) from public.pilgrims where agency_id is null or branch_id is null) = 0 and
  (select count(*) from public.payments where agency_id is null or branch_id is null) = 0 and
  (select count(*) from public.documents where agency_id is null or branch_id is null) = 0 and
  (select count(*) from public.reservations where agency_id is null or branch_id is null) = 0 and
  (select count(*) from public.invoices where agency_id is null or branch_id is null) = 0
) as scoped_pass;
