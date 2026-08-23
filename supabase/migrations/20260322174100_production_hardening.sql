-- Production hardening: close anonymous access to operational data,
-- introduce staff authorization, and make public reservations write-only.

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'AGENT' check (role in ('ADMIN','AGENT','FINANCE','GUIDE')),
  branch_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_profiles enable row level security;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles
    where user_id = auth.uid() and is_active = true and role = 'ADMIN'
  );
$$;

revoke all on public.staff_profiles from anon, authenticated;
grant select on public.staff_profiles to authenticated;

drop policy if exists staff_profile_self_select on public.staff_profiles;
create policy staff_profile_self_select on public.staff_profiles
for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- Revoke the dangerous broad grants/policies created by earlier prototype migrations.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'packages','pilgrims','bookings','reservations','groups','visas','flights',
    'transport_vehicles','transport_assignments','hotels','hotel_contracts',
    'room_allocations','holy_site_camps','mutawwif_guides','payments','documents',
    'crm_leads','alerts','actions','incidents','sos_events','invoices','contracts',
    'suppliers','passenger_assignments','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('alter table public.%I enable row level security', tbl);
      execute format('revoke all on public.%I from anon', tbl);
      execute format('revoke all on public.%I from authenticated', tbl);
      execute format('drop policy if exists enable_all_anon on public.%I', tbl);
      execute format('drop policy if exists "Enable all" on public.%I', tbl);
      execute format('drop policy if exists anon_read_reservations on public.%I', tbl);
      execute format('drop policy if exists reservations_anon_insert on public.%I', tbl);
      execute format('drop policy if exists staff_full_access on public.%I', tbl);
    end if;
  end loop;
end $$;

-- Authenticated staff gets operational CRUD. Anonymous users get no operational access.
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'packages','pilgrims','bookings','groups','visas','flights',
    'transport_vehicles','transport_assignments','hotels','hotel_contracts',
    'room_allocations','holy_site_camps','mutawwif_guides','payments','documents',
    'crm_leads','alerts','actions','incidents','sos_events','invoices','contracts',
    'suppliers','passenger_assignments','tickets'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
      execute format('create policy staff_full_access on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', tbl);
    end if;
  end loop;
end $$;

-- Audit history is append-only for staff.
DO $$ BEGIN
if to_regclass('public.audit_logs') is not null then
  grant select, insert on public.audit_logs to authenticated;
  drop policy if exists audit_staff_access on public.audit_logs;
  create policy audit_staff_access on public.audit_logs for select to authenticated using (public.is_staff());
  create policy audit_staff_insert on public.audit_logs for insert to authenticated with check (public.is_staff());
end if;
END $$;

-- Reservations are intentionally public-write because the public website uses them.
-- They are never publicly readable/updated/deleted.
DO $$ BEGIN
if exists (select 1 from pg_class where relname = 'reservations' and relnamespace = 'public'::regnamespace) then
  create policy reservations_staff_access on public.reservations
    for all to authenticated
    using (public.is_staff())
    with check (public.is_staff());
end if;
END $$;

drop policy if exists reservations_anon_insert on public.reservations;

-- Settings may be read publicly for the departure countdown, but only staff can write.
DO $$ BEGIN
if exists (select 1 from pg_class where relname = 'settings' and relnamespace = 'public'::regnamespace) then
  drop policy if exists settings_public_read on public.settings;
  drop policy if exists settings_staff_write on public.settings;
  grant select on public.settings to anon;
  grant select, insert, update, delete on public.settings to authenticated;
  create policy settings_public_read on public.settings for select to anon using (true);
  create policy settings_staff_write on public.settings for all to authenticated using (public.is_staff()) with check (public.is_staff());
end if;
END $$;

-- The public site already renders its package catalog from local data, so package data stays staff-only.

-- Unique, server-generated reservation references eliminate client-side collisions.
create or replace function public.assign_reservation_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := 'HAJ-DZA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_reservation_reference on public.reservations;
create trigger trg_assign_reservation_reference
before insert on public.reservations
for each row execute function public.assign_reservation_reference();

-- Prevent basic reservation payload abuse at the database boundary.
do $$
begin
  if to_regclass('public.reservations') is not null then
    execute 'alter table public.reservations drop constraint if exists reservations_travelers_check';
    execute 'alter table public.reservations add constraint reservations_travelers_check check (travelers between 1 and 20)';
  end if;
exception when undefined_column then null;
end $$;

create index if not exists idx_staff_profiles_active_role on public.staff_profiles(role, is_active);
