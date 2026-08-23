-- Enterprise release hardening: authoritative finance summaries, state guards,
-- tenant-safe observability, notification delivery evidence, and data integrity invariants.

create table if not exists public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid,
  channel text not null,
  provider text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'PENDING',
  http_status integer,
  provider_message_id text,
  provider_response jsonb,
  error_code text,
  error_message text,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(provider, idempotency_key)
);
create index if not exists idx_notification_delivery_attempts_status
  on public.notification_delivery_attempts(status, attempted_at);

create table if not exists public.observability_events (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('DEBUG','INFO','WARN','ERROR','FATAL')),
  event_name text not null,
  correlation_id uuid,
  agency_id uuid,
  branch_id uuid,
  actor_id uuid,
  release_version text,
  environment text,
  duration_ms numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_observability_events_scope
  on public.observability_events(agency_id, branch_id, created_at desc);

alter table public.notification_delivery_attempts enable row level security;
alter table public.observability_events enable row level security;
revoke all on public.notification_delivery_attempts, public.observability_events from public, anon, authenticated;

create or replace function public.get_finance_summary(
  p_date_from date default null,
  p_date_to date default null,
  p_branch_id uuid default null,
  p_package_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  v_agency uuid := public.staff_agency_id();
  v_branch uuid;
  v_result jsonb;
begin
  if v_agency is null then raise exception 'Staff scope not found' using errcode='42501'; end if;
  if public.staff_role() <> 'ADMIN' then v_branch := public.staff_branch_id(); else v_branch := p_branch_id; end if;

  select jsonb_build_object(
    'agency_id',v_agency,
    'branch_id',v_branch,
    'package_id',p_package_id,
    'date_from',p_date_from,
    'date_to',p_date_to,
    'currency',jsonb_build_object(
      'DZD',jsonb_build_object(
        'confirmed',coalesce(sum(p.amount_dzd) filter(where p.status='CONFIRMED'),0),
        'pending',coalesce(sum(p.amount_dzd) filter(where p.status='PENDING'),0),
        'failed',coalesce(sum(p.amount_dzd) filter(where p.status='FAILED'),0),
        'refunded',coalesce(sum(p.amount_dzd) filter(where p.status='REFUNDED'),0),
        'total',coalesce(sum(p.amount_dzd),0),
        'count',count(*)
      ),
      'SAR',jsonb_build_object(
        'confirmed',coalesce(sum(p.amount_sar) filter(where p.status='CONFIRMED'),0),
        'pending',coalesce(sum(p.amount_sar) filter(where p.status='PENDING'),0),
        'failed',coalesce(sum(p.amount_sar) filter(where p.status='FAILED'),0),
        'refunded',coalesce(sum(p.amount_sar) filter(where p.status='REFUNDED'),0),
        'total',coalesce(sum(p.amount_sar),0),
        'count',count(*)
      )
    )
  ) into v_result
  from public.payments p
  left join public.bookings b on b.id=p.booking_id
  where p.agency_id=v_agency
    and (v_branch is null or p.branch_id=v_branch)
    and (p_package_id is null or b.package_id=p_package_id)
    and (p_date_from is null or coalesce(p.received_at,p.created_at)::date >= p_date_from)
    and (p_date_to is null or coalesce(p.received_at,p.created_at)::date <= p_date_to);
  return v_result;
end;
$$;
revoke all on function public.get_finance_summary(date,date,uuid,uuid) from public,anon;
grant execute on function public.get_finance_summary(date,date,uuid,uuid) to authenticated;

-- Sensitive status fields may only be changed inside a guarded state-transition call.
create or replace function public.guard_sensitive_status_update()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  bypass text := current_setting('app.state_transition', true);
begin
  if current_setting('app.allow_direct_sensitive_update', true) = '1' then
    return new;
  end if;
  if tg_table_name='bookings' and new.status is distinct from old.status then
    raise exception 'Direct booking status mutation is forbidden; use transition_booking_state()' using errcode='42501';
  elsif tg_table_name='pilgrims' and (new.status is distinct from old.status or new.visa_status is distinct from old.visa_status) then
    raise exception 'Direct pilgrim status mutation is forbidden; use transition_pilgrim_state()' using errcode='42501';
  elsif tg_table_name='visas' and new.status is distinct from old.status then
    raise exception 'Direct visa status mutation is forbidden; use transition_visa_status()' using errcode='42501';
  elsif tg_table_name='groups' and new.status is distinct from old.status then
    raise exception 'Direct group status mutation is forbidden; use a group transition command' using errcode='42501';
  elsif tg_table_name='incidents' and new.status is distinct from old.status then
    raise exception 'Direct incident status mutation is forbidden; use a transition command' using errcode='42501';
  elsif tg_table_name='invoices' and new.status is distinct from old.status then
    raise exception 'Direct invoice status mutation is forbidden; use transition_invoice_state()' using errcode='42501';
  elsif tg_table_name='reservations' and new.status is distinct from old.status then
    raise exception 'Direct reservation status mutation is forbidden; use transition_reservation_state()' using errcode='42501';
  end if;
  if bypass='1' then return new; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_booking_status on public.bookings;
create trigger trg_guard_booking_status before update on public.bookings for each row execute function public.guard_sensitive_status_update();
drop trigger if exists trg_guard_pilgrim_status on public.pilgrims;
create trigger trg_guard_pilgrim_status before update on public.pilgrims for each row execute function public.guard_sensitive_status_update();
drop trigger if exists trg_guard_visa_status on public.visas;
create trigger trg_guard_visa_status before update on public.visas for each row execute function public.guard_sensitive_status_update();
drop trigger if exists trg_guard_group_status on public.groups;
create trigger trg_guard_group_status before update on public.groups for each row execute function public.guard_sensitive_status_update();
drop trigger if exists trg_guard_incident_status on public.incidents;
create trigger trg_guard_incident_status before update on public.incidents for each row execute function public.guard_sensitive_status_update();
drop trigger if exists trg_guard_invoice_status on public.invoices;
create trigger trg_guard_invoice_status before update on public.invoices for each row execute function public.guard_sensitive_status_update();

do $$
begin
  if to_regclass('public.reservations') is not null then
    execute 'drop trigger if exists trg_guard_reservation_status on public.reservations';
    execute 'create trigger trg_guard_reservation_status before update on public.reservations for each row execute function public.guard_sensitive_status_update()';
  end if;
end $$;

-- Financial journals are append/posting authoritative; posted entries are immutable.
create or replace function public.guard_posted_journal_mutation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
begin
  if tg_op='UPDATE' and old.status='POSTED' then
    raise exception 'Posted journal entry is immutable' using errcode='42501';
  end if;
  if tg_op='DELETE' and old.status='POSTED' then
    raise exception 'Posted journal entry is immutable' using errcode='42501';
  end if;
  return coalesce(new,old);
end;
$$;
drop trigger if exists trg_guard_posted_journal on public.journal_entries;
create trigger trg_guard_posted_journal before update or delete on public.journal_entries for each row execute function public.guard_posted_journal_mutation();

create or replace function public.guard_journal_line_mutation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare v_status text;
begin
  select status into v_status from public.journal_entries where id=coalesce(new.journal_entry_id,old.journal_entry_id);
  if v_status='POSTED' and current_setting('app.allow_direct_sensitive_update', true) <> '1' then
    raise exception 'Posted journal lines are immutable' using errcode='42501';
  end if;
  return coalesce(new,old);
end;
$$;
drop trigger if exists trg_guard_journal_lines on public.journal_lines;
create trigger trg_guard_journal_lines before update or delete on public.journal_lines for each row execute function public.guard_journal_line_mutation();

-- Currency invariants.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='payments_currency_amount_invariant') then
    alter table public.payments add constraint payments_currency_amount_invariant
      check (
        currency is null
        or (upper(currency)='DZD' and amount_dzd >= 0)
        or (upper(currency)='SAR' and amount_sar >= 0)
        or (amount_dzd >= 0 and amount_sar >= 0)
      );
  end if;
