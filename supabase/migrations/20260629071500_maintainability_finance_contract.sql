-- Maintainability: make finance summary status counts first-class and keep the
-- financial reporting contract independent from paginated UI rows.
create or replace function public.get_finance_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_branch_id uuid default null,
  p_package_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_agency uuid := public.staff_agency_id();
  v_branch uuid;
  v_result jsonb;
begin
  if v_agency is null then raise exception 'Staff scope not found' using errcode='42501'; end if;
  if public.staff_role() <> 'ADMIN' then v_branch := public.staff_branch_id(); else v_branch := p_branch_id; end if;

  select jsonb_build_object(
    'agency_id', v_agency,
    'branch_id', v_branch,
    'package_id', p_package_id,
    'date_from', p_date_from,
    'date_to', p_date_to,
    'counts', jsonb_build_object(
      'confirmed', count(*) filter (where p.status='CONFIRMED'),
      'pending', count(*) filter (where p.status='PENDING'),
      'failed', count(*) filter (where p.status='FAILED'),
      'refunded', count(*) filter (where p.status='REFUNDED'),
      'total', count(*)
    ),
    'currency', jsonb_build_object(
      'DZD', jsonb_build_object(
        'confirmed', coalesce(sum(p.amount_dzd) filter(where p.status='CONFIRMED'),0),
        'pending', coalesce(sum(p.amount_dzd) filter(where p.status='PENDING'),0),
        'failed', coalesce(sum(p.amount_dzd) filter(where p.status='FAILED'),0),
        'refunded', coalesce(sum(p.amount_dzd) filter(where p.status='REFUNDED'),0),
        'total', coalesce(sum(p.amount_dzd),0),
        'count', count(*)
      ),
      'SAR', jsonb_build_object(
        'confirmed', coalesce(sum(p.amount_sar) filter(where p.status='CONFIRMED'),0),
        'pending', coalesce(sum(p.amount_sar) filter(where p.status='PENDING'),0),
        'failed', coalesce(sum(p.amount_sar) filter(where p.status='FAILED'),0),
        'refunded', coalesce(sum(p.amount_sar) filter(where p.status='REFUNDED'),0),
        'total', coalesce(sum(p.amount_sar),0),
        'count', count(*)
      )
    )
  ) into v_result
  from public.payments p
  left join public.bookings b on b.id=p.booking_id
  where p.agency_id=v_agency
    and (v_branch is null or p.branch_id=v_branch)
    and (p_package_id is null or b.package_id=p_package_id)
    and (p_date_from is null or coalesce(p.received_at,p.created_at)::date >= p_date_from)
    and (p_date_to is null or coalesce(p.received_at,p.created_at)::date <= p_date_to);

  return v_result;
end;
$$;

revoke all on function public.get_finance_summary(date,date,uuid,uuid) from public,anon;
grant execute on function public.get_finance_summary(date,date,uuid,uuid) to authenticated;
