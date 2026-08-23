-- Enterprise security + domain integrity hardening.
-- Upgrade migration for existing installations.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Organizations / branches
-- -----------------------------------------------------------------------------
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, code)
);

insert into public.agencies (code, name)
values ('DEFAULT', 'Hajj & Umrah Agency')
on conflict (code) do nothing;

insert into public.branches (agency_id, code, name)
select id, 'HQ', 'Head Office'
from public.agencies
where code = 'DEFAULT'
on conflict (agency_id, code) do nothing;

-- staff_profiles existed in the previous hardening migration.
alter table public.staff_profiles
  add column if not exists agency_id uuid,
  add column if not exists branch_uuid uuid;

-- Migrate legacy text branch_id safely without failing on old invalid values.
alter table public.staff_profiles
  drop constraint if exists staff_profiles_role_check;

update public.staff_profiles
set branch_uuid = case
  when branch_id ~ '^[0-9a-fA-F-]{36}$' then branch_id::uuid
  else null
end
where branch_uuid is null;

update public.staff_profiles sp
set agency_id = b.agency_id,
    branch_uuid = b.id,
    branch_id = b.id::text
from public.branches b
where b.code = 'HQ'
  and sp.branch_uuid is null;

alter table public.staff_profiles
  add constraint staff_profiles_role_check
  check (role in ('ADMIN','OPERATIONS_MANAGER','VISA_AGENT','FINANCE','GUIDE','CRM','AGENT'));

alter table public.staff_profiles
  add constraint staff_profiles_agency_fk
  foreign key (agency_id) references public.agencies(id) on delete restrict;

alter table public.staff_profiles
  add constraint staff_profiles_branch_fk
  foreign key (branch_uuid) references public.branches(id) on delete restrict;

create index if not exists idx_staff_profiles_agency_branch
  on public.staff_profiles(agency_id, branch_uuid, is_active);

-- -----------------------------------------------------------------------------
-- Scope columns on operational data
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  foreach tbl in array array[
    'packages','pilgrims','bookings','reservations','groups','visas','flights',
    'passenger_assignments','hotels','hotel_contracts','room_allocations',
    'transport_vehicles','transport_assignments','holy_site_camps','mutawwif_guides',
    'payments','documents','crm_leads','alerts','actions','incidents','sos_events',
    'invoices','contracts','suppliers','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I add column if not exists agency_id uuid', tbl);
      execute format('alter table public.%I add column if not exists branch_id uuid', tbl);
      execute format('create index if not exists %I on public.%I(agency_id, branch_id)', 'idx_' || tbl || '_agency_branch', tbl);
    end if;
  end loop;
END $$;

-- Assign legacy rows to the default agency/branch so branch isolation is meaningful.
DO $$
DECLARE
  tbl text;
  v_branch_id uuid;
  v_agency_id uuid;
