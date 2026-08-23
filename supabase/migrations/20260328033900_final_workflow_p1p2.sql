-- Final workflow hardening. Safe for fresh installs and upgrades.

create or replace function public.create_reservation_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reference text;
  v_agency uuid := public.staff_agency_id();
  v_branch uuid := public.staff_branch_id();
  v_name text := nullif(trim(coalesce(p_payload->>'name','')),'');
  v_phone text := nullif(trim(coalesce(p_payload->>'phone','')),'');
  v_email text := nullif(trim(coalesce(p_payload->>'email','')),'');
  v_package text := nullif(trim(coalesce(p_payload->>'package_id','')),'');
  v_travelers integer := greatest(coalesce((p_payload->>'travelers')::integer, 1), 1);
  v_start date := nullif(p_payload->>'start_date','')::date;
  v_end date := nullif(p_payload->>'end_date','')::date;
  v_notes text := nullif(trim(coalesce(p_payload->>'notes','')),'');
begin
  if not public.is_staff() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if v_name is null or length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Name is required' using errcode = '22023';
  end if;
  if v_phone is null or length(v_phone) < 8 or length(v_phone) > 30 then
    raise exception 'Phone is required' using errcode = '22023';
  end if;
  if v_travelers > 20 then
    raise exception 'Too many travelers' using errcode = '22023';
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;

  insert into public.reservations(agency_id, branch_id, package_id, package_name, name, phone, email, travelers, start_date, end_date, notes, status)
  values(v_agency, v_branch, v_package, coalesce(p_payload->>'package_name',''), v_name, v_phone, v_email, v_travelers, v_start, v_end, v_notes, 'pending')
  returning id, reference into v_id, v_reference;

  return jsonb_build_object('id', v_id, 'reference', v_reference);
end;
$$;
revoke all on function public.create_reservation_request(jsonb) from public, anon;
grant execute on function public.create_reservation_request(jsonb) to authenticated;

create or replace function public.cancel_reservation_request(p_reservation_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.reservations%rowtype;
begin
  if not public.has_permission('reservations','update') and public.staff_role() <> 'ADMIN' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into r from public.reservations where id = p_reservation_id for update;
  if not found or not public.row_in_staff_scope(r.agency_id, r.branch_id) then
    raise exception 'Reservation not found in staff scope' using errcode = '42501';
  end if;
  if r.status = 'confirmed' then
    raise exception 'Confirmed reservations require booking cancellation workflow' using errcode = '22023';
  end if;
  update public.reservations
     set status = 'cancelled',
         notes = concat_ws(E'\n', notes, nullif(trim(p_reason),'')),
         updated_at = now()
   where id = r.id;
  return jsonb_build_object('id', r.id, 'status', 'cancelled');
end;
$$;
revoke all on function public.cancel_reservation_request(uuid,text) from public, anon;
grant execute on function public.cancel_reservation_request(uuid,text) to authenticated;

create or replace function public.update_departure_setting(p_next_departure_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id integer;
begin
  if public.staff_role() <> 'ADMIN' then
    raise exception 'Admin authorization required' using errcode = '42501';
  end if;
  select id into v_id from public.settings order by id limit 1;
  if v_id is null then
    insert into public.settings(next_departure_date) values(p_next_departure_date) returning id into v_id;
  else
    update public.settings set next_departure_date = p_next_departure_date, updated_at = now() where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'next_departure_date', p_next_departure_date);
end;
$$;
revoke all on function public.update_departure_setting(date) from public, anon;
grant execute on function public.update_departure_setting(date) to authenticated;

create index if not exists idx_bookings_agency_branch_status_created on public.bookings(agency_id, branch_id, status, created_at desc);
create index if not exists idx_pilgrims_agency_branch_status_created on public.pilgrims(agency_id, branch_id, status, created_at desc);
create index if not exists idx_reservations_agency_branch_status_created on public.reservations(agency_id, branch_id, status, created_at desc);
create index if not exists idx_documents_agency_branch_status_created on public.documents(agency_id, branch_id, status, created_at desc);
create index if not exists idx_payments_agency_branch_status_created on public.payments(agency_id, branch_id, status, created_at desc);
create index if not exists idx_invoices_agency_branch_status_created on public.invoices(agency_id, branch_id, status, created_at desc);
create index if not exists idx_audit_logs_agency_branch_created on public.audit_logs(agency_id, branch_id, created_at desc);
