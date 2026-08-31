-- Final P2 hardening: internal RPC exposure, staff-only operational policies,
-- visa workflow RPC, and missing FK indexes.

create or replace function public.update_visa_status(p_pilgrim_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_p public.pilgrims%rowtype;
begin
  if not public.is_staff() then raise exception 'Unauthorized' using errcode='42501'; end if;
  if p_status not in ('NOT_STARTED','DOCUMENTS_REQUIRED','DOCUMENTS_PARTIAL','DOCUMENTS_COMPLETE','UNDER_REVIEW','READY_FOR_SUBMISSION','SUBMITTED','PROCESSING','ADDITIONAL_INFO_REQUIRED','APPROVED','ISSUED','REJECTED','CANCELLED') then
    raise exception 'Invalid visa status' using errcode='22023';
  end if;
  select * into v_p from public.pilgrims where id=p_pilgrim_id for update;
  if not found or not public.row_in_staff_scope(v_p.agency_id, v_p.branch_id) then raise exception 'Pilgrim not found in staff scope' using errcode='42501'; end if;
  update public.pilgrims set visa_status=p_status, updated_at=now() where id=p_pilgrim_id;
  return jsonb_build_object('pilgrim_id',p_pilgrim_id,'visa_status',p_status);
end $$;
revoke all on function public.update_visa_status(uuid,text) from public, anon;
grant execute on function public.update_visa_status(uuid,text) to authenticated;

drop policy if exists packages_staff_access on public.packages;
create policy packages_staff_access on public.packages for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- public.support_tickets is never created by any migration in this repo (the
-- tenancy pass calls the concept `tickets`, which is also never created), and
-- both DROP POLICY and CREATE POLICY error on a missing relation -- so a fresh
-- replay of the ledger stopped here. Guarded rather than deleted: the intent
-- (staff-only access once the table exists) stays on the record.
do $tickets_guard$
begin
  if to_regclass('public.support_tickets') is not null then
    drop policy if exists staff_support_tickets on public.support_tickets;
    create policy staff_support_tickets on public.support_tickets for all to authenticated using (public.is_staff()) with check (public.is_staff());
  end if;
end
$tickets_guard$;

-- Internal helpers are not API endpoints.
DO $$ declare r record; begin
  for r in select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef=true and p.proname in (
    'assign_reservation_reference','assign_reservation_scope','can_access_agency','can_access_branch',
    'current_staff_agency_id','current_staff_branch_id','has_permission','is_admin','is_staff','is_staff_in_agency',
    'row_in_staff_scope','staff_agency_id','staff_branch_id','staff_role','update_updated_at_column')
  loop execute format('revoke execute on function public.%I(%s) from public, anon, authenticated',r.proname,r.args); end loop;
end $$;

revoke all on function public.cancel_booking_transaction(uuid,text) from public,anon; grant execute on function public.cancel_booking_transaction(uuid,text) to authenticated;
revoke all on function public.cancel_reservation_request(uuid,text) from public,anon; grant execute on function public.cancel_reservation_request(uuid,text) to authenticated;
revoke all on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) from public,anon; grant execute on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) to authenticated;
revoke all on function public.create_reservation_request(jsonb) from public,authenticated; grant execute on function public.create_reservation_request(jsonb) to anon;
revoke all on function public.record_payment_transaction(uuid,numeric,numeric,text,text) from public,anon; grant execute on function public.record_payment_transaction(uuid,numeric,numeric,text,text) to authenticated;
revoke all on function public.update_departure_setting(date) from public,anon; grant execute on function public.update_departure_setting(date) to authenticated;

-- create_invoice_transaction and reverse_payment_transaction are created by
-- 20260502213600, which re-issues these two pairs itself on lines 7-8. Here they
-- named functions that did not exist yet, so a replay of the ledger stopped on the
-- first of them with 42883. Guarded rather than deleted: the intent -- reachable by
-- authenticated, never by anon -- stays on the record for a database that already
-- carries them.
do $late_finance_rpcs$
begin
  if to_regprocedure('public.create_invoice_transaction(uuid,text)') is not null then
    revoke all on function public.create_invoice_transaction(uuid,text) from public,anon;
    grant execute on function public.create_invoice_transaction(uuid,text) to authenticated;
  end if;
  if to_regprocedure('public.reverse_payment_transaction(uuid,numeric,numeric,text)') is not null then
    revoke all on function public.reverse_payment_transaction(uuid,numeric,numeric,text) from public,anon;
    grant execute on function public.reverse_payment_transaction(uuid,numeric,numeric,text) to authenticated;
  end if;
end
$late_finance_rpcs$;

alter function public.update_updated_at_column() set search_path=public;
revoke execute on function public.update_updated_at_column() from public,anon,authenticated;

create index if not exists idx_contracts_supplier_id on public.contracts(supplier_id);
create index if not exists idx_pilgrims_package_id on public.pilgrims(package_id);
-- Three of the five indexes in this pass name objects that do not exist:
-- public.payment_reversals and public.support_tickets are never created by any
-- migration, and reservations.branch_uuid is never added (branch_uuid exists
-- only on staff_profiles and the external_* tables; the tenancy pass gave every
-- domain table branch_id). `create index if not exists` errors on a missing
-- relation or column, so a fresh replay stopped here.
do $index_guard$
begin
  if to_regclass('public.payment_reversals') is not null then
    create index if not exists idx_payment_reversals_created_by on public.payment_reversals(created_by);
  end if;
  if exists (select 1 from pg_attribute
              where attrelid = to_regclass('public.reservations')
                and attname = 'branch_uuid' and not attisdropped) then
    create index if not exists idx_reservations_branch_uuid on public.reservations(branch_uuid);
  end if;
  if to_regclass('public.support_tickets') is not null then
    create index if not exists idx_support_tickets_pilgrim_id on public.support_tickets(pilgrim_id);
  end if;
end
$index_guard$;

drop policy if exists staff_profile_self_select on public.staff_profiles;
create policy staff_profile_self_select on public.staff_profiles for select to authenticated
using ((select auth.uid())=user_id or (select public.is_admin()));
