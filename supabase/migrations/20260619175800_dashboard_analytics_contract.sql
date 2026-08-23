create or replace function public.get_dashboard_analytics_snapshot(
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
  v_agency uuid;
  v_from timestamptz := coalesce(p_date_from::timestamptz,'-infinity'::timestamptz);
  v_to timestamptz := coalesce((p_date_to + 1)::timestamptz,'infinity'::timestamptz);
  v_core jsonb;
  v_snapshot jsonb;
begin
  v_agency := public.staff_agency_id();
  if v_agency is null then raise exception 'Staff scope not found' using errcode='42501'; end if;
  v_core := public.get_dashboard_executive_snapshot(p_date_from,p_date_to,p_filter_branch_id,p_filter_package_id);

  select jsonb_build_object(
    'generated_at',now(),
    'scope',v_core->'scope',
    'core',jsonb_build_object(
      'revenue_dzd',coalesce((v_core->'executive'->>'revenue_dzd')::numeric,0),
      'revenue_sar',coalesce((v_core->'executive'->>'revenue_sar')::numeric,0),
      'collected_dzd',coalesce((v_core->'executive'->>'collected_dzd')::numeric,0),
      'collected_sar',coalesce((v_core->'executive'->>'collected_sar')::numeric,0),
      'pilgrims',coalesce((v_core->'executive'->>'pilgrims')::bigint,0),
      'visa_clearance_rate',coalesce((v_core->'executive'->>'visa_clearance_rate')::numeric,0),
      'booking_confirmation_rate',coalesce((v_core->'executive'->>'booking_confirmation_rate')::numeric,0),
      'group_readiness',coalesce((v_core->'executive'->>'group_readiness')::numeric,0)
    ),
    'series',jsonb_build_object(
      'cash_collections',coalesce((select jsonb_agg(x order by x.date) from (
        select coalesce(p.received_at,p.created_at)::date as date, round(sum(p.amount_dzd),2) amount
        from public.payments p left join public.bookings b on b.id=p.booking_id
        where p.agency_id=v_agency and p.status='CONFIRMED' and (p_filter_branch_id is null or p.branch_id=p_filter_branch_id)
          and (p_filter_package_id is null or b.package_id=p_filter_package_id) and coalesce(p.received_at,p.created_at)>=v_from and coalesce(p.received_at,p.created_at)<v_to
        group by coalesce(p.received_at,p.created_at)::date order by 1
      ) x),'[]'::jsonb),
      'daily_registrations',coalesce((select jsonb_agg(x order by x.date) from (
        select p.created_at::date as date,count(*) count from public.pilgrims p
        where p.agency_id=v_agency and (p_filter_branch_id is null or p.branch_id=p_filter_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) and p.created_at>=v_from and p.created_at<v_to
        group by p.created_at::date order by 1
      ) x),'[]'::jsonb),
      'package_distribution',coalesce((select jsonb_agg(x order by x.count desc,x.name) from (
        select pk.id package_id,coalesce(nullif(pk.name,''),pk.code) name,count(*) count
        from public.pilgrims p join public.packages pk on pk.id=p.package_id
        where p.agency_id=v_agency and p.status not in ('CANCELLED','COMPLETED','RETURNED') and (p_filter_branch_id is null or p.branch_id=p_filter_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id)
        group by pk.id,pk.name,pk.code
      ) x),'[]'::jsonb),
      'payment_methods',coalesce((select jsonb_agg(x order by x.count desc,x.method) from (
        select coalesce(p.method,'UNKNOWN') method,count(*) count from public.payments p left join public.bookings b on b.id=p.booking_id
        where p.agency_id=v_agency and p.status='CONFIRMED' and (p_filter_branch_id is null or p.branch_id=p_filter_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and coalesce(p.received_at,p.created_at)>=v_from and coalesce(p.received_at,p.created_at)<v_to
        group by coalesce(p.method,'UNKNOWN')
      ) x),'[]'::jsonb),
      'age_distribution',coalesce((select jsonb_agg(x order by x.range) from (
        select case when age <= 18 then '0-18' when age <= 30 then '19-30' when age <= 50 then '31-50' when age <= 70 then '51-70' else '71+' end range,count(*) count
        from (
          select extract(year from age(current_date,p.birth_date))::int age from public.pilgrims p
          where p.agency_id=v_agency and p.status not in ('CANCELLED','COMPLETED','RETURNED') and p.birth_date is not null and (p_filter_branch_id is null or p.branch_id=p_filter_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id)
        ) ages group by 1
      ) x),'[]'::jsonb),
      'visa_status',coalesce((select jsonb_agg(x order by x.count desc,x.status) from (
        select coalesce(p.visa_status,'NOT_STARTED') status,count(*) count from public.pilgrims p where p.agency_id=v_agency and p.status not in ('CANCELLED','COMPLETED','RETURNED') and (p_filter_branch_id is null or p.branch_id=p_filter_branch_id) and (p_filter_package_id is null or p.package_id=p_filter_package_id) group by coalesce(p.visa_status,'NOT_STARTED')
      ) x),'[]'::jsonb),
      'booking_status',coalesce((select jsonb_agg(x order by x.count desc,x.status) from (
        select coalesce(b.status,'UNKNOWN') status,count(*) count from public.bookings b where b.agency_id=v_agency and (p_filter_branch_id is null or b.branch_id=p_filter_branch_id) and (p_filter_package_id is null or b.package_id=p_filter_package_id) and b.created_at>=v_from and b.created_at<v_to group by coalesce(b.status,'UNKNOWN')
      ) x),'[]'::jsonb)
    )
  ) into v_snapshot;
  return v_snapshot;
end;
$$;
revoke all on function public.get_dashboard_analytics_snapshot(date,date,uuid,uuid) from public,anon;
grant execute on function public.get_dashboard_analytics_snapshot(date,date,uuid,uuid) to authenticated;