end $$;

-- Reporting/operations contract registry.
create table if not exists public.kpi_contract_registry (
  metric_id text primary key,
  definition text not null,
  source_function text not null,
  display_unit text not null,
  authoritative boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.kpi_contract_registry(metric_id,definition,source_function,display_unit)
values
('Revenue','Posted accrual revenue within selected scope','get_dashboard_executive_snapshot','currency'),
('Collections','Confirmed payment collections within selected scope','get_finance_summary','currency'),
('NetProfit','Posted revenue minus posted expenses','get_dashboard_executive_snapshot','currency'),
('Outstanding','Current balance on active bookings','get_dashboard_executive_snapshot','currency'),
('VisaClearanceRate','Issued or approved visas divided by visa applications','get_dashboard_executive_snapshot','percent'),
('GroupReadiness','Capacity-weighted readiness of scoped groups','get_dashboard_executive_snapshot','percent')
on conflict(metric_id) do update set definition=excluded.definition,source_function=excluded.source_function,display_unit=excluded.display_unit,updated_at=now();

-- Narrow public exposure for sensitive tables: reads remain policy-controlled, direct writes are RPC-only.
revoke update(status,paid_dzd,paid_sar,amount_dzd,amount_sar) on public.payments from authenticated;
revoke update(status) on public.bookings, public.pilgrims, public.visas, public.groups, public.incidents, public.invoices from authenticated;

-- Security-definer defaults for this hardening migration.
alter function public.get_finance_summary(date,date,uuid,uuid) owner to postgres;

create policy observability_staff_insert on public.observability_events
for insert to authenticated
with check (public.row_in_staff_scope(agency_id, branch_id));
