-- Full enterprise gap closure: accounting, concurrency, state machines,
-- master data, queues, governance, Hajj snapshots, document access audit.

-- ---------- Core versioning / money metadata ----------
alter table public.bookings add column if not exists version integer not null default 1;
alter table public.bookings add column if not exists package_price_dzd_at_booking numeric(14,2);
alter table public.bookings add column if not exists package_price_sar_at_booking numeric(14,2);
alter table public.bookings add column if not exists package_version_at_booking integer;
alter table public.bookings add column if not exists currency_mode text default 'DUAL';
alter table public.bookings add column if not exists fx_rate numeric(18,6);
alter table public.bookings add column if not exists fx_rate_date date;
alter table public.payments add column if not exists currency text default 'DZD';
alter table public.payments add column if not exists exchange_rate numeric(18,6);
alter table public.payments add column if not exists exchange_rate_date date;
alter table public.invoices add column if not exists currency text default 'DZD';
alter table public.invoices add column if not exists exchange_rate numeric(18,6);
alter table public.invoices add column if not exists exchange_rate_date date;

update public.bookings b
set package_price_dzd_at_booking = coalesce(b.package_price_dzd_at_booking, p.price_dzd, 0),
    package_price_sar_at_booking = coalesce(b.package_price_sar_at_booking, p.price_sar, 0),
    package_version_at_booking = coalesce(b.package_version_at_booking, p.version, 1)
from public.packages p
where p.id = b.package_id;

-- ---------- Master data ----------
create table if not exists public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  name_ar text,
  name_fr text,
  decimals smallint not null default 2 check (decimals between 0 and 6),
  is_active boolean not null default true
);
insert into public.currencies(code,name,name_ar,name_fr) values
 ('DZD','Algerian Dinar','الدينار الجزائري','Dinar algérien'),
 ('SAR','Saudi Riyal','الريال السعودي','Riyal saoudien'),
 ('EUR','Euro','اليورو','Euro')
on conflict (code) do update set name=excluded.name,name_ar=excluded.name_ar,name_fr=excluded.name_fr;

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null references public.currencies(code),
  quote_currency text not null references public.currencies(code),
  rate numeric(18,8) not null check (rate > 0),
  rate_date date not null,
  source text not null default 'MANUAL',
  created_at timestamptz not null default now(),
  unique(base_currency,quote_currency,rate_date)
);

create table if not exists public.payment_methods (
  code text primary key,
  label text not null,
  currency_scope text,
  is_active boolean not null default true
);
insert into public.payment_methods(code,label,currency_scope) values
 ('CASH','Cash','DZD,SAR'),('BANK_TRANSFER','Bank Transfer','DZD,SAR'),('CARD','Card','DZD,SAR'),
 ('CHECK','Check','DZD'),('CCP','CCP','DZD'),('BARIDIMOB','BaridiMob','DZD')
on conflict (code) do nothing;

create table if not exists public.airports (
  code text primary key,
  name text not null,
  city text,
  country_code text,
  timezone text,
  is_active boolean not null default true
);
create table if not exists public.airlines (
  code text primary key,
  name text not null,
  is_active boolean not null default true
);
create table if not exists public.countries (
  code text primary key,
  name text not null,
  name_ar text,
  name_fr text,
  nationality_label text,
  is_active boolean not null default true
);

-- ---------- Double-entry accounting ----------
create table if not exists public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'OPEN' check(status in ('OPEN','CLOSED','LOCKED')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  unique(agency_id,label),
  check(end_date >= start_date)
);

