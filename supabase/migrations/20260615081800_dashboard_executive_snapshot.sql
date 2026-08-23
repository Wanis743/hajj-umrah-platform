-- Executive dashboard data contract.
-- Aggregates KPI truth server-side, scoped to the authenticated staff agency/branch.

create or replace function public.get_dashboard_executive_snapshot(
  p_date_from date default null,
  p_date_to date default null,
  p_filter_branch_id uuid default null,
  p_filter_package_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_branch_id uuid;
  v_is_admin boolean;
  v_from timestamptz := coalesce(p_date_from::timestamptz, '-infinity'::timestamptz);
  v_to timestamptz := coalesce((p_date_to + 1)::timestamptz, 'infinity'::timestamptz);
  v_pilgrims bigint := 0;
  v_confirmed_bookings bigint := 0;
  v_total_bookings bigint := 0;
  v_collected_dzd numeric := 0;
  v_collected_sar numeric := 0;
  v_revenue_dzd numeric := 0;
  v_revenue_sar numeric := 0;
  v_expenses_dzd numeric := 0;
  v_expenses_sar numeric := 0;
  v_profit_dzd numeric := 0;
  v_profit_sar numeric := 0;
  v_outstanding_dzd numeric := 0;
  v_outstanding_sar numeric := 0;
  v_visa_total bigint := 0;
  v_visa_cleared bigint := 0;
  v_flights_delayed bigint := 0;
  v_incidents_active bigint := 0;
  v_incidents_critical bigint := 0;
  v_alerts_pending bigint := 0;
  v_actions_pending bigint := 0;
  v_avg_readiness numeric := 0;
  v_group_count bigint := 0;
  v_active_group_count bigint := 0;
  v_leads_total bigint := 0;
  v_leads_converted bigint := 0;
  v_duplicate_candidates bigint := 0;
  v_required_docs bigint := 0;
  v_validated_docs bigint := 0;
  v_snapshot jsonb;
begin
  v_agency_id := public.staff_agency_id();
  v_is_admin := public.staff_role() = 'ADMIN';
  if v_agency_id is null then
    raise exception 'Staff scope not found' using errcode = '42501';
  end if;
  if not v_is_admin then
    v_branch_id := public.staff_branch_id();
  else
    v_branch_id := p_filter_branch_id;
  end if;

  select count(*) into v_pilgrims
  from public.pilgrims p
  where p.agency_id = v_agency_id
    and (v_branch_id is null or p.branch_id = v_branch_id)
    and (p_filter_package_id is null or p.package_id = p_filter_package_id)
    and p.status not in ('CANCELLED','COMPLETED','RETURNED')
    and p.created_at >= v_from and p.created_at < v_to;

  select count(*), count(*) filter (where b.status in ('CONFIRMED','PAID'))
    into v_total_bookings, v_confirmed_bookings
  from public.bookings b
  where b.agency_id = v_agency_id
    and (v_branch_id is null or b.branch_id = v_branch_id)
    and (p_filter_package_id is null or b.package_id = p_filter_package_id)
    and b.created_at >= v_from and b.created_at < v_to;

  select coalesce(sum(p.amount_dzd) filter (where p.status = 'CONFIRMED'),0),
         coalesce(sum(p.amount_sar) filter (where p.status = 'CONFIRMED'),0)
    into v_collected_dzd, v_collected_sar
  from public.payments p
  left join public.bookings b on b.id = p.booking_id
  where p.agency_id = v_agency_id
    and (v_branch_id is null or p.branch_id = v_branch_id)
    and (p_filter_package_id is null or b.package_id = p_filter_package_id)
    and coalesce(p.received_at,p.created_at) >= v_from
    and coalesce(p.received_at,p.created_at) < v_to;

  select coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='REVENUE' then jl.credit-jl.debit else 0 end),0),
         coalesce(sum(case when jl.currency_code='SAR' and ca.account_type='REVENUE' then jl.credit-jl.debit else 0 end),0),
         coalesce(sum(case when jl.currency_code='DZD' and ca.account_type='EXPENSE' then jl.debit-jl.credit else 0 end),0),
         coalesce(sum(case when jl.currency_code='SAR' and ca.account_type='EXPENSE' then jl.debit-jl.credit else 0 end),0)
    into v_revenue_dzd, v_revenue_sar, v_expenses_dzd, v_expenses_sar
  from public.journal_entries je
  join public.journal_lines jl on jl.journal_entry_id=je.id
  join public.chart_of_accounts ca on ca.id=jl.account_id
  where je.agency_id=v_agency_id
    and (v_branch_id is null or je.branch_id=v_branch_id)
    and je.status='POSTED'
    and je.entry_date >= coalesce(p_date_from, '-infinity'::date)
    and je.entry_date <= coalesce(p_date_to, 'infinity'::date);
  v_profit_dzd := v_revenue_dzd - v_expenses_dzd;
  v_profit_sar := v_revenue_sar - v_expenses_sar;

  select coalesce(sum(greatest(coalesce(b.total_dzd,0) - coalesce(b.paid_dzd,0),0)),0),
         coalesce(sum(greatest(coalesce(b.total_sar,0) - coalesce(b.paid_sar,0),0)),0)
    into v_outstanding_dzd, v_outstanding_sar
  from public.bookings b
  where b.agency_id=v_agency_id and (v_branch_id is null or b.branch_id=v_branch_id)
    and (p_filter_package_id is null or b.package_id=p_filter_package_id)
    and b.status <> 'CANCELLED'
    and b.created_at >= v_from and b.created_at < v_to;

  select count(*), count(*) filter (where status in ('APPROVED','ISSUED'))
    into v_visa_total, v_visa_cleared
  from public.visas v
  join public.pilgrims p on p.id=v.pilgrim_id
  where v.agency_id=v_agency_id and (v_branch_id is null or v.branch_id=v_branch_id)
    and (p_filter_package_id is null or p.package_id=p_filter_package_id)
    and v.created_at >= v_from and v.created_at < v_to;

  select count(*) into v_flights_delayed
  from public.flights f
  where f.agency_id=v_agency_id and (v_branch_id is null or f.branch_id=v_branch_id)
    and f.status='DELAYED' and coalesce(f.scheduled_departure,f.created_at) >= v_from and coalesce(f.scheduled_departure,f.created_at) < v_to;

  select count(*) filter (where status not in ('RESOLVED','CLOSED')),
         count(*) filter (where severity='CRITICAL' and status not in ('RESOLVED','CLOSED'))
    into v_incidents_active, v_incidents_critical
  from public.incidents i
  where i.agency_id=v_agency_id and (v_branch_id is null or i.branch_id=v_branch_id)
    and i.created_at >= v_from and i.created_at < v_to;

  select count(*) filter (where not acknowledged)
    into v_alerts_pending
  from public.alerts a
  where a.agency_id=v_agency_id and (v_branch_id is null or a.branch_id=v_branch_id)
    and a.created_at >= v_from and a.created_at < v_to;

  select count(*) filter (where status in ('PENDING','IN_PROGRESS'))
    into v_actions_pending
  from public.actions a
  where a.agency_id=v_agency_id and (v_branch_id is null or a.branch_id=v_branch_id)
    and a.created_at >= v_from and a.created_at < v_to;

  select count(*), count(*) filter (where status in ('READY','DEPARTED','IN_SAUDI')),
         coalesce(avg(nullif(readiness_score,0)),0)
    into v_group_count, v_active_group_count, v_avg_readiness
  from public.groups g
  where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id)
    and (p_filter_package_id is null or g.package_id=p_filter_package_id)
    and coalesce(g.departure_date,g.created_at) >= v_from and coalesce(g.departure_date,g.created_at) < v_to;

  select count(*), count(*) filter (where status='CONVERTED')
    into v_leads_total, v_leads_converted
  from public.crm_leads l
  where l.agency_id=v_agency_id and (v_branch_id is null or l.branch_id=v_branch_id)
    and l.created_at >= v_from and l.created_at < v_to;

  select count(*) into v_required_docs
  from public.documents d join public.pilgrims p on p.id=d.pilgrim_id
  where d.agency_id=v_agency_id and (v_branch_id is null or d.branch_id=v_branch_id)
    and (p_filter_package_id is null or p.package_id=p_filter_package_id) and d.status in ('REQUIRED','RECEIVED','REJECTED','EXPIRED');
  select count(*) into v_validated_docs
  from public.documents d join public.pilgrims p on p.id=d.pilgrim_id
  where d.agency_id=v_agency_id and (v_branch_id is null or d.branch_id=v_branch_id)
    and (p_filter_package_id is null or p.package_id=p_filter_package_id) and d.status='VALIDATED';

  select count(*) into v_duplicate_candidates from public.pilgrim_duplicate_candidates d where d.agency_id=v_agency_id;

  select jsonb_build_object(
    'generated_at', now(),
    'scope', jsonb_build_object('agency_id',v_agency_id,'branch_id',v_branch_id,'package_id',p_filter_package_id,'date_from',p_date_from,'date_to',p_date_to),
    'executive', jsonb_build_object(
      'pilgrims',v_pilgrims,
      'bookings_total',v_total_bookings,
      'bookings_confirmed',v_confirmed_bookings,
      'booking_confirmation_rate',case when v_total_bookings > 0 then round(v_confirmed_bookings::numeric/v_total_bookings*100,1) else 0 end,
      'collected_dzd',round(v_collected_dzd,2),'collected_sar',round(v_collected_sar,2),
      'revenue_dzd',round(v_revenue_dzd,2),'revenue_sar',round(v_revenue_sar,2),
      'expenses_dzd',round(v_expenses_dzd,2),'expenses_sar',round(v_expenses_sar,2),
      'net_profit_dzd',round(v_profit_dzd,2),'net_profit_sar',round(v_profit_sar,2),
      'outstanding_dzd',round(v_outstanding_dzd,2),'outstanding_sar',round(v_outstanding_sar,2),
      'visa_clearance_rate',case when v_visa_total > 0 then round(v_visa_cleared::numeric/v_visa_total*100,1) else 0 end,
      'group_readiness',round(v_avg_readiness,1)
    ),
    'operations', jsonb_build_object(
      'flights_delayed',v_flights_delayed,'incidents_active',v_incidents_active,'incidents_critical',v_incidents_critical,
      'alerts_pending',v_alerts_pending,'actions_pending',v_actions_pending,'groups_total',v_group_count,'groups_active',v_active_group_count,
      'visa_total',v_visa_total,'visa_cleared',v_visa_cleared,'documents_required',v_required_docs,'documents_validated',v_validated_docs,
      'document_completion_rate',case when v_required_docs > 0 then round(v_validated_docs::numeric/v_required_docs*100,1) else 0 end
    ),
    'sales', jsonb_build_object('leads_total',v_leads_total,'leads_converted',v_leads_converted,'conversion_rate',case when v_leads_total>0 then round(v_leads_converted::numeric/v_leads_total*100,1) else 0 end),
    'data_health', jsonb_build_object('duplicate_pilgrims',v_duplicate_candidates),
    'groups_at_risk',coalesce((select jsonb_agg(x order by x.readiness_score asc, x.code) from (
      select g.code,g.readiness_score,g.current_capacity,g.max_capacity,g.readiness_details
      from public.groups g
      where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id)
        and (p_filter_package_id is null or g.package_id=p_filter_package_id)
        and g.readiness_score < 80
      order by g.readiness_score asc, g.code limit 8
    ) x),'[]'::jsonb),
    'alerts',coalesce((select jsonb_agg(a order by a.created_at desc) from (
      select id,severity,type,message,acknowledged,created_at from public.alerts
      where agency_id=v_agency_id and (v_branch_id is null or branch_id=v_branch_id) and not acknowledged
      order by created_at desc limit 8
    ) a),'[]'::jsonb),
    'activity',coalesce((select jsonb_agg(a order by a.created_at desc) from (
      select id,action,resource,resource_id,user_email,details,coalesce(timestamp,created_at) as created_at
      from public.audit_logs
      where agency_id=v_agency_id and (v_branch_id is null or branch_id=v_branch_id)
      order by coalesce(timestamp,created_at) desc limit 10
    ) a),'[]'::jsonb),
    'packages',coalesce((select jsonb_agg(p order by p.start_date nulls last,p.name) from (
      select id,code,name,name_ar,start_date,end_date,status from public.packages
      where agency_id=v_agency_id and (v_branch_id is null or branch_id=v_branch_id) and status <> 'ARCHIVED'
      order by start_date nulls last,name limit 100
    ) p),'[]'::jsonb),
    'branches',coalesce((select jsonb_agg(b order by b.name) from public.branches b where b.agency_id=v_agency_id and b.is_active),'[]'::jsonb),
    'upcoming',jsonb_build_object(
      'flights', (select count(*) from public.flights f where f.agency_id=v_agency_id and (v_branch_id is null or f.branch_id=v_branch_id) and f.scheduled_departure >= now() and f.scheduled_departure < now()+interval '7 days' and f.status not in ('CANCELLED','LANDED')),
      'groups', (select count(*) from public.groups g where g.agency_id=v_agency_id and (v_branch_id is null or g.branch_id=v_branch_id) and g.departure_date >= now() and g.departure_date < now()+interval '7 days' and g.status not in ('RETURNED','CLOSED')),
      'payment_deadlines', (select count(*) from public.invoices i where i.agency_id=v_agency_id and (v_branch_id is null or i.branch_id=v_branch_id) and i.status in ('ISSUED','PARTIALLY_PAID','OVERDUE') and coalesce(i.issued_at,i.created_at) >= now()-interval '30 days')
    )
  ) into v_snapshot;

  return v_snapshot;
end;
$$;

revoke all on function public.get_dashboard_executive_snapshot(date,date,uuid,uuid) from public, anon;
grant execute on function public.get_dashboard_executive_snapshot(date,date,uuid,uuid) to authenticated;