BEGIN
  select id into v_agency_id from public.agencies where code = 'DEFAULT';
  select b.id into v_branch_id from public.branches b where b.agency_id = v_agency_id order by b.created_at limit 1;
  foreach tbl in array array[
    'packages','pilgrims','bookings','reservations','groups','visas','flights',
    'passenger_assignments','hotels','hotel_contracts','room_allocations',
    'transport_vehicles','transport_assignments','holy_site_camps','mutawwif_guides',
    'payments','documents','crm_leads','alerts','actions','incidents','sos_events',
    'invoices','contracts','suppliers','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('update public.%I set agency_id = $1, branch_id = $2 where agency_id is null or branch_id is null', tbl)
        using v_agency_id, v_branch_id;
    end if;
  end loop;
END $$;

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------
create table if not exists public.staff_permissions (
  id bigserial primary key,
  role text not null,
  resource text not null,
  action text not null,
  unique(role, resource, action)
);

truncate public.staff_permissions;

insert into public.staff_permissions(role, resource, action) values
  ('OPERATIONS_MANAGER','pilgrims','read'), ('OPERATIONS_MANAGER','pilgrims','create'), ('OPERATIONS_MANAGER','pilgrims','update'),
  ('OPERATIONS_MANAGER','bookings','read'), ('OPERATIONS_MANAGER','bookings','create'), ('OPERATIONS_MANAGER','bookings','update'),
  ('OPERATIONS_MANAGER','reservations','read'), ('OPERATIONS_MANAGER','reservations','update'),
  ('OPERATIONS_MANAGER','packages','read'), ('OPERATIONS_MANAGER','packages','create'), ('OPERATIONS_MANAGER','packages','update'),
  ('OPERATIONS_MANAGER','groups','read'), ('OPERATIONS_MANAGER','groups','create'), ('OPERATIONS_MANAGER','groups','update'),
  ('OPERATIONS_MANAGER','visas','read'), ('OPERATIONS_MANAGER','visas','update'),
  ('OPERATIONS_MANAGER','flights','read'), ('OPERATIONS_MANAGER','flights','create'), ('OPERATIONS_MANAGER','flights','update'),
  ('OPERATIONS_MANAGER','hotels','read'), ('OPERATIONS_MANAGER','hotels','create'), ('OPERATIONS_MANAGER','hotels','update'),
  ('OPERATIONS_MANAGER','room_allocations','read'), ('OPERATIONS_MANAGER','room_allocations','create'), ('OPERATIONS_MANAGER','room_allocations','update'),
  ('OPERATIONS_MANAGER','transport_vehicles','read'), ('OPERATIONS_MANAGER','transport_vehicles','create'), ('OPERATIONS_MANAGER','transport_vehicles','update'),
  ('OPERATIONS_MANAGER','transport_assignments','read'), ('OPERATIONS_MANAGER','transport_assignments','create'), ('OPERATIONS_MANAGER','transport_assignments','update'),
  ('OPERATIONS_MANAGER','documents','read'), ('OPERATIONS_MANAGER','documents','create'), ('OPERATIONS_MANAGER','documents','update'),
  ('OPERATIONS_MANAGER','incidents','read'), ('OPERATIONS_MANAGER','incidents','create'), ('OPERATIONS_MANAGER','incidents','update'),
  ('OPERATIONS_MANAGER','holy_site_camps','read'), ('OPERATIONS_MANAGER','holy_site_camps','create'), ('OPERATIONS_MANAGER','holy_site_camps','update'),
  ('OPERATIONS_MANAGER','mutawwif_guides','read'), ('OPERATIONS_MANAGER','mutawwif_guides','create'), ('OPERATIONS_MANAGER','mutawwif_guides','update'),
  ('VISA_AGENT','pilgrims','read'), ('VISA_AGENT','documents','read'), ('VISA_AGENT','documents','create'), ('VISA_AGENT','documents','update'),
  ('VISA_AGENT','visas','read'), ('VISA_AGENT','visas','create'), ('VISA_AGENT','visas','update'), ('VISA_AGENT','groups','read'), ('VISA_AGENT','bookings','read'),
  ('FINANCE','pilgrims','read'), ('FINANCE','bookings','read'), ('FINANCE','payments','read'), ('FINANCE','payments','create'),
  ('FINANCE','invoices','read'), ('FINANCE','invoices','create'), ('FINANCE','invoices','update'), ('FINANCE','suppliers','read'),
  ('FINANCE','contracts','read'), ('FINANCE','packages','read'),
  ('GUIDE','groups','read'), ('GUIDE','pilgrims','read'), ('GUIDE','incidents','read'), ('GUIDE','incidents','create'), ('GUIDE','incidents','update'),
  ('GUIDE','holy_site_camps','read'), ('GUIDE','transport_assignments','read'),
  ('CRM','crm_leads','read'), ('CRM','crm_leads','create'), ('CRM','crm_leads','update'), ('CRM','crm_leads','delete'),
  ('CRM','pilgrims','read'), ('CRM','bookings','read'),
  ('AGENT','reservations','read'), ('AGENT','reservations','create'), ('AGENT','reservations','update'), ('AGENT','pilgrims','read'), ('AGENT','pilgrims','create'), ('AGENT','pilgrims','update'),
  ('AGENT','bookings','read'), ('AGENT','bookings','create'), ('AGENT','bookings','update'), ('AGENT','packages','read'), ('AGENT','groups','read');

create or replace function public.staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff_profiles
  where user_id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.staff_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from public.staff_profiles
  where user_id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.staff_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_uuid from public.staff_profiles
  where user_id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.has_permission(p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.staff_role() = 'ADMIN'
      or exists (
        select 1 from public.staff_permissions sp
        where sp.role = public.staff_role()
          and sp.resource = p_resource
          and sp.action = p_action
      );
$$;

create or replace function public.row_in_staff_scope(p_agency_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.staff_role() = 'ADMIN'
      or (p_agency_id = public.staff_agency_id() and p_branch_id = public.staff_branch_id());
$$;

-- -----------------------------------------------------------------------------
-- Automatic branch stamping
-- -----------------------------------------------------------------------------
create or replace function public.stamp_staff_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and public.staff_role() is not null then
    if new.agency_id is null then new.agency_id := public.staff_agency_id(); end if;
    if new.branch_id is null then new.branch_id := public.staff_branch_id(); end if;
  else
    select id into new.agency_id from public.agencies where code = 'DEFAULT' limit 1;
    select b.id into new.branch_id from public.branches b where b.agency_id = new.agency_id and b.code = 'HQ' limit 1;
  end if;
  return new;
end;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  foreach tbl in array array[
    'packages','pilgrims','bookings','reservations','groups','visas','flights',
    'passenger_assignments','hotels','hotel_contracts','room_allocations',
    'transport_vehicles','transport_assignments','holy_site_camps','mutawwif_guides',
    'payments','documents','crm_leads','alerts','actions','incidents','sos_events',
    'invoices','contracts','suppliers','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop trigger if exists trg_stamp_staff_scope on public.%I', tbl);
      execute format('create trigger trg_stamp_staff_scope before insert on public.%I for each row execute function public.stamp_staff_scope()', tbl);
    end if;
  end loop;
END $$;

-- -----------------------------------------------------------------------------
-- Stronger references and domain constraints
-- -----------------------------------------------------------------------------
create or replace function public.assign_reservation_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never trust a client supplied reference.
  new.reference := 'HAJ-DZA-' || to_char(current_date, 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  return new;
end;
$$;

DO $$ BEGIN
  if to_regclass('public.reservations') is not null then
    alter table public.reservations drop constraint if exists reservations_travelers_check;
    alter table public.reservations add constraint reservations_travelers_check check (travelers between 1 and 20);
    alter table public.reservations add constraint reservations_date_order check (end_date >= start_date);
    alter table public.reservations add constraint reservations_name_length check (char_length(trim(name)) between 2 and 120);
    alter table public.reservations add constraint reservations_phone_length check (char_length(trim(phone)) between 8 and 30);
    alter table public.reservations add constraint reservations_notes_length check (notes is null or char_length(notes) <= 4000);
  end if;
END $$;

DO $$ BEGIN
  if to_regclass('public.packages') is not null then
    alter table public.packages drop constraint if exists packages_price_dzd_nonnegative;
    alter table public.packages add constraint packages_price_dzd_nonnegative check (coalesce(price_dzd,0) >= 0);
    alter table public.packages drop constraint if exists packages_price_sar_nonnegative;
    alter table public.packages add constraint packages_price_sar_nonnegative check (coalesce(price_sar,0) >= 0);
    alter table public.packages drop constraint if exists packages_seats_nonnegative;
    alter table public.packages add constraint packages_seats_nonnegative check (coalesce(seats_available,0) >= 0);
  end if;
END $$;

DO $$ BEGIN
  if to_regclass('public.bookings') is not null then
    alter table public.bookings drop constraint if exists bookings_total_dzd_nonnegative;
    alter table public.bookings add constraint bookings_total_dzd_nonnegative check (coalesce(total_dzd,0) >= 0);
    alter table public.bookings drop constraint if exists bookings_total_sar_nonnegative;
    alter table public.bookings add constraint bookings_total_sar_nonnegative check (coalesce(total_sar,0) >= 0);
    alter table public.bookings drop constraint if exists bookings_paid_dzd_nonnegative;
    alter table public.bookings add constraint bookings_paid_dzd_nonnegative check (coalesce(paid_dzd,0) >= 0);
    alter table public.bookings drop constraint if exists bookings_paid_sar_nonnegative;
    alter table public.bookings add constraint bookings_paid_sar_nonnegative check (coalesce(paid_sar,0) >= 0);
    alter table public.bookings drop constraint if exists bookings_paid_not_over_total_dzd;
    alter table public.bookings add constraint bookings_paid_not_over_total_dzd check (coalesce(paid_dzd,0) <= coalesce(total_dzd,0));
    alter table public.bookings drop constraint if exists bookings_paid_not_over_total_sar;
    alter table public.bookings add constraint bookings_paid_not_over_total_sar check (coalesce(paid_sar,0) <= coalesce(total_sar,0));
  end if;
END $$;

DO $$ BEGIN
  if to_regclass('public.payments') is not null then
    alter table public.payments drop constraint if exists payments_amount_dzd_nonnegative;
    alter table public.payments add constraint payments_amount_dzd_nonnegative check (coalesce(amount_dzd,0) >= 0);
    alter table public.payments drop constraint if exists payments_amount_sar_nonnegative;
    alter table public.payments add constraint payments_amount_sar_nonnegative check (coalesce(amount_sar,0) >= 0);
  end if;
END $$;

-- Helpful relational integrity that was missing in earlier schema generations.
DO $$ BEGIN
  if to_regclass('public.visas') is not null then
    alter table public.visas drop constraint if exists fk_visas_pilgrim;
    alter table public.visas add constraint fk_visas_pilgrim foreign key (pilgrim_id) references public.pilgrims(id) on delete cascade;
  end if;
  if to_regclass('public.documents') is not null then
    alter table public.documents drop constraint if exists fk_documents_pilgrim;
    alter table public.documents add constraint fk_documents_pilgrim foreign key (pilgrim_id) references public.pilgrims(id) on delete cascade;
  end if;
  if to_regclass('public.room_allocations') is not null then
    alter table public.room_allocations drop constraint if exists fk_room_allocations_hotel;
    alter table public.room_allocations add constraint fk_room_allocations_hotel foreign key (hotel_id) references public.hotels(id) on delete restrict;
    alter table public.room_allocations drop constraint if exists fk_room_allocations_pilgrim;
    alter table public.room_allocations add constraint fk_room_allocations_pilgrim foreign key (pilgrim_id) references public.pilgrims(id) on delete cascade;
  end if;
  if to_regclass('public.passenger_assignments') is not null then
    alter table public.passenger_assignments drop constraint if exists fk_passenger_assignments_flight;
    alter table public.passenger_assignments add constraint fk_passenger_assignments_flight foreign key (flight_id) references public.flights(id) on delete cascade;
    alter table public.passenger_assignments drop constraint if exists fk_passenger_assignments_pilgrim;
    alter table public.passenger_assignments add constraint fk_passenger_assignments_pilgrim foreign key (pilgrim_id) references public.pilgrims(id) on delete cascade;
  end if;
END $$;

create index if not exists idx_pilgrims_passport on public.pilgrims(lower(trim(passport_number))) where passport_number is not null and trim(passport_number) <> '';
create index if not exists idx_reservations_phone_created on public.reservations(phone, created_at desc);

-- -----------------------------------------------------------------------------
-- Immutable financial entries
-- -----------------------------------------------------------------------------
create or replace function public.prevent_financial_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Financial transactions are immutable. Use a reversal transaction.' using errcode = '42501';
  end if;
  if old.status = 'CONFIRMED' and tg_op = 'UPDATE' then
    raise exception 'Confirmed financial transactions are immutable. Use a reversal transaction.' using errcode = '42501';
  end if;
  return new;
end;
$$;

DO $$ BEGIN
  if to_regclass('public.payments') is not null then
    drop trigger if exists trg_prevent_financial_mutation on public.payments;
    create trigger trg_prevent_financial_mutation before update or delete on public.payments
      for each row execute function public.prevent_financial_mutation();
  end if;
END $$;

-- -----------------------------------------------------------------------------
-- Atomic reservation -> booking confirmation workflow
-- -----------------------------------------------------------------------------
create or replace function public.confirm_reservation_transaction(
  p_reservation_id uuid,
  p_package_id uuid,
  p_group_id uuid default null,
  p_passport_number text default null,
  p_payment_amount_dzd numeric default 0,
  p_payment_amount_sar numeric default 0,
  p_payment_method text default 'Cash',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.reservations%rowtype;
  p public.packages%rowtype;
  pilgrim_id uuid;
  booking_id uuid;
  booking_reference text;
  travelers int;
  total_dzd numeric(14,2);
  total_sar numeric(14,2);
begin
  if not public.has_permission('reservations','update') and public.staff_role() <> 'ADMIN' then
    raise exception 'Not authorized to confirm reservations' using errcode = '42501';
  end if;

  select * into r from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if not public.row_in_staff_scope(r.agency_id, r.branch_id) then raise exception 'Reservation outside staff scope' using errcode = '42501'; end if;
  if r.status = 'confirmed' then raise exception 'Reservation already confirmed'; end if;

  select * into p from public.packages where id = p_package_id for update;
  if not found then raise exception 'Package not found'; end if;
  if p.status <> 'ACTIVE' then raise exception 'Package is not active'; end if;
  travelers := greatest(coalesce(r.travelers,1),1);
  if coalesce(p.seats_available,0) < travelers then raise exception 'Package capacity exceeded'; end if;

  total_dzd := coalesce(p.price_dzd,0) * travelers;
  total_sar := coalesce(p.price_sar,0) * travelers;
  if p_payment_amount_dzd < 0 or p_payment_amount_sar < 0 then raise exception 'Payment amount cannot be negative'; end if;
  if p_payment_amount_dzd > total_dzd or p_payment_amount_sar > total_sar then raise exception 'Payment exceeds booking total'; end if;

  insert into public.pilgrims(
    agency_id, branch_id, full_name, full_name_ar, passport_number, phone, email,
    group_id, package_id, payment_status, visa_status, status
  ) values (
    r.agency_id, r.branch_id, r.name, r.name, nullif(trim(p_passport_number),''), r.phone, nullif(trim(r.email),''),
    p_group_id, p.id,
    case when p_payment_amount_dzd > 0 or p_payment_amount_sar > 0 then 'PARTIAL' else 'NONE' end,
    'NOT_STARTED', 'REGISTERED'
  ) returning id into pilgrim_id;

  booking_reference := 'BOOK-' || to_char(current_date,'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.bookings(
    agency_id, branch_id, reference, pilgrim_id, package_id, group_id, status, travelers,
    total_dzd, total_sar, paid_dzd, paid_sar, payment_method, notes, confirmed_at
  ) values (
    r.agency_id, r.branch_id, booking_reference, pilgrim_id, p.id, p_group_id, 'CONFIRMED', travelers,
    total_dzd, total_sar, p_payment_amount_dzd, p_payment_amount_sar, p_payment_method, p_notes, now()
  ) returning id into booking_id;

  if p_payment_amount_dzd > 0 or p_payment_amount_sar > 0 then
    insert into public.payments(
      agency_id, branch_id, booking_id, pilgrim_id, amount_dzd, amount_sar, method, status, reference, notes
    ) values (
      r.agency_id, r.branch_id, booking_id, pilgrim_id, p_payment_amount_dzd, p_payment_amount_sar, p_payment_method, 'CONFIRMED',
      'PAY-' || to_char(current_date,'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)), p_notes
    );
  end if;

  update public.packages
  set seats_available = seats_available - travelers,
      updated_at = now()
  where id = p.id;

  update public.reservations
  set status = 'confirmed', updated_at = now()
  where id = r.id;

  return jsonb_build_object('booking_id', booking_id, 'booking_reference', booking_reference, 'pilgrim_id', pilgrim_id);
end;
$$;

revoke all on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) from public;
grant execute on function public.confirm_reservation_transaction(uuid,uuid,uuid,text,numeric,numeric,text,text) to authenticated;

create or replace function public.cancel_booking_transaction(
  p_booking_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
begin
  if not public.has_permission('bookings','update') and public.staff_role() <> 'ADMIN' then
    raise exception 'Not authorized to cancel bookings' using errcode = '42501';
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if not public.row_in_staff_scope(b.agency_id, b.branch_id) then raise exception 'Booking outside staff scope' using errcode = '42501'; end if;
  if b.status = 'CANCELLED' then return jsonb_build_object('booking_id', b.id, 'status', 'CANCELLED'); end if;

  update public.bookings set status = 'CANCELLED', notes = concat_ws(E'\n', notes, nullif(trim(p_reason),'')), updated_at = now() where id = b.id;
  if b.package_id is not null then
    update public.packages set seats_available = seats_available + coalesce(b.travelers,1), updated_at = now() where id = b.package_id;
  end if;
  return jsonb_build_object('booking_id', b.id, 'status', 'CANCELLED');
end;
$$;

revoke all on function public.cancel_booking_transaction(uuid,text) from public;
grant execute on function public.cancel_booking_transaction(uuid,text) to authenticated;

-- -----------------------------------------------------------------------------
-- Server-generated audit log
-- -----------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists actor_id uuid,
  add column if not exists actor_role text,
  add column if not exists agency_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists action text,
  add column if not exists entity text,
  add column if not exists entity_id text,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb,
  add column if not exists request_id uuid,
  add column if not exists ip_address inet,
  add column if not exists user_agent text,
  add column if not exists created_at timestamptz default now();

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  row_id text;
  row_agency uuid;
  row_branch uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  row_id := coalesce((row_data->>'id'), (row_data->>'reference'));
  row_agency := nullif(row_data->>'agency_id','')::uuid;
  row_branch := nullif(row_data->>'branch_id','')::uuid;
  insert into public.audit_logs(
    actor_id, actor_role, agency_id, branch_id, action, entity, entity_id,
    before_data, after_data, request_id, user_agent, created_at
  ) values (
    auth.uid(), public.staff_role(), row_agency, row_branch,
    tg_op, tg_table_name, row_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end,
    gen_random_uuid(), current_setting('request.headers', true), now()
  );
  return coalesce(new, old);
end;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  foreach tbl in array array[
    'packages','pilgrims','bookings','reservations','groups','visas','flights',
    'passenger_assignments','hotels','hotel_contracts','room_allocations',
    'transport_vehicles','transport_assignments','holy_site_camps','mutawwif_guides',
    'payments','documents','crm_leads','alerts','actions','incidents','sos_events',
    'invoices','contracts','suppliers','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop trigger if exists trg_write_audit_log on public.%I', tbl);
      execute format('create trigger trg_write_audit_log after insert or update or delete on public.%I for each row execute function public.write_audit_log()', tbl);
    end if;
  end loop;
END $$;

-- -----------------------------------------------------------------------------
-- Rebuild RLS in one authoritative layer
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  foreach tbl in array array[
    'packages','pilgrims','bookings','reservations','groups','visas','flights',
    'passenger_assignments','hotels','hotel_contracts','room_allocations',
    'transport_vehicles','transport_assignments','holy_site_camps','mutawwif_guides',
    'payments','documents','crm_leads','alerts','actions','incidents','sos_events',
    'invoices','contracts','suppliers','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all on public.%I from anon', tbl);
      execute format('revoke all on public.%I from authenticated', tbl);
      execute format('drop policy if exists staff_select on public.%I', tbl);
      execute format('drop policy if exists staff_insert on public.%I', tbl);
      execute format('drop policy if exists staff_update on public.%I', tbl);
      execute format('drop policy if exists staff_delete on public.%I', tbl);
      execute format('create policy staff_select on public.%I for select to authenticated using (public.has_permission(%L,''read'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl);
      execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.has_permission(%L,''create'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl);
      execute format('create policy staff_update on public.%I for update to authenticated using (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id)) with check (public.has_permission(%L,''update'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl, tbl);
      execute format('create policy staff_delete on public.%I for delete to authenticated using (public.has_permission(%L,''delete'') and public.row_in_staff_scope(agency_id, branch_id))', tbl, tbl);
    end if;
  end loop;
END $$;

-- Audit is never writable by clients.
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
drop policy if exists audit_select_admin on public.audit_logs;
create policy audit_select_admin on public.audit_logs for select to authenticated using (public.staff_role() = 'ADMIN' and public.row_in_staff_scope(agency_id, branch_id));

-- Reservations: anonymous is insert-only. Staff access is role-controlled.
DO $$ BEGIN
  if to_regclass('public.reservations') is not null then
      drop policy if exists reservations_anon_insert on public.reservations;
  end if;
END $$;

-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- Public reservation anti-abuse rate limit (Edge Function only)
-- -----------------------------------------------------------------------------
create table if not exists public.reservation_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.reservation_rate_limits enable row level security;
revoke all on public.reservation_rate_limits from anon, authenticated;

create or replace function public.consume_reservation_rate_limit(
  p_ip_hash text,
  p_window_seconds integer default 600,
  p_max_requests integer default 5
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.reservation_rate_limits%rowtype;
begin
  insert into public.reservation_rate_limits(ip_hash, window_started_at, request_count)
  values (p_ip_hash, v_now, 1)
  on conflict (ip_hash) do update set
    window_started_at = case when extract(epoch from (v_now - public.reservation_rate_limits.window_started_at)) >= p_window_seconds then v_now else public.reservation_rate_limits.window_started_at end,
    request_count = case when extract(epoch from (v_now - public.reservation_rate_limits.window_started_at)) >= p_window_seconds then 1 else public.reservation_rate_limits.request_count + 1 end,
    updated_at = v_now
  returning * into v_row;

  return v_row.request_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_reservation_rate_limit(text,integer,integer) from public, anon, authenticated;

-- Public package catalog function (single source of truth, no raw package table access)
-- -----------------------------------------------------------------------------
alter table public.packages
  add column if not exists type text default 'UMRAH',
  add column if not exists duration_label text,
  add column if not exists tagline text,
  add column if not exists image_url text,
  add column if not exists includes jsonb default '[]'::jsonb;

create or replace function public.get_public_packages()
returns table (
  id uuid,
  code text,
  name text,
  name_ar text,
  name_fr text,
  price_dzd numeric,
  price_sar numeric,
  duration_label text,
  type text,
  tagline text,
  image_url text,
  includes jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.code, p.name, p.name_ar, p.name_fr, p.price_dzd, p.price_sar,
         p.duration_label, p.type, p.tagline, p.image_url, p.includes
  from public.packages p
  where p.status = 'ACTIVE'
  order by p.created_at desc, p.name asc;
$$;

revoke all on function public.get_public_packages() from public;
grant execute on function public.get_public_packages() to anon, authenticated;

-- Seed is deliberately excluded from production migrations. Use supabase/seed.dev.sql for demo data.
