create or replace view public.trial_balance as
select je.agency_id,je.branch_id,jl.currency_code,ca.code as account_code,ca.name as account_name,ca.account_type,
round(sum(jl.debit-jl.credit),2) as net_balance,round(sum(jl.debit),2) as debit_total,round(sum(jl.credit),2) as credit_total
from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id
where je.status='POSTED' group by je.agency_id,je.branch_id,jl.currency_code,ca.code,ca.name,ca.account_type;
alter view public.trial_balance set (security_invoker=true);

create or replace view public.profit_and_loss as
select agency_id,branch_id,currency_code,
round(sum(case when account_type='REVENUE' then credit_total-debit_total else 0 end),2) revenue,
round(sum(case when account_type='EXPENSE' then debit_total-credit_total else 0 end),2) expenses,
round(sum(case when account_type='REVENUE' then credit_total-debit_total when account_type='EXPENSE' then debit_total-credit_total else 0 end),2) net_income
from public.trial_balance group by agency_id,branch_id,currency_code;
alter view public.profit_and_loss set (security_invoker=true);

create or replace view public.balance_sheet as
select agency_id,branch_id,currency_code,
round(sum(case when account_type='ASSET' then net_balance else 0 end),2) assets,
round(sum(case when account_type='LIABILITY' then -net_balance else 0 end),2) liabilities,
round(sum(case when account_type='EQUITY' then -net_balance else 0 end),2) equity,
round(sum(case when account_type='ASSET' then net_balance when account_type in ('LIABILITY','EQUITY') then net_balance else 0 end),2) balance_check
from public.trial_balance group by agency_id,branch_id,currency_code;
alter view public.balance_sheet set (security_invoker=true);

create or replace view public.cash_flow_summary as
select je.agency_id,je.branch_id,jl.currency_code,
round(sum(case when ca.code in ('1100','1101') then jl.debit-jl.credit else 0 end),2) as cash_net_change
from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id
where je.status='POSTED' group by je.agency_id,je.branch_id,jl.currency_code;
alter view public.cash_flow_summary set (security_invoker=true);

create or replace function public.reconcile_bank_statement(p_reconciliation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.bank_reconciliations%rowtype;
begin
  perform public.require_admin_aal2();
  if not public.has_permission('bank_accounts','update') and public.staff_role()<>'ADMIN' then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into r from public.bank_reconciliations where id=p_reconciliation_id for update;
  if not found or not public.row_in_staff_scope(r.agency_id,r.branch_id) then raise exception 'Reconciliation not found in scope' using errcode='42501'; end if;
  if abs(coalesce(r.difference, r.statement_balance-r.book_balance)) > 0.009 then raise exception 'Reconciliation difference must be zero' using errcode='22023'; end if;
  update public.bank_reconciliations set status='RECONCILED',reconciled_at=now(),reconciled_by=auth.uid(),difference=0 where id=r.id;
  return jsonb_build_object('id',r.id,'status','RECONCILED','difference',0);
end $$;
revoke all on function public.reconcile_bank_statement(uuid) from public,anon;
grant execute on function public.reconcile_bank_statement(uuid) to authenticated;

create or replace view public.pilgrim_duplicate_candidates as
select a.agency_id,a.id pilgrim_a,a.full_name name_a,a.passport_number passport_a,b.id pilgrim_b,b.full_name name_b,b.passport_number passport_b
from public.pilgrims a join public.pilgrims b on b.agency_id=a.agency_id and b.id<>a.id
where a.passport_number is not null and b.passport_number is not null and upper(trim(a.passport_number))=upper(trim(b.passport_number)) and a.id<b.id;
alter view public.pilgrim_duplicate_candidates set (security_invoker=true);

create or replace function public.close_fiscal_period(p_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.fiscal_periods%rowtype;
begin
  perform public.require_admin_aal2();
  if public.staff_role()<>'ADMIN' and not public.has_permission('fiscal_periods','update') then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into f from public.fiscal_periods where id=p_period_id for update;
  if not found or f.agency_id<>public.current_staff_agency_id() then raise exception 'Fiscal period not found' using errcode='42501'; end if;
  update public.fiscal_periods set status='CLOSED',closed_at=now(),closed_by=auth.uid() where id=f.id and status='OPEN';
  return jsonb_build_object('id',f.id,'status','CLOSED');
end $$;
revoke all on function public.close_fiscal_period(uuid) from public,anon;
grant execute on function public.close_fiscal_period(uuid) to authenticated;
