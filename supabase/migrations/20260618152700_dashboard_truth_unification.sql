-- Enterprise dashboard truth unification and KPI registry

create table if not exists public.dashboard_kpi_registry (
  id text primary key,
  definition text not null,
  source text not null,
  formula text not null,
  unit text not null,
  lower_is_better boolean not null default false,
  drilldown_route text,
  owner_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.dashboard_kpi_registry(id,definition,source,formula,unit,lower_is_better,drilldown_route,owner_role) values
('REVENUE_DZD','Posted revenue recognized in the selected accounting period and scope','journal_entries + journal_lines','SUM(REVENUE credits - debits)','DZD',false,'financials','FINANCE'),
('COLLECTION_DZD','Confirmed cash collections received in the selected period and scope','payments','SUM(CONFIRMED amount_dzd)','DZD',false,'financials','FINANCE'),
('NET_PROFIT_DZD','Posted revenue less posted expenses in the selected accounting period and scope','journal_entries + journal_lines','REVENUE - EXPENSES','DZD',false,'financials','FINANCE'),
('ACTIVE_PILGRIMS','Pilgrims currently active in the selected branch/package scope; date filter affects New Pilgrims, not current active stock','pilgrims','COUNT(status not in CANCELLED, COMPLETED, RETURNED)','Count',false,'pilgrims','OPERATIONS'),
('OUTSTANDING_DZD','Current unpaid booking balance for active bookings, independent of booking creation date','bookings','SUM(MAX(total_dzd - paid_dzd,0))','DZD',false,'financials','FINANCE'),
('AT_RISK_RECEIVABLES_DZD','Past-due invoice balance based on payment allocations','invoices + payment_allocations','SUM(MAX(invoice - allocated,0)) where due_date < today','DZD',false,'financials','FINANCE'),
('GROUP_READINESS','Weighted group readiness by current capacity','groups','SUM(readiness * max(current_capacity,1))/SUM(max(current_capacity,1))','Percentage',false,'groups','OPERATIONS'),
('BOOKING_CONFIRMATION_RATE','Confirmed or paid bookings divided by bookings created in period','bookings','confirmed_or_paid / total','Percentage',false,'bookings','COMMERCIAL'),
('VISA_CLEARANCE_RATE','Approved or issued visas divided by visa applications in period','visas + pilgrims','cleared / total','Percentage',false,'visas','COMPLIANCE')
on conflict(id) do update set definition=excluded.definition,source=excluded.source,formula=excluded.formula,unit=excluded.unit,lower_is_better=excluded.lower_is_better,drilldown_route=excluded.drilldown_route,owner_role=excluded.owner_role,updated_at=now();

alter table public.dashboard_kpi_registry enable row level security;
revoke all on public.dashboard_kpi_registry from anon;
grant select on public.dashboard_kpi_registry to authenticated;
drop policy if exists dashboard_kpi_registry_read on public.dashboard_kpi_registry;
create policy dashboard_kpi_registry_read on public.dashboard_kpi_registry for select to authenticated using (true);

create or replace function public.get_dashboard_executive_snapshot(p_date_from date default null,p_date_to date default null,p_filter_branch_id uuid default null,p_filter_package_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_agency_id uuid; v_branch_id uuid; v_is_admin boolean; v_from timestamptz:=coalesce(p_date_from::timestamptz,'-infinity'::timestamptz); v_to timestamptz:=coalesce((p_date_to+1)::timestamptz,'infinity'::timestamptz);
 v_prev_from date; v_prev_to date; v_period_days integer;
 v_pilgrims bigint:=0; v_new_pilgrims bigint:=0; v_confirmed_bookings bigint:=0; v_total_bookings bigint:=0;
 v_collected_dzd numeric:=0; v_collected_sar numeric:=0; v_revenue_dzd numeric:=0; v_revenue_sar numeric:=0; v_expenses_dzd numeric:=0; v_expenses_sar numeric:=0; v_profit_dzd numeric:=0; v_profit_sar numeric:=0;
 v_outstanding_dzd numeric:=0; v_outstanding_sar numeric:=0; v_outstanding_period_dzd numeric:=0; v_outstanding_period_sar numeric:=0;
 v_visa_total bigint:=0; v_visa_cleared bigint:=0; v_flights_delayed bigint:=0; v_incidents_active bigint:=0; v_incidents_critical bigint:=0; v_alerts_pending bigint:=0; v_actions_pending bigint:=0;
 v_avg_readiness numeric:=0; v_weighted_readiness numeric:=0; v_operational_risk numeric:=0; v_group_count bigint:=0; v_active_group_count bigint:=0; v_low_readiness_groups bigint:=0;
 v_leads_total bigint:=0; v_leads_converted bigint:=0; v_duplicate_candidates bigint:=0; v_required_docs bigint:=0; v_validated_docs bigint:=0;
 v_missing_passport bigint:=0; v_missing_phone bigint:=0; v_bookings_without_pilgrim bigint:=0; v_payments_without_booking bigint:=0; v_expired_documents bigint:=0; v_groups_without_guide bigint:=0; v_groups_without_transport bigint:=0;
 v_overdue_receivables_dzd numeric:=0; v_overdue_receivables_sar numeric:=0; v_due_7_days_count bigint:=0; v_overdue_invoice_count bigint:=0;
 v_ar_current_dzd numeric:=0; v_ar_current_sar numeric:=0; v_ar_1_7_dzd numeric:=0; v_ar_1_7_sar numeric:=0; v_ar_8_30_dzd numeric:=0; v_ar_8_30_sar numeric:=0; v_ar_31_60_dzd numeric:=0; v_ar_31_60_sar numeric:=0; v_ar_60_plus_dzd numeric:=0; v_ar_60_plus_sar numeric:=0;
 v_unattributed_revenue_dzd numeric:=0; v_unattributed_revenue_sar numeric:=0; v_unattributed_expenses_dzd numeric:=0; v_unattributed_expenses_sar numeric:=0;
 v_data_health_score numeric:=100; v_package_profitability jsonb:='[]'::jsonb; v_branch_performance jsonb:='[]'::jsonb;
 v_prev_revenue_dzd numeric:=null; v_prev_collected_dzd numeric:=null; v_prev_profit_dzd numeric:=null; v_prev_pilgrims bigint:=null; v_prev_bookings bigint:=null;
 v_projected_revenue_dzd numeric:=null; v_projected_collection_dzd numeric:=null; v_projected_profit_dzd numeric:=null; v_forecast_days_elapsed integer:=null; v_forecast_days_total integer:=null; v_snapshot jsonb;
begin
 v_agency_id:=public.staff_agency_id(); v_is_admin:=public.staff_role()='ADMIN';
 if v_agency_id is null then raise exception 'Staff scope not found' using errcode='42501'; end if;
 if not v_is_admin then v_branch_id:=public.staff_branch_id(); else v_branch_id:=p_filter_branch_id; end if;
 if p_date_from is not null and p_date_to is not null and p_date_to>=p_date_from then v_period_days:=greatest(1,(p_date_to-p_date_from)+1); v_prev_to:=p_date_from-1; v_prev_from:=v_prev_to-(v_period_days-1); end if;

 select count(*) into v_pilgrims from public.pilgrims p where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and p.status not in ('CANCELLED','COMPLETED','RETURNED');
 select count(*) into v_new_pilgrims from public.pilgrims p where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and p.created_at>=v_from and p.created_at<v_to;
 select count(*),count(*) filter(where b.status in ('CONFIRMED','PAID')) into v_total_bookings,v_confirmed_bookings from public.bookings b where b.agency_id=v_agency_id and (v_branch_id is null or b.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and b.created_at>=v_from and b.created_at<v_to;
 select coalesce(sum(p.amount_dzd) filter(where p.status='CONFIRMED'),0),coalesce(sum(p.amount_sar) filter(where p.status='CONFIRMED'),0) into v_collected_dzd,v_collected_sar from public.payments p left join public.bookings b on b.id=p.booking_id where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and coalesce(p.received_at,p.created_at)>=v_from and coalesce(p.received_at,p.created_at)<v_to;

 select coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='REVENUE' then jl.credit-jl.debit else 0 end),0),coalesce(sum(case when jl.currency_code='SAR' and ca.account_type='REVENUE' then jl.credit-jl.debit else 0 end),0),coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='EXPENSE' then jl.debit-jl.credit else 0 end),0),coalesce(sum(case when jl.currency_code='SAR' and ca.account_type='EXPENSE' then jl.debit-jl.credit else 0 end),0) into v_revenue_dzd,v_revenue_sar,v_expenses_dzd,v_expenses_sar from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency_id and (v_branch_id is null or je.branch_id=v_branch_id) and (p_filter_package_id is null or je.package_id=p_filter_package_id) and je.status='POSTED' and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date);
 v_profit_dzd:=v_revenue_dzd-v_expenses_dzd; v_profit_sar:=v_revenue_sar-v_expenses_sar;

 select coalesce(sum(greatest(coalesce(b.total_dzd,0)-coalesce(b.paid_dzd,0),0)),0),coalesce(sum(greatest(coalesce(b.total_sar,0)-coalesce(b.paid_sar,0),0)),0) into v_outstanding_dzd,v_outstanding_sar from public.bookings b where b.agency_id=v_agency_id and (v_branch_id is null or b.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and b.status not in ('CANCELLED','COMPLETED','RETURNED');
 select coalesce(sum(greatest(coalesce(b.total_dzd,0)-coalesce(b.paid_dzd,0),0)),0),coalesce(sum(greatest(coalesce(b.total_sar,0)-coalesce(b.paid_sar,0),0)),0) into v_outstanding_period_dzd,v_outstanding_period_sar from public.bookings b where b.agency_id=v_agency_id and (v_branch_id is null or b.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and b.status not in ('CANCELLED','COMPLETED','RETURNED') and b.created_at>=v_from and b.created_at<v_to;

 select count(*),count(*) filter(where v.status in ('APPROVED','ISSUED')) into v_visa_total,v_visa_cleared from public.visas v join public.pilgrims p on p.id=v.pilgrim_id where v.agency_id=v_agency_id and (v_branch_id is null or v.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and v.created_at>=v_from and v.created_at<v_to;
 select count(*) into v_flights_delayed from public.flights f where f.agency_id=v_agency_id and (v_branch_id is null or f.branch_id=v_branch_id) and f.status='DELAYED' and coalesce(f.scheduled_departure,f.created_at)>=v_from and coalesce(f.scheduled_departure,f.created_at)<v_to;
 select count(*) filter(where i.status not in ('RESOLVED','CLOSED')),count(*) filter(where i.severity='CRITICAL' and i.status not in ('RESOLVED','CLOSED')) into v_incidents_active,v_incidents_critical from public.incidents i where i.agency_id=v_agency_id and (v_branch_id is null or i.branch_id=v_branch_id) and i.created_at>=v_from and i.created_at<v_to;
 select count(*) filter(where not a.acknowledged) into v_alerts_pending from public.alerts a where a.agency_id=v_agency_id and (v_branch_id is null or a.branch_id=v_branch_id) and a.created_at>=v_from and a.created_at<v_to;
 select count(*) filter(where a.status in ('PENDING','IN_PROGRESS')) into v_actions_pending from public.actions a where a.agency_id=v_agency_id and (v_branch_id is null or a.branch_id=v_branch_id) and a.created_at>=v_from and a.created_at<v_to;
 select count(*),count(*) filter(where g.status in ('READY','DEPARTED','IN_SAUDI')),coalesce(avg(nullif(g.readiness_score,0)),0),coalesce(sum(nullif(g.readiness_score,0)*greatest(coalesce(g.current_capacity,0),1))/nullif(sum(greatest(coalesce(g.current_capacity,0),1)),0),0),count(*) filter(where coalesce(g.readiness_score,0)<80) into v_group_count,v_active_group_count,v_avg_readiness,v_weighted_readiness,v_low_readiness_groups from public.groups g where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id) and (p_filter_package_id is null or g.package_id=p_filter_package_id) and coalesce(g.departure_date,g.created_at)>=v_from and coalesce(g.departure_date,g.created_at)<v_to;
 v_operational_risk:=greatest(0,round(100-coalesce(v_weighted_readiness,v_avg_readiness,0),1));
 select count(*),count(*) filter(where l.status='CONVERTED') into v_leads_total,v_leads_converted from public.crm_leads l where l.agency_id=v_agency_id and (v_branch_id is null or l.branch_id=v_branch_id) and l.created_at>=v_from and l.created_at<v_to;
 select count(*) into v_required_docs from public.documents d join public.pilgrims p on p.id=d.pilgrim_id where d.agency_id=v_agency_id and (v_branch_id is null or d.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and d.status in ('REQUIRED','RECEIVED','REJECTED','EXPIRED');
 select count(*) into v_validated_docs from public.documents d join public.pilgrims p on p.id=d.pilgrim_id where d.agency_id=v_agency_id and (v_branch_id is null or d.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and d.status='VALIDATED';
 select count(*) into v_duplicate_candidates from public.pilgrim_duplicate_candidates d where d.agency_id=v_agency_id;
 select count(*) into v_missing_passport from public.pilgrims p where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and p.status not in ('CANCELLED','COMPLETED','RETURNED') and nullif(trim(p.passport_number),'') is null;
 select count(*) into v_missing_phone from public.pilgrims p where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and p.status not in ('CANCELLED','COMPLETED','RETURNED') and nullif(trim(p.phone),'') is null;
 select count(*) into v_bookings_without_pilgrim from public.bookings b where b.agency_id=v_agency_id and (v_branch_id is null or b.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and (b.pilgrim_id is null or not exists(select 1 from public.pilgrims p where p.id=b.pilgrim_id));
 select count(*) into v_payments_without_booking from public.payments p where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p.booking_id is null or not exists(select 1 from public.bookings b where b.id=p.booking_id));
 select count(*) into v_expired_documents from public.documents d join public.pilgrims p on p.id=d.pilgrim_id where d.agency_id=v_agency_id and (v_branch_id is null or d.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and d.expiry_date<current_date and coalesce(d.status,'')<>'VALIDATED';
 select count(*) into v_groups_without_guide from public.groups g where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id) and (p_filter_package_id is null or g.package_id=p_filter_package_id) and coalesce(g.departure_date,g.created_at)>=v_from and coalesce(g.departure_date,g.created_at)<v_to and g.status not in ('RETURNED','CLOSED') and g.guide_id is null;
 select count(*) into v_groups_without_transport from public.groups g where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id) and (p_filter_package_id is null or g.package_id=p_filter_package_id) and coalesce(g.departure_date,g.created_at)>=v_from and coalesce(g.departure_date,g.created_at)<v_to and g.status not in ('RETURNED','CLOSED') and not exists(select 1 from public.transport_assignments ta where ta.group_id=g.id and ta.status not in ('CANCELLED','COMPLETED'));

 select coalesce(sum(greatest(coalesce(i.total_dzd,0)-coalesce(b.paid_dzd,0),0)),0),coalesce(sum(greatest(coalesce(i.total_sar,0)-coalesce(b.paid_sar,0),0)),0),count(*) into v_overdue_receivables_dzd,v_overdue_receivables_sar,v_overdue_invoice_count from public.invoices i join public.bookings b on b.id=i.booking_id where i.agency_id=v_agency_id and (v_branch_id is null or i.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and i.status in ('ISSUED','PARTIALLY_PAID','OVERDUE') and i.due_date<current_date;
 select count(*) into v_due_7_days_count from public.invoices i join public.bookings b on b.id=i.booking_id where i.agency_id=v_agency_id and (v_branch_id is null or i.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and i.status in ('ISSUED','PARTIALLY_PAID','OVERDUE') and i.due_date>=current_date and i.due_date<current_date+7;


 -- AR aging from invoice-level allocations; avoids guessing from invoice count or issue date.
 select
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) <= 0 then greatest(i.total_dzd-coalesce(a.paid_dzd,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) <= 0 then greatest(i.total_sar-coalesce(a.paid_sar,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) between 1 and 7 then greatest(i.total_dzd-coalesce(a.paid_dzd,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) between 1 and 7 then greatest(i.total_sar-coalesce(a.paid_sar,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) between 8 and 30 then greatest(i.total_dzd-coalesce(a.paid_dzd,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) between 8 and 30 then greatest(i.total_sar-coalesce(a.paid_sar,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) between 31 and 60 then greatest(i.total_dzd-coalesce(a.paid_dzd,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) between 31 and 60 then greatest(i.total_sar-coalesce(a.paid_sar,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) > 60 then greatest(i.total_dzd-coalesce(a.paid_dzd,0),0) else 0 end),0),
   coalesce(sum(case when current_date-coalesce(i.due_date,current_date) > 60 then greatest(i.total_sar-coalesce(a.paid_sar,0),0) else 0 end),0)
 into v_ar_current_dzd,v_ar_current_sar,v_ar_1_7_dzd,v_ar_1_7_sar,v_ar_8_30_dzd,v_ar_8_30_sar,v_ar_31_60_dzd,v_ar_31_60_sar,v_ar_60_plus_dzd,v_ar_60_plus_sar
 from public.invoices i
 join public.bookings b on b.id=i.booking_id
 left join lateral (
   select coalesce(sum(pa.amount_dzd),0) paid_dzd,coalesce(sum(pa.amount_sar),0) paid_sar from public.payment_allocations pa where pa.invoice_id=i.id
 ) a on true
 where i.agency_id=v_agency_id and (v_branch_id is null or i.branch_id=v_branch_id)
   and (p_filter_package_id is null or b.package_id=p_filter_package_id)
   and i.status in ('ISSUED','PARTIALLY_PAID','OVERDUE') and coalesce(i.due_date,current_date) is not null;

 -- Accounting attribution coverage: unassigned posted journal lines remain visible as a trust signal.
 select coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='REVENUE' then jl.credit-jl.debit else 0 end),0),
        coalesce(sum(case when jl.currency_code='SAR' and ca.account_type='REVENUE' then jl.credit-jl.debit else 0 end),0)
 into v_unattributed_revenue_dzd,v_unattributed_revenue_sar
 from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id
 where je.agency_id=v_agency_id and (v_branch_id is null or je.branch_id=v_branch_id) and je.status='POSTED' and je.package_id is null
   and ca.account_type='REVENUE' and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date);
 select coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='EXPENSE' then jl.debit-jl.credit else 0 end),0),
        coalesce(sum(case when jl.currency_code='SAR' and ca.account_type='EXPENSE' then jl.debit-jl.credit else 0 end),0)
 into v_unattributed_expenses_dzd,v_unattributed_expenses_sar
 from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id
 where je.agency_id=v_agency_id and (v_branch_id is null or je.branch_id=v_branch_id) and je.status='POSTED' and je.package_id is null
   and ca.account_type='EXPENSE' and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date);

 select coalesce(jsonb_agg(x order by x.revenue_dzd desc,x.code),'[]'::jsonb) into v_package_profitability from (
   select pk.id,pk.code,pk.name,
     (select coalesce(sum(case when ca.account_type='REVENUE' and jl.currency_code='DZD' then jl.credit-jl.debit else 0 end),0)
      from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id
      where je.agency_id=v_agency_id and je.package_id=pk.id and je.status='POSTED' and (v_branch_id is null or je.branch_id=v_branch_id) and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date)) revenue_dzd,
     (select coalesce(sum(case when ca.account_type='EXPENSE' and jl.currency_code='DZD' then jl.debit-jl.credit else 0 end),0)
      from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id
      where je.agency_id=v_agency_id and je.package_id=pk.id and je.status='POSTED' and (v_branch_id is null or je.branch_id=v_branch_id) and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date)) expense_dzd,
     (select count(*) from public.bookings b where b.agency_id=v_agency_id and b.package_id=pk.id and b.status not in ('CANCELLED','COMPLETED','RETURNED') and (v_branch_id is null or b.branch_id=v_branch_id) and b.created_at>=v_from and b.created_at<v_to) bookings,
     (select coalesce(sum(p.amount_dzd) filter(where p.status='CONFIRMED'),0) from public.payments p join public.bookings b on b.id=p.booking_id where p.agency_id=v_agency_id and b.package_id=pk.id and (v_branch_id is null or p.branch_id=v_branch_id) and coalesce(p.received_at,p.created_at)>=v_from and coalesce(p.received_at,p.created_at)<v_to) collected_dzd
   from public.packages pk
   where pk.agency_id=v_agency_id and (v_branch_id is null or pk.branch_id=v_branch_id) and (p_filter_package_id is null or pk.id=p_filter_package_id)
 ) x;

 select coalesce(jsonb_agg(x order by x.revenue_dzd desc,x.code),'[]'::jsonb) into v_branch_performance from (
   select br.id,br.code,br.name,
     (select coalesce(sum(case when ca.account_type='REVENUE' and jl.currency_code='DZD' then jl.credit-jl.debit else 0 end),0) from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency_id and je.branch_id=br.id and je.status='POSTED' and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date) and (p_filter_package_id is null or je.package_id=p_filter_package_id)) revenue_dzd,
     (select coalesce(sum(case when ca.account_type='EXPENSE' and jl.currency_code='DZD' then jl.debit-jl.credit else 0 end),0) from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency_id and je.branch_id=br.id and je.status='POSTED' and je.entry_date>=coalesce(p_date_from,'-infinity'::date) and je.entry_date<=coalesce(p_date_to,'infinity'::date) and (p_filter_package_id is null or je.package_id=p_filter_package_id)) expense_dzd,
     (select count(*) from public.bookings b where b.agency_id=v_agency_id and b.branch_id=br.id and (p_filter_package_id is null or b.package_id=p_filter_package_id) and b.created_at>=v_from and b.created_at<v_to) bookings,
     (select count(*) from public.pilgrims p where p.agency_id=v_agency_id and p.branch_id=br.id and p.status not in ('CANCELLED','COMPLETED','RETURNED') and (p_filter_package_id is null or p.package_id=p_filter_package_id)) pilgrims
   from public.branches br where br.agency_id=v_agency_id and br.is_active and (v_branch_id is null or br.id=v_branch_id)
 ) x;

 if v_prev_from is not null then
  select coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='REVENUE' then jl.credit-jl.debit else 0 end),0),coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='EXPENSE' then jl.debit-jl.credit else 0 end),0) into v_prev_revenue_dzd,v_prev_profit_dzd from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.chart_of_accounts ca on ca.id=jl.account_id where je.agency_id=v_agency_id and (v_branch_id is null or je.branch_id=v_branch_id) and (p_filter_package_id is null or je.package_id=p_filter_package_id) and je.status='POSTED' and je.entry_date between v_prev_from and v_prev_to;
  v_prev_profit_dzd:=v_prev_revenue_dzd-v_prev_profit_dzd;
  select coalesce(sum(p.amount_dzd) filter(where p.status='CONFIRMED'),0) into v_prev_collected_dzd from public.payments p left join public.bookings b on b.id=p.booking_id where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and coalesce(p.received_at,p.created_at)::date between v_prev_from and v_prev_to;
  select count(*) into v_prev_pilgrims from public.pilgrims p where p.agency_id=v_agency_id and (v_branch_id is null or p.branch_id=v_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and p.created_at::date between v_prev_from and v_prev_to;
  select count(*) into v_prev_bookings from public.bookings b where b.agency_id=v_agency_id and (v_branch_id is null or b.branch_id=v_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and b.created_at::date between v_prev_from and v_prev_to;
 end if;
 if p_date_from is not null and p_date_to is not null and p_date_from<=current_date and p_date_to>=current_date and v_period_days>0 then
  v_forecast_days_total:=v_period_days; v_forecast_days_elapsed:=greatest(1,(current_date-p_date_from)+1); v_projected_revenue_dzd:=round(v_revenue_dzd*v_forecast_days_total::numeric/v_forecast_days_elapsed,2); v_projected_collection_dzd:=round(v_collected_dzd*v_forecast_days_total::numeric/v_forecast_days_elapsed,2); v_projected_profit_dzd:=round(v_profit_dzd*v_forecast_days_total::numeric/v_forecast_days_elapsed,2);
 end if;

 select jsonb_build_object(
  'generated_at',now(),
  'scope',jsonb_build_object('agency_id',v_agency_id,'branch_id',v_branch_id,'package_id',p_filter_package_id,'date_from',p_date_from,'date_to',p_date_to),
  'executive',jsonb_build_object('pilgrims',v_pilgrims,'new_pilgrims',v_new_pilgrims,'bookings_total',v_total_bookings,'bookings_confirmed',v_confirmed_bookings,'booking_confirmation_rate',case when v_total_bookings>0 then round(v_confirmed_bookings::numeric/v_total_bookings*100,1) else 0 end,'collected_dzd',round(v_collected_dzd,2),'collected_sar',round(v_collected_sar,2),'revenue_dzd',round(v_revenue_dzd,2),'revenue_sar',round(v_revenue_sar,2),'expenses_dzd',round(v_expenses_dzd,2),'expenses_sar',round(v_expenses_sar,2),'net_profit_dzd',round(v_profit_dzd,2),'net_profit_sar',round(v_profit_sar,2),'outstanding_dzd',round(v_outstanding_dzd,2),'outstanding_sar',round(v_outstanding_sar,2),'outstanding_period_dzd',round(v_outstanding_period_dzd,2),'outstanding_period_sar',round(v_outstanding_period_sar,2),'at_risk_receivables_dzd',round(v_overdue_receivables_dzd,2),'at_risk_receivables_sar',round(v_overdue_receivables_sar,2),'visa_clearance_rate',case when v_visa_total>0 then round(v_visa_cleared::numeric/v_visa_total*100,1) else 0 end,'group_readiness',round(v_weighted_readiness,1),'group_readiness_unweighted',round(v_avg_readiness,1),'operational_risk_score',v_operational_risk,'new_pilgrims',v_new_pilgrims,'at_risk_receivables_dzd',round(v_overdue_receivables_dzd,2),'at_risk_receivables_sar',round(v_overdue_receivables_sar,2),
  'operations',jsonb_build_object('flights_delayed',v_flights_delayed,'incidents_active',v_incidents_active,'incidents_critical',v_incidents_critical,'alerts_pending',v_alerts_pending,'actions_pending',v_actions_pending,'groups_total',v_group_count,'groups_active',v_active_group_count,'groups_low_readiness',v_low_readiness_groups,'visa_total',v_visa_total,'visa_cleared',v_visa_cleared,'documents_required',v_required_docs,'documents_validated',v_validated_docs,'document_completion_rate',case when v_required_docs>0 then round(v_validated_docs::numeric/v_required_docs*100,1) else 0 end),
  'sales',jsonb_build_object('leads_total',v_leads_total,'leads_converted',v_leads_converted,'conversion_rate',case when v_leads_total>0 then round(v_leads_converted::numeric/v_leads_total*100,1) else 0 end),
  'data_health',jsonb_build_object('duplicate_pilgrims',v_duplicate_candidates,'missing_passport',v_missing_passport,'missing_phone',v_missing_phone,'bookings_without_pilgrim',v_bookings_without_pilgrim,'payments_without_booking',v_payments_without_booking,'expired_documents',v_expired_documents,'groups_without_guide',v_groups_without_guide,'groups_without_transport',v_groups_without_transport,'score',greatest(0,round(100 - least(30,(v_duplicate_candidates::numeric/greatest(v_pilgrims,1))*100)*0.5 - least(30,(v_missing_passport::numeric/greatest(v_pilgrims,1))*100)*0.5 - least(30,(v_missing_phone::numeric/greatest(v_pilgrims,1))*100)*0.25 - least(30,(v_bookings_without_pilgrim::numeric/greatest(v_total_bookings,1))*100)*1 - least(30,(v_payments_without_booking::numeric/greatest(v_collected_dzd+v_collected_sar,1))*100)*0.01 - least(30,(v_expired_documents::numeric/greatest(v_required_docs,1))*100)*0.5 - least(30,(v_groups_without_guide::numeric/greatest(v_group_count,1))*100)*0.5 - least(30,(v_groups_without_transport::numeric/greatest(v_group_count,1))*100)*0.5,1))),
  'comparison',jsonb_build_object('period_available',v_prev_from is not null,'previous_period_from',v_prev_from,'previous_period_to',v_prev_to,'revenue_dzd',v_prev_revenue_dzd,'collected_dzd',v_prev_collected_dzd,'net_profit_dzd',v_prev_profit_dzd,'new_pilgrims',v_prev_pilgrims,'bookings',v_prev_bookings),
  'ar_aging',jsonb_build_object('current_dzd',round(v_ar_current_dzd,2),'current_sar',round(v_ar_current_sar,2),'1_7_dzd',round(v_ar_1_7_dzd,2),'1_7_sar',round(v_ar_1_7_sar,2),'8_30_dzd',round(v_ar_8_30_dzd,2),'8_30_sar',round(v_ar_8_30_sar,2),'31_60_dzd',round(v_ar_31_60_dzd,2),'31_60_sar',round(v_ar_31_60_sar,2),'60_plus_dzd',round(v_ar_60_plus_dzd,2),'60_plus_sar',round(v_ar_60_plus_sar,2)),
  'accounting_trust',jsonb_build_object('unattributed_revenue_dzd',round(v_unattributed_revenue_dzd,2),'unattributed_revenue_sar',round(v_unattributed_revenue_sar,2),'unattributed_expenses_dzd',round(v_unattributed_expenses_dzd,2),'unattributed_expenses_sar',round(v_unattributed_expenses_sar,2)),
  'package_profitability',v_package_profitability,
  'branch_performance',v_branch_performance,
  'targets',jsonb_build_object('revenue_dzd',(select max(t.target_numeric) from public.dashboard_kpi_targets t where t.agency_id=v_agency_id and (t.branch_id is null or t.branch_id=v_branch_id) and (p_filter_package_id is null or t.package_id is null or t.package_id=p_filter_package_id) and t.metric='REVENUE_DZD' and t.is_active and t.start_date<=coalesce(p_date_to,current_date) and t.end_date>=coalesce(p_date_from,current_date)),'collection_dzd',(select max(t.target_numeric) from public.dashboard_kpi_targets t where t.agency_id=v_agency_id and (t.branch_id is null or t.branch_id=v_branch_id) and (p_filter_package_id is null or t.package_id is null or t.package_id=p_filter_package_id) and t.metric='COLLECTION_DZD' and t.is_active and t.start_date<=coalesce(p_date_to,current_date) and t.end_date>=coalesce(p_date_from,current_date)),'profit_dzd',(select max(t.target_numeric) from public.dashboard_kpi_targets t where t.agency_id=v_agency_id and (t.branch_id is null or t.branch_id=v_branch_id) and (p_filter_package_id is null or t.package_id is null or t.package_id=p_filter_package_id) and t.metric='PROFIT_DZD' and t.is_active and t.start_date<=coalesce(p_date_to,current_date) and t.end_date>=coalesce(p_date_from,current_date)),'pilgrims',(select max(t.target_numeric) from public.dashboard_kpi_targets t where t.agency_id=v_agency_id and (t.branch_id is null or t.branch_id=v_branch_id) and (p_filter_package_id is null or t.package_id is null or t.package_id=p_filter_package_id) and t.metric='PILGRIMS' and t.is_active and t.start_date<=coalesce(p_date_to,current_date) and t.end_date>=coalesce(p_date_from,current_date))),
  'projection',jsonb_build_object('available',v_projected_revenue_dzd is not null,'days_elapsed',v_forecast_days_elapsed,'days_total',v_forecast_days_total,'projected_revenue_dzd',v_projected_revenue_dzd,'projected_collection_dzd',v_projected_collection_dzd,'projected_profit_dzd',v_projected_profit_dzd),
  'groups_at_risk',coalesce((select jsonb_agg(x order by x.readiness_score asc,x.code) from (select g.code,g.readiness_score,g.current_capacity,g.max_capacity,g.readiness_details from public.groups g where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id) and (p_filter_package_id is null or g.package_id=p_filter_package_id) and g.readiness_score<80 and coalesce(g.departure_date,g.created_at)>=v_from and coalesce(g.departure_date,g.created_at)<v_to order by g.readiness_score asc,g.code limit 8) x),'[]'::jsonb),
  'alerts',coalesce((select jsonb_agg(a order by a.created_at desc) from (select id,severity,type,message,acknowledged,created_at from public.alerts where agency_id=v_agency_id and (v_branch_id is null or branch_id=v_branch_id) and not acknowledged and created_at>=v_from and created_at<v_to order by created_at desc limit 8) a),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(a order by a.created_at desc) from (select id,action,resource,resource_id,user_email,details,coalesce(timestamp,created_at) as created_at from public.audit_logs where agency_id=v_agency_id and (v_branch_id is null or branch_id=v_branch_id) and coalesce(timestamp,created_at)>=v_from and coalesce(timestamp,created_at)<v_to order by coalesce(timestamp,created_at) desc limit 10) a),'[]'::jsonb),
  'packages',coalesce((select jsonb_agg(p order by p.start_date nulls last,p.name) from (select id,code,name,name_ar,start_date,end_date,status from public.packages where agency_id=v_agency_id and (v_branch_id is null or branch_id=v_branch_id) and status<>'ARCHIVED' order by start_date nulls last,name limit 100) p),'[]'::jsonb),
  'branches',coalesce((select jsonb_agg(b order by b.name) from public.branches b where b.agency_id=v_agency_id and b.is_active),'[]'::jsonb),
  'upcoming',jsonb_build_object('flights',(select count(*) from public.flights f where f.agency_id=v_agency_id and (v_branch_id is null or f.branch_id=v_branch_id) and f.scheduled_departure>=now() and f.scheduled_departure<now()+interval '7 days' and f.status not in ('CANCELLED','LANDED')),'groups',(select count(*) from public.groups g where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id) and g.departure_date>=current_date and g.departure_date<current_date+7 and g.status not in ('RETURNED','CLOSED') and (p_filter_package_id is null or g.package_id=p_filter_package_id)),'payment_deadlines',v_due_7_days_count,'overdue_payments',v_overdue_invoice_count)
 ) into v_snapshot;
 return v_snapshot;
end; $$;
revoke all on function public.get_dashboard_executive_snapshot(date,date,uuid,uuid) from public,anon;
grant execute on function public.get_dashboard_executive_snapshot(date,date,uuid,uuid) to authenticated;