create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  code text not null,
  name text not null,
  account_type text not null check(account_type in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  currency_code text references public.currencies(code),
  parent_id uuid references public.chart_of_accounts(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(agency_id,code)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  fiscal_period_id uuid references public.fiscal_periods(id),
  reference text not null,
  entry_date date not null default current_date,
  description text not null,
  source_type text,
  source_id uuid,
  status text not null default 'POSTED' check(status in ('DRAFT','POSTED','VOID')),
  created_by uuid,
  created_at timestamptz not null default now(),
  request_id uuid
);
create unique index if not exists ux_journal_entries_agency_reference on public.journal_entries(agency_id,reference);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  agency_id uuid not null,
  branch_id uuid,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  currency_code text not null references public.currencies(code),
  debit numeric(18,2) not null default 0 check(debit >= 0),
  credit numeric(18,2) not null default 0 check(credit >= 0),
  memo text,
  created_at timestamptz not null default now(),
  check((debit = 0) <> (credit = 0))
);
create index if not exists idx_journal_lines_entry on public.journal_lines(journal_entry_id);
create index if not exists idx_journal_lines_account_date on public.journal_lines(account_id,created_at desc);

create or replace function public.assert_journal_balanced(p_entry_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_bad boolean;
begin
  select exists(
    select 1 from (
      select currency_code, round(coalesce(sum(debit),0),2) d, round(coalesce(sum(credit),0),2) c
      from public.journal_lines where journal_entry_id=p_entry_id group by currency_code
    ) x where x.d <> x.c
  ) into v_bad;
  if v_bad then raise exception 'Journal entry is not balanced by currency' using errcode='23514'; end if;
end $$;

-- Default accounts per active agency.
insert into public.chart_of_accounts(agency_id,code,name,account_type,currency_code)
select a.id,'1100','Cash DZD','ASSET','DZD' from public.agencies a where not exists(select 1 from public.chart_of_accounts c where c.agency_id=a.id and c.code='1100');
insert into public.chart_of_accounts(agency_id,code,name,account_type,currency_code)
select a.id,'1101','Cash SAR','ASSET','SAR' from public.agencies a where not exists(select 1 from public.chart_of_accounts c where c.agency_id=a.id and c.code='1101');
insert into public.chart_of_accounts(agency_id,code,name,account_type,currency_code)
select a.id,'1200','Accounts Receivable DZD','ASSET','DZD' from public.agencies a where not exists(select 1 from public.chart_of_accounts c where c.agency_id=a.id and c.code='1200');
insert into public.chart_of_accounts(agency_id,code,name,account_type,currency_code)
select a.id,'1201','Accounts Receivable SAR','ASSET','SAR' from public.agencies a where not exists(select 1 from public.chart_of_accounts c where c.agency_id=a.id and c.code='1201');
insert into public.chart_of_accounts(agency_id,code,name,account_type,currency_code)
select a.id,'4000','Hajj/Umrah Revenue DZD','REVENUE','DZD' from public.agencies a where not exists(select 1 from public.chart_of_accounts c where c.agency_id=a.id and c.code='4000');
insert into public.chart_of_accounts(agency_id,code,name,account_type,currency_code)
select a.id,'4001','Hajj/Umrah Revenue SAR','REVENUE','SAR' from public.agencies a where not exists(select 1 from public.chart_of_accounts c where c.agency_id=a.id and c.code='4001');
insert into public.chart_of_accounts(agency_id,code,name,account_type,currency_code)
select a.id,'5000','Supplier Costs','EXPENSE','DZD' from public.agencies a where not exists(select 1 from public.chart_of_accounts c where c.agency_id=a.id and c.code='5000');

insert into public.fiscal_periods(agency_id,label,start_date,end_date)
select a.id, extract(year from current_date)::text, make_date(extract(year from current_date)::int,1,1), make_date(extract(year from current_date)::int,12,31)
from public.agencies a
where not exists(select 1 from public.fiscal_periods f where f.agency_id=a.id and f.label=extract(year from current_date)::text);

-- ---------- AR / AP / bank / reconciliation ----------
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  name text not null,
  institution text,
  account_reference text,
  currency_code text not null references public.currencies(code),
  opening_balance numeric(18,2) not null default 0,
  current_balance numeric(18,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  supplier_id uuid references public.suppliers(id) on delete restrict,
  bill_number text not null,
  bill_date date not null,
  due_date date,
  currency_code text not null references public.currencies(code),
  amount numeric(18,2) not null check(amount>=0),
  paid_amount numeric(18,2) not null default 0 check(paid_amount>=0),
  status text not null default 'OPEN' check(status in ('DRAFT','OPEN','PARTIALLY_PAID','PAID','OVERDUE','VOID')),
  notes text,
  created_at timestamptz not null default now(),
  unique(agency_id,bill_number)
);
create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid references public.invoices(id) on delete restrict,
  amount_dzd numeric(18,2) not null default 0,
  amount_sar numeric(18,2) not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  invoice_id uuid references public.invoices(id) on delete restrict,
  number text not null,
  amount_dzd numeric(18,2) not null default 0,
  amount_sar numeric(18,2) not null default 0,
  reason text not null,
  status text not null default 'ISSUED' check(status in ('DRAFT','ISSUED','VOID')),
  created_at timestamptz not null default now(),
  unique(agency_id,number)
);

