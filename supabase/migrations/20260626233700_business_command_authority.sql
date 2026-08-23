-- Business command and transition authority. These functions are the only supported
-- mutation path for sensitive workflows.

create or replace function public.create_pilgrim_command(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Unauthorized' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_payload->>'full_name','')),'') is null then raise exception 'Full name is required' using errcode='22023'; end if;
  insert into public.pilgrims(full_name,full_name_ar,passport_number,phone,email,gender,birth_date,nationality,wilaya,package_id,group_id)
  values(p_payload->>'full_name',p_payload->>'full_name_ar',p_payload->>'passport_number',p_payload->>'phone',p_payload->>'email',
         p_payload->>'gender',nullif(p_payload->>'birth_date','')::date,p_payload->>'nationality',p_payload->>'wilaya',
         nullif(p_payload->>'package_id','')::uuid,nullif(p_payload->>'group_id','')::uuid)
  returning id into v_id;
  return jsonb_build_object('id',v_id);
end $$;

create or replace function public.update_pilgrim_profile_command(p_pilgrim_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v public.pilgrims%rowtype;
begin
  select * into v from public.pilgrims where id=p_pilgrim_id for update;
  if not found or not public.row_in_staff_scope(v.agency_id,v.branch_id) then raise exception 'Pilgrim not found in scope' using errcode='42501'; end if;
  update public.pilgrims set
    full_name=coalesce(p_payload->>'full_name',full_name),
    full_name_ar=coalesce(p_payload->>'full_name_ar',full_name_ar),
    phone=coalesce(p_payload->>'phone',phone),
    email=coalesce(p_payload->>'email',email),
    wilaya=coalesce(p_payload->>'wilaya',wilaya),
    emergency_contact=coalesce(p_payload->>'emergency_contact',emergency_contact),
    emergency_phone=coalesce(p_payload->>'emergency_phone',emergency_phone),
    notes=coalesce(p_payload->>'notes',notes),
    updated_at=now()
  where id=p_pilgrim_id;
  return jsonb_build_object('id',p_pilgrim_id);
end $$;

create or replace function public.verify_document_command(p_document_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  update public.documents d
  set status='VERIFIED'
  where d.id=p_document_id and exists (
    select 1 from public.pilgrims p where p.id=d.pilgrim_id and public.row_in_staff_scope(p.agency_id,p.branch_id)
  );
  if not found then raise exception 'Document not found in scope' using errcode='42501'; end if;
  return jsonb_build_object('id',p_document_id,'status','VERIFIED');
end $$;

create or replace function public.allocate_room_command(p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Unauthorized' using errcode='42501'; end if;
  insert into public.room_allocations(hotel_id,group_id,pilgrim_id,room_number,room_type,check_in,check_out,status)
  values((p_payload->>'hotel_id')::uuid,nullif(p_payload->>'group_id','')::uuid,(p_payload->>'pilgrim_id')::uuid,
         p_payload->>'room_number',p_payload->>'room_type',(p_payload->>'check_in')::date,(p_payload->>'check_out')::date,'ALLOCATED')
  returning id into v_id;
  return jsonb_build_object('id',v_id);
end $$;

create or replace function public.transition_group_state(p_group_id uuid,p_to_status text)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare g public.groups%rowtype; allowed boolean := false;
begin
  select * into g from public.groups where id=p_group_id for update;
  if not found or not public.row_in_staff_scope(g.agency_id,g.branch_id) then raise exception 'Group not found in scope' using errcode='42501'; end if;
  allowed := (g.status=p_to_status)
    or (g.status='FORMING' and p_to_status in ('READY','CANCELLED'))
    or (g.status='READY' and p_to_status in ('DEPARTED','CANCELLED'))
    or (g.status='DEPARTED' and p_to_status in ('IN_SAUDI','RETURNED'))
    or (g.status='IN_SAUDI' and p_to_status='RETURNED');
  if not allowed then raise exception 'Invalid group state transition' using errcode='22023'; end if;
  perform set_config('app.allow_direct_sensitive_update','1',true);
  update public.groups set status=p_to_status,updated_at=now() where id=p_group_id;
  return jsonb_build_object('id',p_group_id,'status',p_to_status);
end $$;

create or replace function public.transition_incident_state(p_incident_id uuid,p_to_status text)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  perform set_config('app.allow_direct_sensitive_update','1',true);
  update public.incidents i set status=p_to_status, updated_at=now()
  where i.id=p_incident_id and public.row_in_staff_scope(i.agency_id,i.branch_id);
  if not found then raise exception 'Incident not found in scope' using errcode='42501'; end if;
  return jsonb_build_object('id',p_incident_id,'status',p_to_status);
end $$;

create or replace function public.transition_invoice_state(p_invoice_id uuid,p_to_status text)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  if p_to_status not in ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED') then raise exception 'Invalid invoice state' using errcode='22023'; end if;
  perform set_config('app.allow_direct_sensitive_update','1',true);
  update public.invoices i set status=p_to_status where i.id=p_invoice_id and public.row_in_staff_scope(i.agency_id,i.branch_id);
  if not found then raise exception 'Invoice not found in scope' using errcode='42501'; end if;
  return jsonb_build_object('id',p_invoice_id,'status',p_to_status);
end $$;


-- Generic domain command RPCs are still domain-named and scope-checked; UI never receives table names.
create or replace function public.create_visa_command(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_id uuid;
begin
  insert into public.visas(pilgrim_id,status) values((p_payload->>'pilgrim_id')::uuid,coalesce(p_payload->>'status','NOT_STARTED')) returning id into v_id;
  return jsonb_build_object('id',v_id);
end $$;
create or replace function public.delete_visa_command(p_visa_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin delete from public.visas v where v.id=p_visa_id; if not found then raise exception 'Visa not found' using errcode='P0002'; end if; return jsonb_build_object('id',p_visa_id); end $$;

create or replace function public.create_document_command(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_id uuid;
begin
 insert into public.documents(pilgrim_id,type,status) values((p_payload->>'pilgrim_id')::uuid,coalesce(p_payload->>'type','OTHER'),coalesce(p_payload->>'status','REQUIRED')) returning id into v_id;
 return jsonb_build_object('id',v_id);
end $$;
create or replace function public.delete_document_command(p_document_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin delete from public.documents where id=p_document_id; if not found then raise exception 'Document not found' using errcode='P0002'; end if; return jsonb_build_object('id',p_document_id); end $$;

create or replace function public.delete_pilgrim_command(p_pilgrim_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin delete from public.pilgrims where id=p_pilgrim_id and row_in_staff_scope(agency_id,branch_id); if not found then raise exception 'Pilgrim not found' using errcode='42501'; end if; return jsonb_build_object('id',p_pilgrim_id); end $$;
create or replace function public.delete_group_command(p_group_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin delete from public.groups where id=p_group_id and row_in_staff_scope(agency_id,branch_id); if not found then raise exception 'Group not found' using errcode='42501'; end if; return jsonb_build_object('id',p_group_id); end $$;
create or replace function public.delete_incident_command(p_id uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin delete from public.incidents where id=p_id and row_in_staff_scope(agency_id,branch_id); if not found then raise exception 'Incident not found' using errcode='42501'; end if; return jsonb_build_object('id',p_id); end $$;

create or replace function public.create_group_command(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
declare v_id uuid;
begin insert into public.groups(code,name,package_id,departure_date,max_capacity) values(p_payload->>'code',p_payload->>'name',nullif(p_payload->>'package_id','')::uuid,nullif(p_payload->>'departure_date','')::timestamptz,coalesce((p_payload->>'max_capacity')::int,50)) returning id into v_id; return jsonb_build_object('id',v_id); end $$;
