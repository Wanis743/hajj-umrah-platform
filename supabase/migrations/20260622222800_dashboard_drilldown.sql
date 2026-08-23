create or replace function public.get_dashboard_drilldown(
  p_metric text,
  p_date_from date default null,
  p_date_to date default null,
  p_filter_branch_id uuid default null,
  p_filter_package_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_agency uuid := public.staff_agency_id();
  v_branch uuid;
  v_from timestamptz := coalesce(p_date_from::timestamptz,'-infinity'::timestamptz);
  v_to timestamptz := coalesce((p_date_to+1)::timestamptz,'infinity'::timestamptz);
  v_result jsonb;
begin
  if v_agency is null then raise exception 'Staff scope not found' using errcode='42501'; end if;
  if public.staff_role()<>'ADMIN' then v_branch:=public.staff_branch_id(); else v_branch:=p_filter_branch_id; end if;

  case upper(p_metric)
    when 'ACTIVE_PILGRIMS' then
      select coalesce(jsonb_agg(x order by x.created_at desc),'[]'::jsonb) into v_result from (
        select p.id,p.reference,p.full_name,p.full_name_ar,p.package_id,p.group_id,p.status,p.visa_status,p.payment_status,p.created_at
        from public.pilgrims p where p.agency_id=v_agency and (v_branch is null or p.branch_id=v_branch) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and p.status not in ('CANCELLED','COMPLETED','RETURNED')
        order by p.created_at desc limit 100
      ) x;
    when 'GROUP_READINESS' then
      select coalesce(jsonb_agg(x order by x.readiness_score asc),'[]'::jsonb) into v_result from (
        select g.id,g.code,g.name,g.current_capacity,g.max_capacity,g.readiness_score,g.readiness_details,g.departure_date,g.status
        from public.groups g where g.agency_id=v_agency and (v_branch is null or g.branch_id=v_branch) and (p_filter_package_id is null or g.package_id=p_filter_package_id) and coalesce(g.departure_date,g.created_at)>=v_from and coalesce(g.departure_date,g.created_at)<v_to
        order by g.readiness_score asc limit 100
      ) x;
    when 'AT_RISK_RECEIVABLES' then
      select coalesce(jsonb_agg(x order by x.days_overdue desc,x.balance_dzd desc),'[]'::jsonb) into v_result from (
        select i.id,i.invoice_number,i.due_date,b.reference booking_reference,p.full_name pilgrim_name,pk.name package_name,
          greatest(i.total_dzd-coalesce(a.paid_dzd,0),0) balance_dzd,greatest(i.total_sar-coalesce(a.paid_sar,0),0) balance_sar,
          greatest(current_date-coalesce(i.due_date,current_date),0) days_overdue
        from public.invoices i join public.bookings b on b.id=i.booking_id left join public.pilgrims p on p.id=b.pilgrim_id left join public.packages pk on pk.id=b.package_id
        left join lateral (select coalesce(sum(pa.amount_dzd),0) paid_dzd,coalesce(sum(pa.amount_sar),0) paid_sar from public.payment_allocations pa where pa.invoice_id=i.id) a on true
        where i.agency_id=v_agency and (v_branch is null or i.branch_id=v_branch) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and i.status in ('ISSUED','PARTIALLY_PAID','OVERDUE') and i.due_date<current_date
        order by i.due_date asc limit 100
      ) x;
    when 'REVENUE' then
      select coalesce(jsonb_agg(x order by x.revenue_dzd desc),'[]'::jsonb) into v_result from (
        select pk.id,pk.code,pk.name,
          coalesce((select sum(case when ca.account_type='REVENUE' and jl.currency_code='DZD' then jl.credit-jl.debit else 0 end) from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency and je.package_id=pk.id and je.status='POSTED' and (v_branch is null or je.branch_id=v_branch) and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date)),0) revenue_dzd
        from public.packages pk where pk.agency_id=v_agency and (v_branch is null or pk.branch_id=v_branch) and (p_filter_package_id is null or pk.id=p_filter_package_id)
      ) x;
    when 'COLLECTION' then
      select coalesce(jsonb_agg(x order by x.received_at desc),'[]'::jsonb) into v_result from (
        select p.id,p.reference,p.receipt_number,p.amount_dzd,p.amount_sar,p.received_at,b.reference booking_reference,pk.name package_name,pl.full_name pilgrim_name
        from public.payments p left join public.bookings b on b.id=p.booking_id left join public.packages pk on pk.id=b.package_id left join public.pilgrims pl on pl.id=p.pilgrim_id
        where p.agency_id=v_agency and p.status='CONFIRMED' and (v_branch is null or p.branch_id=v_branch) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and coalesce(p.received_at,p.created_at)>=v_from and coalesce(p.received_at,p.created_at)<v_to
        order by coalesce(p.received_at,p.created_at) desc limit 100
      ) x;
    when 'PROFIT' then
      select coalesce(jsonb_agg(x order by x.profit_dzd desc),'[]'::jsonb) into v_result from (
        select pk.id,pk.code,pk.name,
          coalesce((select sum(case when ca.account_type='REVENUE' and jl.currency_code='DZD' then jl.credit-jl.debit else 0 end) from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency and je.package_id=pk.id and je.status='POSTED' and (v_branch is null or je.branch_id=v_branch) and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date)),0) revenue_dzd,
          coalesce((select sum(case when ca.account_type='EXPENSE' and jl.currency_code='DZD' then jl.debit-jl.credit else 0 end) from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency and je.package_id=pk.id and je.status='POSTED' and (v_branch is null or je.branch_id=v_branch) and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date)),0) expense_dzd,
          coalesce((select sum(case when ca.account_type='REVENUE' and jl.currency_code='DZD' then jl.credit-jl.debit else 0 end) from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency and je.package_id=pk.id and je.status='POSTED' and (v_branch is null or je.branch_id=v_branch) and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date)),0) - coalesce((select sum(case when ca.account_type='EXPENSE' and jl.currency_code='DZD' then jl.debit-jl.credit else 0 end) from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency and je.package_id=pk.id and je.status='POSTED' and (v_branch is null or je.branch_id=v_branch) and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date)),0) profit_dzd
        from public.packages pk where pk.agency_id=v_agency and (v_branch is null or pk.branch_id=v_branch) and (p_filter_package_id is null or pk.id=p_filter_package_id)
      ) x;
    else
      raise exception 'Unsupported dashboard drilldown metric' using errcode='22023';
  end case;
  return v_result;
end;
$$;
revoke all on function public.get_dashboard_drilldown(text,date,date,uuid,uuid) from public,anon;
grant execute on function public.get_dashboard_drilldown(text,date,date,uuid,uuid) to authenticated;