-- ---------- Workflow queues ----------
create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid,
  branch_id uuid,
  channel text not null check(channel in ('IN_APP','EMAIL','SMS','WHATSAPP','PUSH')),
  recipient text not null,
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','SENT','FAILED','DEAD_LETTER')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists idx_notification_queue_due on public.notification_queue(status,next_attempt_at);
create table if not exists public.workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid,
  branch_id uuid,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD_LETTER')),
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists idx_workflow_jobs_due on public.workflow_jobs(status,run_at);

-- ---------- Audit / document governance ----------
alter table public.audit_logs add column if not exists request_id uuid;
alter table public.audit_logs add column if not exists ip_address inet;
alter table public.audit_logs add column if not exists user_agent text;
create table if not exists public.document_access_logs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  document_id uuid not null references public.documents(id) on delete restrict,
  accessed_by uuid,
  access_type text not null check(access_type in ('VIEW','DOWNLOAD','PREVIEW','GENERATE_SIGNED_URL')),
  created_at timestamptz not null default now(),
  request_id uuid
);
create index if not exists idx_document_access_document_created on public.document_access_logs(document_id,created_at desc);

create or replace function public.populate_audit_request_context()
returns trigger language plpgsql security definer set search_path=public as $$
declare h jsonb;
begin
  begin h := current_setting('request.headers', true)::jsonb; exception when others then h := '{}'::jsonb; end;
  new.request_id := coalesce(new.request_id, nullif(current_setting('request.id', true), '')::uuid);
  new.ip_address := coalesce(new.ip_address, nullif(h->>'x-forwarded-for','')::inet);
  new.user_agent := coalesce(new.user_agent, h->>'user-agent');
  return new;
end $$;
drop trigger if exists trg_audit_request_context on public.audit_logs;
create trigger trg_audit_request_context before insert on public.audit_logs for each row execute function public.populate_audit_request_context();

create or replace function public.prevent_audit_mutation()
returns trigger language plpgsql security definer set search_path=public as $$
begin raise exception 'Audit logs are immutable' using errcode='42501'; end $$;
drop trigger if exists trg_audit_no_update on public.audit_logs;
create trigger trg_audit_no_update before update or delete on public.audit_logs for each row execute function public.prevent_audit_mutation();

-- ---------- Data quality / Hajj snapshots ----------
create table if not exists public.data_quality_issues (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  entity_type text not null,
  entity_id uuid,
  issue_type text not null,
  severity text not null default 'MEDIUM' check(severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text not null default 'OPEN' check(status in ('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED')),
  details jsonb not null default '{}'::jsonb,
  assigned_to uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_dq_status_severity on public.data_quality_issues(status,severity,created_at desc);

create table if not exists public.readiness_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  code text not null,
  label text not null,
  weight numeric(8,2) not null default 1,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  unique(agency_id,code)
);

create table if not exists public.manifest_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  group_id uuid not null references public.groups(id) on delete restrict,
  version integer not null,
  snapshot jsonb not null,
  frozen_at timestamptz not null default now(),
  frozen_by uuid,
  unique(group_id,version)
);

