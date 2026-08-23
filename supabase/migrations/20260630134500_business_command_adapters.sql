-- Maintainability/domain layer: each public command has a stable business name.
-- The generic patch helper is private implementation detail; UI code never names tables.
create or replace function public.patch_scoped_command_row(
  p_table regclass,
  p_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_table_name text;
  v_cols text;
  v_has_agency boolean;
  v_has_branch boolean;
  v_sql text;
  v_row jsonb;
begin
  v_table_name := regexp_replace(p_table::text, '^.*\\.', '');
  if p_id is null then
    raise exception 'Command target id is required' using errcode='22023';
  end if;
  if p_payload is null or p_payload = '{}'::jsonb then
    raise exception 'Command payload is empty' using errcode='22023';
  end if;

  select exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table_name and column_name='agency_id') into v_has_agency;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table_name and column_name='branch_id') into v_has_branch;

  select string_agg(format('%I = case when $1 ? %L then (jsonb_populate_record(t,$1)).%I else t.%I end', column_name, column_name, column_name, column_name), ', ')
    into v_cols
  from information_schema.columns
  where table_schema='public'
    and table_name=v_table_name
    and column_name not in ('id','agency_id','branch_id','created_at','updated_at');

  if v_cols is null then raise exception 'No mutable columns for command table %', v_table_name; end if;

  v_sql := format(
    'update %s t set %s%s where t.id=$2 %s returning to_jsonb(t)',
    p_table,
    v_cols,
    case when v_has_agency then ', updated_at=now()' else '' end,
    case
      when v_has_agency and v_has_branch then 'and public.row_in_staff_scope(t.agency_id,t.branch_id)'
      when v_has_agency then 'and t.agency_id=public.staff_agency_id()'
      else ''
    end
  );

  execute format('select to_jsonb(r) from %s r where r.id=$2 %s',p_table,
    case
      when v_has_agency and v_has_branch then 'and public.row_in_staff_scope(r.agency_id,r.branch_id)'
      when v_has_agency then 'and r.agency_id=public.staff_agency_id()'
      else ''
    end
  ) into v_row using p_payload,p_id;

  if v_row is null then
    raise exception 'Record not found in authorized scope' using errcode='42501';
  end if;

  execute v_sql into v_row using p_payload,p_id;
  return v_row;
end;
$$;

create or replace function public.delete_scoped_command_row(p_table regclass,p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_table_name text;
  v_has_agency boolean;
  v_has_branch boolean;
  v_sql text;
  v_row jsonb;
begin
  v_table_name := regexp_replace(p_table::text, '^.*\\.', '');
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table_name and column_name='agency_id') into v_has_agency;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table_name and column_name='branch_id') into v_has_branch;
  v_sql := format(
    'delete from %s t where t.id=$1 %s returning to_jsonb(t)',
    p_table,
    case
      when v_has_agency and v_has_branch then 'and public.row_in_staff_scope(t.agency_id,t.branch_id)'
      when v_has_agency then 'and t.agency_id=public.staff_agency_id()'
      else ''
    end
  );
  execute v_sql into v_row using p_id;
  if v_row is null then raise exception 'Record not found in authorized scope' using errcode='42501'; end if;
  return v_row;
end;
$$;

-- Domain-named adapters. These names form the stable service contract.
create or replace function public.update_document_command(p_document_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.documents'::regclass,p_document_id,p_payload); $$;
create or replace function public.update_room_allocation_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.room_allocations'::regclass,p_id,p_payload); $$;
create or replace function public.delete_room_allocation_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.room_allocations'::regclass,p_id); $$;
create or replace function public.update_group_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.groups'::regclass,p_id,p_payload); $$;
create or replace function public.update_incident_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.incidents'::regclass,p_id,p_payload); $$;

create or replace function public.update_sos_event_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.sos_events'::regclass,p_id,p_payload); $$;
create or replace function public.delete_sos_event_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.sos_events'::regclass,p_id); $$;
create or replace function public.update_transport_vehicle_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.transport_vehicles'::regclass,p_id,p_payload); $$;
create or replace function public.delete_transport_vehicle_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.transport_vehicles'::regclass,p_id); $$;
create or replace function public.update_transport_assignment_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.transport_assignments'::regclass,p_id,p_payload); $$;
create or replace function public.delete_transport_assignment_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.transport_assignments'::regclass,p_id); $$;
create or replace function public.update_hotel_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.hotels'::regclass,p_id,p_payload); $$;
create or replace function public.delete_hotel_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.hotels'::regclass,p_id); $$;
create or replace function public.update_package_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.packages'::regclass,p_id,p_payload); $$;
create or replace function public.delete_package_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.packages'::regclass,p_id); $$;
create or replace function public.update_flight_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.flights'::regclass,p_id,p_payload); $$;
create or replace function public.delete_flight_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.flights'::regclass,p_id); $$;
create or replace function public.update_camp_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.holy_site_camps'::regclass,p_id,p_payload); $$;
create or replace function public.delete_camp_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.holy_site_camps'::regclass,p_id); $$;
create or replace function public.update_crm_lead_command(p_id uuid,p_payload jsonb) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.patch_scoped_command_row('public.crm_leads'::regclass,p_id,p_payload); $$;
create or replace function public.delete_crm_lead_command(p_id uuid) returns jsonb language sql security definer set search_path=public,pg_catalog as $$ select public.delete_scoped_command_row('public.crm_leads'::regclass,p_id); $$;

revoke all on function public.patch_scoped_command_row(regclass,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.delete_scoped_command_row(regclass,uuid) from public,anon,authenticated;
grant execute on function public.update_document_command(uuid,jsonb) to authenticated;
grant execute on function public.update_room_allocation_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_room_allocation_command(uuid) to authenticated;
grant execute on function public.update_group_command(uuid,jsonb) to authenticated;
grant execute on function public.update_incident_command(uuid,jsonb) to authenticated;
grant execute on function public.update_sos_event_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_sos_event_command(uuid) to authenticated;
grant execute on function public.update_transport_vehicle_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_transport_vehicle_command(uuid) to authenticated;
grant execute on function public.update_transport_assignment_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_transport_assignment_command(uuid) to authenticated;
grant execute on function public.update_hotel_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_hotel_command(uuid) to authenticated;
grant execute on function public.update_package_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_package_command(uuid) to authenticated;
grant execute on function public.update_flight_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_flight_command(uuid) to authenticated;
grant execute on function public.update_camp_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_camp_command(uuid) to authenticated;
grant execute on function public.update_crm_lead_command(uuid,jsonb) to authenticated;
grant execute on function public.delete_crm_lead_command(uuid) to authenticated;
