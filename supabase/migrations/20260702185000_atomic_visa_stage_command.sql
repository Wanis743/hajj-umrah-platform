-- Atomic visa stage advancement.
-- Replaces the UI-side two-step (visa update + separate pilgrim RPC) with one
-- transactional business command: validate -> update visa -> sync pilgrim -> audit.
-- Audit rows are produced by the existing write_audit_log() triggers on both tables.

create or replace function public.advance_visa_stage_command(p_visa_id uuid, p_to_status text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v public.visas%rowtype;
  p public.pilgrims%rowtype;
  v_from text;
  allowed boolean := false;
begin
  if not public.has_permission('visas','update') and public.staff_role() <> 'ADMIN' then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  if p_to_status not in ('NOT_STARTED','DOCUMENTS_REQUIRED','DOCUMENTS_PARTIAL','DOCUMENTS_COMPLETE',
                         'UNDER_REVIEW','READY_FOR_SUBMISSION','SUBMITTED','PROCESSING',
                         'ADDITIONAL_INFO_REQUIRED','APPROVED','ISSUED','REJECTED','CANCELLED') then
    raise exception 'Invalid visa status: %', p_to_status using errcode='22023';
  end if;

  select * into v from public.visas where id = p_visa_id for update;
  if not found then
    raise exception 'Visa not found' using errcode='P0002';
  end if;

  if v.pilgrim_id is not null then
    select * into p from public.pilgrims where id = v.pilgrim_id for update;
    if found and not public.row_in_staff_scope(p.agency_id, p.branch_id) then
      raise exception 'Visa not found in scope' using errcode='42501';
    end if;
  end if;

  v_from := coalesce(v.status,'NOT_STARTED');
  allowed :=
       (v_from='NOT_STARTED' and p_to_status in ('DOCUMENTS_REQUIRED','SUBMITTED','CANCELLED'))
    or (v_from='DOCUMENTS_REQUIRED' and p_to_status in ('DOCUMENTS_PARTIAL','DOCUMENTS_COMPLETE','CANCELLED'))
    or (v_from='DOCUMENTS_PARTIAL' and p_to_status in ('DOCUMENTS_COMPLETE','DOCUMENTS_REQUIRED','CANCELLED'))
    or (v_from='DOCUMENTS_COMPLETE' and p_to_status in ('UNDER_REVIEW','READY_FOR_SUBMISSION','CANCELLED'))
    or (v_from='UNDER_REVIEW' and p_to_status in ('READY_FOR_SUBMISSION','ADDITIONAL_INFO_REQUIRED','REJECTED','CANCELLED'))
    or (v_from='READY_FOR_SUBMISSION' and p_to_status in ('SUBMITTED','CANCELLED'))
    or (v_from='SUBMITTED' and p_to_status in ('PROCESSING','APPROVED','ADDITIONAL_INFO_REQUIRED','REJECTED'))
    or (v_from='PROCESSING' and p_to_status in ('APPROVED','ADDITIONAL_INFO_REQUIRED','REJECTED'))
    or (v_from='ADDITIONAL_INFO_REQUIRED' and p_to_status in ('DOCUMENTS_REQUIRED','DOCUMENTS_COMPLETE','UNDER_REVIEW','CANCELLED'))
    or (v_from='APPROVED' and p_to_status in ('ISSUED','CANCELLED'))
    or (v_from in ('ISSUED','REJECTED','CANCELLED') and p_to_status = v_from);

  if not allowed then
    raise exception 'Invalid visa state transition: % -> %', v_from, p_to_status using errcode='22023';
  end if;

  perform set_config('app.allow_direct_sensitive_update','1',true);
  update public.visas set status = p_to_status, updated_at = now() where id = v.id;
  if v.pilgrim_id is not null and p.id is not null and p.visa_status is distinct from p_to_status then
    update public.pilgrims set visa_status = p_to_status, updated_at = now() where id = p.id;
  end if;
  perform set_config('app.allow_direct_sensitive_update','0',true);

  return jsonb_build_object('id', v.id, 'status', p_to_status, 'pilgrim_id', v.pilgrim_id, 'from_status', v_from);
end;
$$;

revoke all on function public.advance_visa_stage_command(uuid,text) from public, anon;
grant execute on function public.advance_visa_stage_command(uuid,text) to authenticated;

-- Deleting a visa must also reset the pilgrim visa status inside the same transaction.
create or replace function public.retire_visa_command(p_visa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v public.visas%rowtype;
  p public.pilgrims%rowtype;
begin
  if not public.has_permission('visas','delete') and public.staff_role() <> 'ADMIN' then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  select * into v from public.visas where id = p_visa_id for update;
  if not found then
    raise exception 'Visa not found' using errcode='P0002';
  end if;

  if v.pilgrim_id is not null then
    select * into p from public.pilgrims where id = v.pilgrim_id for update;
    if found and not public.row_in_staff_scope(p.agency_id, p.branch_id) then
      raise exception 'Visa not found in scope' using errcode='42501';
    end if;
  end if;

  perform set_config('app.allow_direct_sensitive_update','1',true);
  delete from public.visas where id = v.id;
  if p.id is not null and p.visa_status is distinct from 'NOT_STARTED' then
    update public.pilgrims set visa_status = 'NOT_STARTED', updated_at = now() where id = p.id;
  end if;
  perform set_config('app.allow_direct_sensitive_update','0',true);

  return jsonb_build_object('id', p_visa_id, 'pilgrim_id', v.pilgrim_id);
end;
$$;

revoke all on function public.retire_visa_command(uuid) from public, anon;
grant execute on function public.retire_visa_command(uuid) to authenticated;
