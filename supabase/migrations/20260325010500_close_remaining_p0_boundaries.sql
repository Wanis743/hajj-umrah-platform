-- P0 follow-up: eliminate policy accumulation and move financial writes behind
-- authorized, atomic database transactions.

-- A role is scoped to one agency. Administrators may span that agency's
-- branches, but can never cross into another agency.
create or replace function public.row_in_staff_scope(p_agency_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_agency_id = public.staff_agency_id()
     and (public.staff_role() = 'ADMIN' or p_branch_id = public.staff_branch_id());
$$;

-- These helpers intentionally bypass profile RLS; they are not public RPCs.
revoke all on function public.is_staff() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.staff_role() from public, anon, authenticated;
revoke all on function public.staff_agency_id() from public, anon, authenticated;
revoke all on function public.staff_branch_id() from public, anon, authenticated;
revoke all on function public.has_permission(text, text) from public, anon, authenticated;
revoke all on function public.row_in_staff_scope(uuid, uuid) from public, anon, authenticated;
revoke all on function public.stamp_staff_scope() from public, anon, authenticated;
revoke all on function public.assign_reservation_reference() from public, anon, authenticated;
revoke all on function public.write_audit_log() from public, anon, authenticated;
revoke all on function public.prevent_financial_mutation() from public, anon, authenticated;

-- Profiles are self-readable only. Authorization is performed by the private
-- helpers above, rather than exposing all staff identities to an admin.
drop policy if exists staff_profile_self_select on public.staff_profiles;
create policy staff_profile_self_select on public.staff_profiles
  for select to authenticated using (user_id = (select auth.uid()));

-- RLS policies compose with OR. Drop every inherited prototype policy before
-- installing the definitive permissions/scope policy set.
do $$
declare
  tbl text;
  pol text;
begin
  foreach tbl in array array[
    'packages','pilgrims','bookings','reservations','groups','visas','flights',
    'passenger_assignments','hotels','hotel_contracts','room_allocations',
    'transport_vehicles','transport_assignments','holy_site_camps','mutawwif_guides',
    'payments','documents','crm_leads','alerts','actions','incidents','sos_events',
    'invoices','contracts','suppliers','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      for pol in select policyname from pg_policies where schemaname = 'public' and tablename = tbl loop
        execute format('drop policy if exists %I on public.%I', pol, tbl);
      end loop;
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all on public.%I from anon, authenticated', tbl);
      execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
      execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl);
      execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.has_permission(%L,''create'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl);
      execute format('create policy staff_update on public.%I for update to authenticated using (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id)) with check (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl, tbl);
      execute format('create policy staff_delete on public.%I for delete to authenticated using (public.has_permission(%L,''delete'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl);
    end if;
  end loop;
end $$;

-- Public reservations remain write-only. The edge function, not browser SQL,
-- is the production public entry point; this policy retains a constrained
-- fallback while exposing no tenant data.

-- Audit events are generated only by triggers. They cannot be forged, edited,
-- or deleted through the Data API.
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;
do $$
declare pol text;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'audit_logs' loop
    execute format('drop policy if exists %I on public.audit_logs', pol);
  end loop;
end $$;
create policy audit_select_admin on public.audit_logs for select to authenticated
  using (public.staff_role() = 'ADMIN' and public.row_in_staff_scope(agency_id, branch_id));

-- Financial records are append-only. Corrections must be explicit reversal
-- entries; no browser may silently edit or delete history.
create or replace function public.prevent_financial_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Financial transactions are immutable; create a reversal transaction instead.' using errcode = '42501';
end;
$$;

drop trigger if exists trg_prevent_financial_mutation on public.payments;
create trigger trg_prevent_financial_mutation before update or delete on public.payments
  for each row execute function public.prevent_financial_mutation();

create or replace function public.record_payment_transaction(
  p_booking_id uuid,
  p_amount_dzd numeric default 0,
  p_amount_sar numeric default 0,
  p_method text default 'Cash',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  payment_id uuid;
  next_paid_dzd numeric(14,2);
  next_paid_sar numeric(14,2);
begin
  if not public.has_permission('payments', 'create') then
    raise exception 'Not authorized to record payments' using errcode = '42501';
  end if;
  if coalesce(p_amount_dzd, 0) < 0 or coalesce(p_amount_sar, 0) < 0
     or (coalesce(p_amount_dzd, 0) = 0 and coalesce(p_amount_sar, 0) = 0) then
    raise exception 'A payment must contain a positive amount' using errcode = '22023';
  end if;
  if p_method not in ('Cash', 'Bank Transfer', 'Check', 'Card', 'CCP', 'BaridiMob') then
    raise exception 'Invalid payment method' using errcode = '22023';
  end if;

  select * into b from public.bookings where id = p_booking_id for update;
  if not found or not public.row_in_staff_scope(b.agency_id, b.branch_id) then
    raise exception 'Booking not found in staff scope' using errcode = '42501';
  end if;
  if b.status in ('CANCELLED', 'COMPLETED') then
    raise exception 'Payments cannot be recorded for this booking status' using errcode = '22023';
  end if;

  next_paid_dzd := coalesce(b.paid_dzd, 0) + coalesce(p_amount_dzd, 0);
  next_paid_sar := coalesce(b.paid_sar, 0) + coalesce(p_amount_sar, 0);
  if next_paid_dzd > coalesce(b.total_dzd, 0) or next_paid_sar > coalesce(b.total_sar, 0) then
    raise exception 'Payment exceeds booking balance' using errcode = '22023';
  end if;

  insert into public.payments (agency_id, branch_id, booking_id, pilgrim_id, amount_dzd, amount_sar, method, status, reference, notes)
  values (b.agency_id, b.branch_id, b.id, b.pilgrim_id, coalesce(p_amount_dzd, 0), coalesce(p_amount_sar, 0), p_method, 'CONFIRMED',
          'PAY-' || to_char(current_date, 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), nullif(trim(p_notes), ''))
  returning id into payment_id;

  update public.bookings
     set paid_dzd = next_paid_dzd,
         paid_sar = next_paid_sar,
         status = case when next_paid_dzd = coalesce(total_dzd, 0) and next_paid_sar = coalesce(total_sar, 0) then 'PAID' else status end,
         updated_at = now()
   where id = b.id;
  return jsonb_build_object('payment_id', payment_id, 'booking_id', b.id);
end;
$$;
revoke all on function public.record_payment_transaction(uuid, numeric, numeric, text, text) from public;
grant execute on function public.record_payment_transaction(uuid, numeric, numeric, text, text) to authenticated;

-- The generic table policy deliberately does not apply to financial writes:
-- all payment creation must enter through record_payment_transaction().
drop policy if exists staff_insert on public.payments;
drop policy if exists staff_update on public.payments;
drop policy if exists staff_delete on public.payments;

-- Do not release capacity after money has been collected without an explicit
-- reversal, which preserves the accounting trail.
create or replace function public.cancel_booking_transaction(p_booking_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.bookings%rowtype;
begin
  if not public.has_permission('bookings', 'update') then raise exception 'Not authorized to cancel bookings' using errcode = '42501'; end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or not public.row_in_staff_scope(b.agency_id, b.branch_id) then raise exception 'Booking not found in staff scope' using errcode = '42501'; end if;
  if b.status = 'CANCELLED' then return jsonb_build_object('booking_id', b.id, 'status', 'CANCELLED'); end if;
  if exists (select 1 from public.payments p where p.booking_id = b.id and p.status = 'CONFIRMED') then
    raise exception 'Create a reversal transaction before cancelling a paid booking' using errcode = '22023';
  end if;
  update public.bookings set status = 'CANCELLED', notes = concat_ws(E'\n', notes, nullif(trim(p_reason), '')), updated_at = now() where id = b.id;
  if b.package_id is not null then update public.packages set seats_available = seats_available + coalesce(b.travelers, 1), updated_at = now() where id = b.package_id; end if;
  return jsonb_build_object('booking_id', b.id, 'status', 'CANCELLED');
end;
$$;
revoke all on function public.cancel_booking_transaction(uuid, text) from public;
grant execute on function public.cancel_booking_transaction(uuid, text) to authenticated;

-- Passport/document files use a private, scope-prefixed bucket. Browser code
-- must use authenticated upload/signed-URL workflows; URLs are never public.
insert into storage.buckets (id, name, public) values ('pilgrim-documents', 'pilgrim-documents', false)
on conflict (id) do update set public = false;
do $$
declare pol text;
begin
  for pol in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'pilgrim_documents_%' loop
    execute format('drop policy if exists %I on storage.objects', pol);
  end loop;
end $$;
create policy pilgrim_documents_select on storage.objects for select to authenticated using (
  bucket_id = 'pilgrim-documents' and (storage.foldername(name))[1] = public.staff_agency_id()::text
  and (public.staff_role() = 'ADMIN' or (storage.foldername(name))[2] = public.staff_branch_id()::text)
);
create policy pilgrim_documents_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'pilgrim-documents' and public.has_permission('documents', 'create')
  and (storage.foldername(name))[1] = public.staff_agency_id()::text
  and (storage.foldername(name))[2] = public.staff_branch_id()::text
);
create policy pilgrim_documents_update on storage.objects for update to authenticated using (
  bucket_id = 'pilgrim-documents' and public.has_permission('documents', 'update')
  and (storage.foldername(name))[1] = public.staff_agency_id()::text
  and (public.staff_role() = 'ADMIN' or (storage.foldername(name))[2] = public.staff_branch_id()::text)
) with check (
  bucket_id = 'pilgrim-documents' and (storage.foldername(name))[1] = public.staff_agency_id()::text
  and (storage.foldername(name))[2] = public.staff_branch_id()::text
);
