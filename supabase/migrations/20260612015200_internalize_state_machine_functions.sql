create or replace function private.transition_pilgrim_state_impl(p_pilgrim_id uuid,p_to_status text) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare p public.pilgrims%rowtype; allowed boolean:=false;
begin
 if not public.has_permission('pilgrims','update') and public.staff_role()<>'ADMIN' then raise exception 'Not authorized' using errcode='42501'; end if;
 select * into p from public.pilgrims where id=p_pilgrim_id for update;
 if not found or not public.row_in_staff_scope(p.agency_id,p.branch_id) then raise exception 'Pilgrim not found in scope' using errcode='42501'; end if;
 allowed := (p.status='REGISTERED' and p_to_status in ('DOCUMENTS_PENDING','REGISTERED')) or (p.status='DOCUMENTS_PENDING' and p_to_status in ('DOCUMENTS_COMPLETE','REGISTERED')) or (p.status='DOCUMENTS_COMPLETE' and p_to_status in ('VISA_READY','DOCUMENTS_PENDING')) or (p.status='VISA_READY' and p_to_status in ('GROUP_ASSIGNED','DOCUMENTS_COMPLETE')) or (p.status='GROUP_ASSIGNED' and p_to_status in ('TRAVELING','GROUP_ASSIGNED')) or (p.status='TRAVELING' and p_to_status in ('RETURNED','TRAVELING')) or (p.status='RETURNED' and p_to_status in ('RETURNED','CLOSED')) or (p.status='CLOSED' and p_to_status='CLOSED');
 if not allowed then raise exception 'Invalid pilgrim state transition: % -> %',p.status,p_to_status using errcode='22023'; end if;
 update public.pilgrims set status=p_to_status,updated_at=now() where id=p.id;
 return jsonb_build_object('pilgrim_id',p.id,'status',p_to_status);
end; $$;
revoke all on function private.transition_pilgrim_state_impl(uuid,text) from public,anon,authenticated;

create or replace function private.transition_visa_status_impl(p_pilgrim_id uuid,p_to_status text) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare p public.pilgrims%rowtype; allowed boolean:=false;
begin
 if not public.has_permission('visas','update') and public.staff_role()<>'ADMIN' then raise exception 'Not authorized' using errcode='42501'; end if;
 if p_to_status not in ('NOT_STARTED','DOCUMENTS_REQUIRED','DOCUMENTS_PARTIAL','DOCUMENTS_COMPLETE','UNDER_REVIEW','READY_FOR_SUBMISSION','SUBMITTED','PROCESSING','ADDITIONAL_INFO_REQUIRED','APPROVED','ISSUED','REJECTED','CANCELLED') then raise exception 'Invalid visa status' using errcode='22023'; end if;
 select * into p from public.pilgrims where id=p_pilgrim_id for update;
 if not found or not public.row_in_staff_scope(p.agency_id,p.branch_id) then raise exception 'Pilgrim not found in scope' using errcode='42501'; end if;
 allowed := (p.visa_status='NOT_STARTED' and p_to_status in ('DOCUMENTS_REQUIRED','CANCELLED')) or (p.visa_status='DOCUMENTS_REQUIRED' and p_to_status in ('DOCUMENTS_PARTIAL','DOCUMENTS_COMPLETE','CANCELLED')) or (p.visa_status='DOCUMENTS_PARTIAL' and p_to_status in ('DOCUMENTS_COMPLETE','DOCUMENTS_REQUIRED','CANCELLED')) or (p.visa_status='DOCUMENTS_COMPLETE' and p_to_status in ('UNDER_REVIEW','READY_FOR_SUBMISSION','CANCELLED')) or (p.visa_status='UNDER_REVIEW' and p_to_status in ('READY_FOR_SUBMISSION','ADDITIONAL_INFO_REQUIRED','REJECTED','CANCELLED')) or (p.visa_status='READY_FOR_SUBMISSION' and p_to_status in ('SUBMITTED','CANCELLED')) or (p.visa_status='SUBMITTED' and p_to_status in ('PROCESSING','ADDITIONAL_INFO_REQUIRED','REJECTED')) or (p.visa_status='PROCESSING' and p_to_status in ('APPROVED','ADDITIONAL_INFO_REQUIRED','REJECTED')) or (p.visa_status='ADDITIONAL_INFO_REQUIRED' and p_to_status in ('DOCUMENTS_REQUIRED','DOCUMENTS_COMPLETE','UNDER_REVIEW','CANCELLED')) or (p.visa_status='APPROVED' and p_to_status in ('ISSUED','CANCELLED')) or (p.visa_status in ('ISSUED','REJECTED','CANCELLED') and p_to_status=p.visa_status);
 if not allowed then raise exception 'Invalid visa state transition: % -> %',p.visa_status,p_to_status using errcode='22023'; end if;
 update public.pilgrims set visa_status=p_to_status,updated_at=now() where id=p.id;
 return jsonb_build_object('pilgrim_id',p.id,'visa_status',p_to_status);
end; $$;
revoke all on function private.transition_visa_status_impl(uuid,text) from public,anon,authenticated;

revoke all on function public.transition_pilgrim_state(uuid,text) from public,anon,authenticated;
create or replace function public.transition_pilgrim_state(p_pilgrim_id uuid,p_to_status text)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  perform set_config('app.allow_direct_sensitive_update','1',true);
  return public.private.transition_pilgrim_state_impl(p_pilgrim_id,p_to_status);
end; $$;
revoke all on function public.transition_pilgrim_state(uuid,text) from public,anon; grant execute on function public.transition_pilgrim_state(uuid,text) to authenticated;

revoke all on function public.transition_visa_status(uuid,text) from public,anon,authenticated;
create or replace function public.transition_visa_status(p_pilgrim_id uuid,p_to_status text)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  perform set_config('app.allow_direct_sensitive_update','1',true);
  return public.private.transition_visa_status_impl(p_pilgrim_id,p_to_status);
end; $$;
revoke all on function public.transition_visa_status(uuid,text) from public,anon; grant execute on function public.transition_visa_status(uuid,text) to authenticated;