create table if not exists public.missing_pilgrim_events (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  branch_id uuid,
  group_id uuid references public.groups(id) on delete restrict,
  pilgrim_id uuid references public.pilgrims(id) on delete restrict,
  last_known_location text,
  bus_reference text,
  status text not null default 'OPEN' check(status in ('OPEN','LOCATING','FOUND','ESCALATED','CLOSED')),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  notes text
);

alter table public.transport_vehicles add column if not exists license_expiry date;
alter table public.transport_vehicles add column if not exists insurance_expiry date;
alter table public.transport_vehicles add column if not exists maintenance_due date;
alter table public.transport_vehicles add column if not exists capacity_reserved integer not null default 0;

-- ---------- Optimistic concurrency ----------
create or replace function public.update_booking_optimistic(p_booking_id uuid, p_expected_version integer, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype;
new_version integer;
begin
  if not public.is_staff() then raise exception 'Unauthorized' using errcode='42501'; end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or not public.row_in_staff_scope(b.agency_id,b.branch_id) then raise exception 'Booking not found in scope' using errcode='42501'; end if;
  if b.version <> p_expected_version then raise exception 'Booking was modified by another user' using errcode='40001'; end if;
  update public.bookings set
    notes = case when p_patch ? 'notes' then p_patch->>'notes' else notes end,
    payment_method = case when p_patch ? 'payment_method' then p_patch->>'payment_method' else payment_method end,
    version = version + 1,
    updated_at = now()
  where id=p_booking_id returning version into new_version;
  return jsonb_build_object('booking_id',p_booking_id,'version',new_version);
end $$;
revoke all on function public.update_booking_optimistic(uuid,integer,jsonb) from public,anon;
grant execute on function public.update_booking_optimistic(uuid,integer,jsonb) to authenticated;

-- ---------- Booking state machine ----------
create or replace function public.transition_booking_state(p_booking_id uuid, p_to_status text, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.bookings%rowtype; allowed boolean := false;
begin
  perform set_config('app.allow_direct_sensitive_update','1',true);
  if not public.has_permission('bookings','update') and public.staff_role()<>'ADMIN' then raise exception 'Not authorized' using errcode='42501'; end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or not public.row_in_staff_scope(b.agency_id,b.branch_id) then raise exception 'Booking not found in scope' using errcode='42501'; end if;
  if p_expected_version is not null and b.version <> p_expected_version then raise exception 'Booking changed by another user' using errcode='40001'; end if;
  allowed :=
    (b.status='PENDING' and p_to_status in ('CONFIRMED','CANCELLED')) or
    (b.status='CONFIRMED' and p_to_status in ('PAID','CANCELLED','TRAVELING')) or
    (b.status='PARTIAL' and p_to_status in ('PAID','CANCELLED')) or
    (b.status='PAID' and p_to_status in ('TRAVELING','CANCELLED')) or
    (b.status='TRAVELING' and p_to_status in ('COMPLETED')) or
    (b.status='COMPLETED' and p_to_status in ('COMPLETED'));
  if not allowed then raise exception 'Invalid booking state transition: % -> %',b.status,p_to_status using errcode='22023'; end if;
  update public.bookings set status=p_to_status, version=version+1, updated_at=now() where id=b.id;
  return jsonb_build_object('booking_id',b.id,'status',p_to_status,'version',b.version+1);
end $$;
revoke all on function public.transition_booking_state(uuid,text,integer) from public,anon;
grant execute on function public.transition_booking_state(uuid,text,integer) to authenticated;

-- ---------- Atomic room allocation ----------
create or replace function public.allocate_room_transaction(p_hotel_id uuid,p_group_id uuid,p_pilgrim_id uuid,p_room_number text,p_room_type text,p_check_in timestamptz,p_check_out timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare h public.hotels%rowtype; aid uuid; bid uuid; rid uuid;
begin
  if not public.has_permission('room_allocations','create') and public.staff_role()<>'ADMIN' then raise exception 'Unauthorized' using errcode='42501'; end if;
  select * into h from public.hotels where id=p_hotel_id for update;
  if not found then raise exception 'Hotel not found'; end if;
  if not public.row_in_staff_scope(h.agency_id,h.branch_id) then raise exception 'Hotel outside scope' using errcode='42501'; end if;
  if exists(select 1 from public.room_allocations where hotel_id=p_hotel_id and room_number=p_room_number and status in ('PENDING','CONFIRMED','CHECKED_IN') and check_out>coalesce(p_check_in,now()) and check_in<coalesce(p_check_out,p_check_in+interval '1 day')) then
    raise exception 'Room is already allocated for this period' using errcode='23P01';
  end if;
  insert into public.room_allocations(agency_id,branch_id,hotel_id,group_id,pilgrim_id,room_number,room_type,check_in,check_out,status)
  values(h.agency_id,h.branch_id,p_hotel_id,p_group_id,p_pilgrim_id,p_room_number,p_room_type,p_check_in,p_check_out,'CONFIRMED') returning id into rid;
  return rid;
end $$;
revoke all on function public.allocate_room_transaction(uuid,uuid,uuid,text,text,timestamptz,timestamptz) from public,anon;
grant execute on function public.allocate_room_transaction(uuid,uuid,uuid,text,text,timestamptz,timestamptz) to authenticated;

-- ---------- Queue helpers ----------
create or replace function public.enqueue_notification(p_channel text,p_recipient text,p_template text,p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare id uuid;
begin
  if not public.is_staff() then raise exception 'Unauthorized' using errcode='42501'; end if;
  insert into public.notification_queue(agency_id,branch_id,channel,recipient,template,payload)
  values(public.current_staff_agency_id(),public.current_staff_branch_id(),upper(p_channel),p_recipient,p_template,p_payload) returning notification_queue.id into id;
  return id;
end $$;
revoke all on function public.enqueue_notification(text,text,text,jsonb) from public,anon;
grant execute on function public.enqueue_notification(text,text,text,jsonb) to authenticated;

-- ---------- Useful indexes ----------
create index if not exists idx_journal_entries_agency_date on public.journal_entries(agency_id,entry_date desc);
create index if not exists idx_fiscal_periods_agency_status on public.fiscal_periods(agency_id,status,start_date,end_date);
create index if not exists idx_supplier_bills_supplier_status on public.supplier_bills(supplier_id,status,due_date);
create index if not exists idx_payment_allocations_invoice on public.payment_allocations(invoice_id);
create index if not exists idx_manifest_snapshots_group_version on public.manifest_snapshots(group_id,version desc);
create index if not exists idx_missing_pilgrim_status on public.missing_pilgrim_events(status,reported_at desc);
create index if not exists idx_vehicle_expiry on public.transport_vehicles(license_expiry,insurance_expiry,maintenance_due);

-- ---------- RLS for new tables ----------
DO $$ declare t text; begin
  foreach t in array array['fiscal_periods','chart_of_accounts','journal_entries','journal_lines','bank_accounts','supplier_bills','payment_allocations','credit_notes','notification_queue','workflow_jobs','document_access_logs','data_quality_issues','readiness_rules','manifest_snapshots','missing_pilgrim_events','exchange_rates','payment_methods','airports','airlines','countries'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security',t);
      execute format('revoke all on public.%I from anon',t);
      execute format('grant select,insert,update,delete on public.%I to authenticated',t);
      execute format('drop policy if exists staff_scoped_all on public.%I',t);
      execute format('create policy staff_scoped_all on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',t);
    end if;
  end loop;
END $$;

-- Read-only public master data where needed.
revoke all on public.currencies, public.payment_methods, public.airports, public.airlines, public.countries from anon;
revoke all on public.currencies, public.payment_methods, public.airports, public.airlines, public.countries from authenticated;
grant select on public.currencies, public.payment_methods, public.airports, public.airlines, public.countries to authenticated;

-- Prevent direct deletes from accounting journals and audit-governance tables.
revoke delete on public.journal_entries, public.journal_lines from authenticated;
revoke delete on public.document_access_logs from authenticated;

-- Secure-function grants.
revoke all on function public.assert_journal_balanced(uuid) from public,anon,authenticated;
