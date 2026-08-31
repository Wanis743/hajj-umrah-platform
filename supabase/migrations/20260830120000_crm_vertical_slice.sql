-- 20260830120000_crm_vertical_slice.sql
-- Gap-analysis item 1: CRM as a complete vertical slice, not a schema.
--
--   Lead -> Customer -> Opportunity -> Quote -> Booking -> Payment
--
-- plus activities, follow-ups, campaigns, stage history, pipeline and weighted
-- forecast analytics, Customer 360 and customer profitability.
--
-- Three real defects are closed on the way:
--
--   1. 20260822000012_crm_integration created public.leads / opportunities /
--      quotes / sales_activities that no file under src/ ever references, while
--      every read path uses public.crm_leads from 20260321133200. Those four
--      tables are retired here -- but only when empty. If they hold rows the
--      migration raises instead of destroying data.
--
--   2. useSupabaseData.ts and useAdminDashboardData.ts both select
--      crm_leads.score and crm_leads.next_action_at, which existed in no
--      migration. PostgREST answered 400, the hook swallowed the error into
--      state and left data empty, so the CRM tab rendered "No leads found"
--      forever even with rows in the table. The columns are added here.
--
--   3. 20260425042200_index_all_enterprise_foreign_keys creates an index on
--      public.crm_followups -- a table that was never created anywhere. That
--      statement is unguarded, so a fresh replay dies on it. crm_followups is
--      created here as a first-class table with that exact lead_id column.
--
-- Conventions taken from 20260709003000_external_operations (table + RLS +
-- audit shape), 20260630134500_business_command_adapters (command naming) and
-- 20260529084300_unify_confirmation_payment_accounting (the money path).

-- ============================================================================
-- A. Retire the unreachable parallel schema
-- ============================================================================

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['sales_activities','quotes','opportunities','leads'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'Refusing to retire public.%: % row(s) present; migrate the data first', t, n
          using errcode = '22023';
      end if;
      execute format('drop table public.%I cascade', t);
    end if;
  end loop;
end $$;

-- Both trigger functions were declared without SET search_path (a hardening
-- contract violation) and were used by nothing except the four dropped tables.
drop function if exists public.audit_crm_action() cascade;
drop function if exists public.set_updated_at_timestamp() cascade;
-- ============================================================================
-- B. crm_leads: the columns the mounted UI already selects, plus lifecycle keys
-- ============================================================================

alter table public.crm_leads
  add column if not exists score          integer,
  add column if not exists next_action_at timestamptz,
  add column if not exists assigned_to    uuid,
  add column if not exists customer_id    uuid,
  add column if not exists campaign_id    uuid,
  add column if not exists lost_reason    text,
  add column if not exists qualified_at   timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_score_range') then
    alter table public.crm_leads
      add constraint crm_leads_score_range check (score is null or score between 0 and 100);
  end if;
end $$;

create index if not exists idx_crm_leads_next_action on public.crm_leads(agency_id, next_action_at)
  where next_action_at is not null;
create index if not exists idx_crm_leads_status_stage on public.crm_leads(agency_id, status);

-- ============================================================================
-- C. Campaigns (created first: leads and opportunities reference them)
-- ============================================================================

create table if not exists public.crm_campaigns (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_staff_agency_id(),
  branch_id      uuid,
  code           text not null default ('CMP-' || to_char(current_date,'YYMMDD') || '-' ||
                   upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  name           text not null,
  channel        text not null default 'OTHER'
                   check (channel in ('FACEBOOK','INSTAGRAM','GOOGLE','WHATSAPP','SMS','EMAIL',
                                      'REFERRAL','WALK_IN','EVENT','MOSQUE','OTHER')),
  status         text not null default 'PLANNED'
                   check (status in ('PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  start_date     date,
  end_date       date,
  budget_dzd     numeric(14,2) not null default 0 check (budget_dzd >= 0),
  spend_dzd      numeric(14,2) not null default 0 check (spend_dzd >= 0),
  target_segment text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint crm_campaigns_name_present check (length(trim(name)) > 0),
  constraint crm_campaigns_date_order check (start_date is null or end_date is null or end_date >= start_date)
);
create unique index if not exists uq_crm_campaigns_agency_code on public.crm_campaigns(agency_id, code);
create index if not exists idx_crm_campaigns_agency_branch on public.crm_campaigns(agency_id, branch_id);
create index if not exists idx_crm_campaigns_status on public.crm_campaigns(agency_id, status);
-- ============================================================================
-- D. Customers -- the Customer 360 anchor
-- ============================================================================

create table if not exists public.crm_customers (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null default public.current_staff_agency_id(),
  branch_id        uuid,
  code             text not null default ('CUS-' || to_char(current_date,'YYMMDD') || '-' ||
                     upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  pilgrim_id       uuid references public.pilgrims(id) on delete set null,
  lead_id          uuid references public.crm_leads(id) on delete set null,
  campaign_id      uuid references public.crm_campaigns(id) on delete set null,
  full_name        text not null,
  full_name_ar     text,
  customer_type    text not null default 'INDIVIDUAL'
                     check (customer_type in ('INDIVIDUAL','FAMILY','CORPORATE')),
  status           text not null default 'ACTIVE'
                     check (status in ('ACTIVE','DORMANT','BLOCKED')),
  phone            text,
  email            text,
  wilaya           text,
  address          text,
  source           text,
  owner_id         uuid,
  tags             text[] not null default '{}',
  notes            text,
  first_won_at     timestamptz,
  last_activity_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint crm_customers_name_present check (length(trim(full_name)) > 0)
);
create unique index if not exists uq_crm_customers_agency_code on public.crm_customers(agency_id, code);
create index if not exists idx_crm_customers_agency_branch on public.crm_customers(agency_id, branch_id);
create index if not exists idx_crm_customers_pilgrim on public.crm_customers(pilgrim_id);
create index if not exists idx_crm_customers_lead on public.crm_customers(lead_id);
create index if not exists idx_crm_customers_status on public.crm_customers(agency_id, status);
create index if not exists idx_crm_customers_phone on public.crm_customers(agency_id, phone);

-- The lifecycle keys added to crm_leads in section B become real references
-- once their targets exist.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_customer_fk') then
    alter table public.crm_leads add constraint crm_leads_customer_fk
      foreign key (customer_id) references public.crm_customers(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_leads_campaign_fk') then
    alter table public.crm_leads add constraint crm_leads_campaign_fk
      foreign key (campaign_id) references public.crm_campaigns(id) on delete set null;
  end if;
end $$;
-- ============================================================================
-- E. Opportunities and stage history
-- ============================================================================

create table if not exists public.crm_opportunities (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null default public.current_staff_agency_id(),
  branch_id          uuid,
  reference          text not null default ('OPP-' || to_char(current_date,'YYMMDD') || '-' ||
                       upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  customer_id        uuid not null references public.crm_customers(id) on delete cascade,
  lead_id            uuid references public.crm_leads(id) on delete set null,
  package_id         uuid references public.packages(id) on delete set null,
  campaign_id        uuid references public.crm_campaigns(id) on delete set null,
  booking_id         uuid references public.bookings(id) on delete set null,
  title              text not null,
  stage              text not null default 'NEW'
                       check (stage in ('NEW','QUALIFYING','PROPOSAL','NEGOTIATION','WON','LOST')),
  probability        integer not null default 10 check (probability between 0 and 100),
  travelers          integer not null default 1 check (travelers > 0),
  expected_value_dzd numeric(14,2) not null default 0 check (expected_value_dzd >= 0),
  expected_close_date date,
  owner_id           uuid,
  won_at             timestamptz,
  lost_at            timestamptz,
  lost_reason        text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint crm_opportunities_title_present check (length(trim(title)) > 0),
  constraint crm_opportunities_terminal_reason
    check (stage <> 'LOST' or lost_reason is not null)
);
create unique index if not exists uq_crm_opportunities_agency_ref
  on public.crm_opportunities(agency_id, reference);
create index if not exists idx_crm_opportunities_agency_branch
  on public.crm_opportunities(agency_id, branch_id);
create index if not exists idx_crm_opportunities_customer on public.crm_opportunities(customer_id);
create index if not exists idx_crm_opportunities_stage on public.crm_opportunities(agency_id, stage);
create index if not exists idx_crm_opportunities_close
  on public.crm_opportunities(agency_id, expected_close_date);
create index if not exists idx_crm_opportunities_campaign on public.crm_opportunities(campaign_id);

create table if not exists public.crm_stage_history (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_staff_agency_id(),
  branch_id      uuid,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  from_stage     text,
  to_stage       text not null,
  probability    integer,
  note           text,
  changed_by     uuid default auth.uid(),
  changed_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists idx_crm_stage_history_opportunity
  on public.crm_stage_history(opportunity_id, changed_at desc);
-- ============================================================================
-- F. Quotes and quote lines
-- ============================================================================

create table if not exists public.crm_quotes (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null default public.current_staff_agency_id(),
  branch_id       uuid,
  quote_number    text not null,
  opportunity_id  uuid not null references public.crm_opportunities(id) on delete cascade,
  customer_id     uuid not null references public.crm_customers(id) on delete cascade,
  package_id      uuid references public.packages(id) on delete set null,
  booking_id      uuid references public.bookings(id) on delete set null,
  status          text not null default 'DRAFT'
                    check (status in ('DRAFT','SENT','ACCEPTED','DECLINED','EXPIRED')),
  currency_code   text not null default 'DZD' check (currency_code in ('DZD','SAR')),
  subtotal        numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  total_amount    numeric(14,2) not null default 0 check (total_amount >= 0),
  travelers       integer not null default 1 check (travelers > 0),
  valid_until     date,
  terms           text,
  notes           text,
  sent_at         timestamptz,
  accepted_at     timestamptz,
  declined_at     timestamptz,
  declined_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- Per-agency uniqueness. The retired schema made quote_number globally unique,
-- which both leaks the existence of other tenants' quotes and lets one agency's
-- numbering collide with another's.
create unique index if not exists uq_crm_quotes_agency_number
  on public.crm_quotes(agency_id, quote_number);
create index if not exists idx_crm_quotes_agency_branch on public.crm_quotes(agency_id, branch_id);
create index if not exists idx_crm_quotes_opportunity on public.crm_quotes(opportunity_id);
create index if not exists idx_crm_quotes_customer on public.crm_quotes(customer_id);
create index if not exists idx_crm_quotes_status on public.crm_quotes(agency_id, status);

create or replace function public.assign_crm_quote_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Never trust a client supplied quote number.
  new.quote_number := 'QT-' || to_char(current_date,'YYMMDD') || '-' ||
                      upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  return new;
end;
$$;
revoke all on function public.assign_crm_quote_number() from public, anon, authenticated;

drop trigger if exists trg_assign_crm_quote_number on public.crm_quotes;
create trigger trg_assign_crm_quote_number before insert on public.crm_quotes
  for each row execute function public.assign_crm_quote_number();

create table if not exists public.crm_quote_lines (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null default public.current_staff_agency_id(),
  branch_id   uuid,
  quote_id    uuid not null references public.crm_quotes(id) on delete cascade,
  package_id  uuid references public.packages(id) on delete set null,
  description text not null,
  quantity    numeric(10,2) not null default 1 check (quantity > 0),
  unit_price  numeric(14,2) not null default 0 check (unit_price >= 0),
  line_total  numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint crm_quote_lines_description_present check (length(trim(description)) > 0)
);
create index if not exists idx_crm_quote_lines_quote on public.crm_quote_lines(quote_id, sort_order);
create index if not exists idx_crm_quote_lines_agency_branch
  on public.crm_quote_lines(agency_id, branch_id);
-- Totals are derived, never asserted by the client.
create or replace function public.apply_crm_quote_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  new.subtotal := round(greatest(coalesce(new.subtotal, 0), 0), 2);
  new.discount_amount := round(greatest(coalesce(new.discount_amount, 0), 0), 2);
  if new.discount_amount > new.subtotal then
    raise exception 'Quote discount cannot exceed the quote subtotal' using errcode = '22023';
  end if;
  new.total_amount := round(new.subtotal - new.discount_amount, 2);
  return new;
end;
$$;
revoke all on function public.apply_crm_quote_totals() from public, anon, authenticated;

drop trigger if exists trg_crm_quote_totals on public.crm_quotes;
create trigger trg_crm_quote_totals before insert or update on public.crm_quotes
  for each row execute function public.apply_crm_quote_totals();

create or replace function public.recompute_crm_quote_subtotal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_quote  uuid;
  v_status text;
  v_sub    numeric(14,2);
begin
  v_quote := coalesce(new.quote_id, old.quote_id);
  select status into v_status from public.crm_quotes where id = v_quote for update;
  if v_status is null then
    return coalesce(new, old);
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'Quote lines can only change while the quote is a draft' using errcode = '22023';
  end if;
  select coalesce(sum(line_total), 0) into v_sub
    from public.crm_quote_lines where quote_id = v_quote;
  update public.crm_quotes set subtotal = v_sub, updated_at = now() where id = v_quote;
  return coalesce(new, old);
end;
$$;
revoke all on function public.recompute_crm_quote_subtotal() from public, anon, authenticated;

drop trigger if exists trg_crm_quote_lines_rollup on public.crm_quote_lines;
create trigger trg_crm_quote_lines_rollup
  after insert or update or delete on public.crm_quote_lines
  for each row execute function public.recompute_crm_quote_subtotal();
-- ============================================================================
-- G. Activities (logged history) and follow-ups (scheduled work)
-- ============================================================================

create table if not exists public.crm_activities (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null default public.current_staff_agency_id(),
  branch_id        uuid,
  customer_id      uuid references public.crm_customers(id) on delete cascade,
  lead_id          uuid references public.crm_leads(id) on delete cascade,
  opportunity_id   uuid references public.crm_opportunities(id) on delete cascade,
  quote_id         uuid references public.crm_quotes(id) on delete set null,
  activity_type    text not null default 'NOTE'
                     check (activity_type in ('CALL','EMAIL','MEETING','WHATSAPP','SMS','VISIT','NOTE','SYSTEM')),
  direction        text check (direction is null or direction in ('INBOUND','OUTBOUND')),
  subject          text not null,
  body             text,
  outcome          text check (outcome is null or outcome in
                     ('CONNECTED','NO_ANSWER','INTERESTED','NOT_INTERESTED','FOLLOW_UP','CLOSED')),
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  occurred_at      timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint crm_activities_subject_present check (length(trim(subject)) > 0),
  constraint crm_activities_target_present
    check (customer_id is not null or lead_id is not null or opportunity_id is not null)
);
create index if not exists idx_crm_activities_agency_branch on public.crm_activities(agency_id, branch_id);
create index if not exists idx_crm_activities_customer on public.crm_activities(customer_id, occurred_at desc);
create index if not exists idx_crm_activities_lead on public.crm_activities(lead_id, occurred_at desc);
create index if not exists idx_crm_activities_opportunity on public.crm_activities(opportunity_id, occurred_at desc);
create index if not exists idx_crm_activities_occurred on public.crm_activities(agency_id, occurred_at desc);

create table if not exists public.crm_followups (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null default public.current_staff_agency_id(),
  branch_id      uuid,
  lead_id        uuid references public.crm_leads(id) on delete cascade,
  customer_id    uuid references public.crm_customers(id) on delete cascade,
  opportunity_id uuid references public.crm_opportunities(id) on delete cascade,
  title          text not null,
  due_at         timestamptz not null,
  priority       text not null default 'MEDIUM'
                   check (priority in ('LOW','MEDIUM','HIGH','URGENT')),
  status         text not null default 'OPEN'
                   check (status in ('OPEN','DONE','CANCELLED')),
  assigned_to    uuid,
  completed_at   timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint crm_followups_title_present check (length(trim(title)) > 0),
  constraint crm_followups_target_present
    check (lead_id is not null or customer_id is not null or opportunity_id is not null),
  constraint crm_followups_done_has_time
    check (status <> 'DONE' or completed_at is not null)
);
-- 20260425042200 already indexes this exact column on this exact table.
create index if not exists idx_crm_followups_lead on public.crm_followups(lead_id);
create index if not exists idx_crm_followups_agency_branch on public.crm_followups(agency_id, branch_id);
create index if not exists idx_crm_followups_due on public.crm_followups(agency_id, status, due_at);
create index if not exists idx_crm_followups_assigned on public.crm_followups(assigned_to, status, due_at);
-- ============================================================================
-- H. RLS, scope stamping, updated_at and audit for every new table
-- ============================================================================

do $$
declare
  t          text;
  has_audit  boolean;
  crm_tables text[] := array[
    'crm_campaigns','crm_customers','crm_opportunities','crm_stage_history',
    'crm_quotes','crm_quote_lines','crm_activities','crm_followups'
  ];
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'write_audit_log'
  ) into has_audit;

  foreach t in array crm_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.row_in_staff_scope(agency_id, branch_id))',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.row_in_staff_scope(agency_id, branch_id))',
      t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.row_in_staff_scope(agency_id, branch_id)) with check (public.row_in_staff_scope(agency_id, branch_id))',
      t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.row_in_staff_scope(agency_id, branch_id))',
      t || '_delete', t);

    -- Anonymous callers have no business in the CRM at all.
    execute format('revoke all on public.%I from anon', t);

    execute format('drop trigger if exists trg_stamp_staff_scope on public.%I', t);
    execute format(
      'create trigger trg_stamp_staff_scope before insert on public.%I for each row execute function public.stamp_staff_scope()',
      t);

    if t <> 'crm_stage_history' then
      execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated_at', t);
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()',
        'trg_' || t || '_updated_at', t);
    end if;

    if has_audit then
      execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_log()',
        'trg_audit_' || t, t);
    end if;
  end loop;
end $$;

-- crm_stage_history is an append-only ledger: no client UPDATE or DELETE path.
drop policy if exists crm_stage_history_update on public.crm_stage_history;
drop policy if exists crm_stage_history_delete on public.crm_stage_history;
revoke update, delete, truncate on public.crm_stage_history from authenticated;
-- ============================================================================
-- I. RBAC. The CRM role owns the pipeline; closing a sale creates a booking and
--    takes money, so those two permissions are granted explicitly rather than
--    assumed.
-- ============================================================================

insert into public.staff_permissions(role, resource, action) values
  ('CRM','crm_customers','read'),('CRM','crm_customers','create'),('CRM','crm_customers','update'),('CRM','crm_customers','delete'),
  ('CRM','crm_opportunities','read'),('CRM','crm_opportunities','create'),('CRM','crm_opportunities','update'),('CRM','crm_opportunities','delete'),
  ('CRM','crm_quotes','read'),('CRM','crm_quotes','create'),('CRM','crm_quotes','update'),('CRM','crm_quotes','delete'),
  ('CRM','crm_quote_lines','read'),('CRM','crm_quote_lines','create'),('CRM','crm_quote_lines','update'),('CRM','crm_quote_lines','delete'),
  ('CRM','crm_activities','read'),('CRM','crm_activities','create'),('CRM','crm_activities','update'),('CRM','crm_activities','delete'),
  ('CRM','crm_followups','read'),('CRM','crm_followups','create'),('CRM','crm_followups','update'),('CRM','crm_followups','delete'),
  ('CRM','crm_campaigns','read'),('CRM','crm_campaigns','create'),('CRM','crm_campaigns','update'),
  ('CRM','crm_stage_history','read'),
  ('CRM','packages','read'),('CRM','bookings','create'),('CRM','payments','create'),
  ('OPERATIONS_MANAGER','crm_customers','read'),('OPERATIONS_MANAGER','crm_opportunities','read'),
  ('OPERATIONS_MANAGER','crm_quotes','read'),('OPERATIONS_MANAGER','crm_activities','read'),
  ('OPERATIONS_MANAGER','crm_followups','read'),('OPERATIONS_MANAGER','crm_campaigns','read'),
  ('OPERATIONS_MANAGER','crm_stage_history','read'),
  ('FINANCE','crm_quotes','read'),('FINANCE','crm_customers','read'),('FINANCE','crm_campaigns','read'),
  ('AGENT','crm_customers','read'),('AGENT','crm_activities','read'),('AGENT','crm_activities','create'),
  ('AGENT','crm_followups','read'),('AGENT','crm_followups','create'),('AGENT','crm_followups','update')
on conflict (role, resource, action) do nothing;
-- ============================================================================
-- J. Lifecycle command: lead -> customer + opportunity
-- ============================================================================

create or replace function private.convert_crm_lead(
  p_lead_id            uuid,
  p_package_id         uuid    default null,
  p_travelers          integer default 1,
  p_expected_value_dzd numeric default null,
  p_expected_close_date date   default null,
  p_title              text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  l           public.crm_leads%rowtype;
  pk          public.packages%rowtype;
  v_customer    uuid;
  v_opportunity uuid;
  v_travelers   integer := greatest(coalesce(p_travelers, 1), 1);
  v_value       numeric(14,2);
  v_name        text;
begin
  -- Guards in this file are a single has_permission call. The `and staff_role()
  -- <> 'ADMIN'` clause the rest of the schema carries is redundant --
  -- has_permission already answers true for ADMIN -- and was worse than
  -- redundant: it made the whole condition NULL for a caller with no staff
  -- profile, so the raise never fired. 20260830140000 makes the helpers total.
  if not public.has_permission('crm_customers','create') then
    raise exception 'Not authorized to convert leads' using errcode = '42501';
  end if;

  select * into l from public.crm_leads where id = p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode = '42501'; end if;
  if not public.row_in_staff_scope(l.agency_id, l.branch_id) then
    raise exception 'Lead outside staff scope' using errcode = '42501';
  end if;
  if l.status = 'LOST' then
    raise exception 'A lost lead cannot be converted' using errcode = '22023';
  end if;
  if l.customer_id is not null and exists (
       select 1 from public.crm_opportunities o where o.lead_id = l.id and o.stage not in ('WON','LOST')) then
    raise exception 'This lead already has an open opportunity' using errcode = '22023';
  end if;

  if p_package_id is not null then
    select * into pk from public.packages where id = p_package_id;
    if not found then raise exception 'Package not found' using errcode = '22023'; end if;
    if not public.row_in_staff_scope(pk.agency_id, pk.branch_id) then
      raise exception 'Package outside staff scope' using errcode = '42501';
    end if;
  end if;

  v_value := round(coalesce(p_expected_value_dzd, coalesce(pk.price_dzd, 0) * v_travelers), 2);
  v_name  := nullif(trim(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')), '');
  if v_name is null then
    v_name := coalesce(nullif(trim(coalesce(l.phone,'')),''), 'Customer ' || substr(l.id::text, 1, 8));
  end if;

  v_customer := l.customer_id;
  if v_customer is null then
    insert into public.crm_customers(
      agency_id, branch_id, lead_id, campaign_id, full_name, phone, email, source, owner_id, status, notes)
    values (l.agency_id, l.branch_id, l.id, l.campaign_id, v_name, l.phone, l.email, l.source,
            coalesce(l.assigned_to, auth.uid()), 'ACTIVE', l.notes)
    returning id into v_customer;
  end if;

  insert into public.crm_opportunities(
    agency_id, branch_id, customer_id, lead_id, package_id, campaign_id, title, stage,
    probability, travelers, expected_value_dzd, expected_close_date, owner_id)
  values (l.agency_id, l.branch_id, v_customer, l.id, p_package_id, l.campaign_id,
          coalesce(nullif(trim(coalesce(p_title,'')),''), v_name || ' - ' || coalesce(pk.name, 'Opportunity')),
          'QUALIFYING', 25, v_travelers, v_value, p_expected_close_date,
          coalesce(l.assigned_to, auth.uid()))
  returning id into v_opportunity;

  insert into public.crm_stage_history(agency_id, branch_id, opportunity_id, from_stage, to_stage, probability, note)
  values (l.agency_id, l.branch_id, v_opportunity, null, 'QUALIFYING', 25, 'Created from lead conversion');

  insert into public.crm_activities(
    agency_id, branch_id, customer_id, lead_id, opportunity_id, activity_type, subject, body)
  values (l.agency_id, l.branch_id, v_customer, l.id, v_opportunity, 'SYSTEM',
          'Lead converted', 'Lead ' || l.id::text || ' became a customer and an opportunity');

  update public.crm_leads
     set status = 'CONVERTED', converted_at = now(), customer_id = v_customer,
         qualified_at = coalesce(qualified_at, now()), updated_at = now()
   where id = l.id;

  update public.crm_customers set last_activity_at = now(), updated_at = now() where id = v_customer;

  return jsonb_build_object(
    'lead_id', l.id, 'customer_id', v_customer, 'opportunity_id', v_opportunity,
    'expected_value_dzd', v_value);
end;
$$;
revoke all on function private.convert_crm_lead(uuid,uuid,integer,numeric,date,text)
  from public, anon, authenticated;
-- ============================================================================
-- K. Lifecycle command: opportunity stage machine
-- ============================================================================

create or replace function private.move_crm_opportunity_stage(
  p_opportunity_id uuid,
  p_to_stage       text,
  p_note           text default null,
  p_lost_reason    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  o       public.crm_opportunities%rowtype;
  v_to    text := upper(trim(coalesce(p_to_stage,'')));
  v_prob  integer;
  v_legal boolean;
  v_note  text := nullif(trim(coalesce(p_note,'')),'');
begin
  if not public.has_permission('crm_opportunities','update') then
    raise exception 'Not authorized to move opportunities' using errcode = '42501';
  end if;

  select * into o from public.crm_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'Opportunity not found' using errcode = '42501'; end if;
  if not public.row_in_staff_scope(o.agency_id, o.branch_id) then
    raise exception 'Opportunity outside staff scope' using errcode = '42501';
  end if;
  if v_to not in ('NEW','QUALIFYING','PROPOSAL','NEGOTIATION','WON','LOST') then
    raise exception 'Unknown opportunity stage %', v_to using errcode = '22023';
  end if;
  if v_to = o.stage then
    raise exception 'Opportunity is already at stage %', v_to using errcode = '22023';
  end if;
  -- WON is reachable only through quote acceptance, which is the path that
  -- actually creates the booking, the payment and the journal entry.
  if v_to = 'WON' then
    raise exception 'An opportunity is won by accepting its quote, not by moving its stage'
      using errcode = '22023';
  end if;

  v_legal := case o.stage
    when 'NEW'         then v_to in ('QUALIFYING','PROPOSAL','LOST')
    when 'QUALIFYING'  then v_to in ('PROPOSAL','LOST')
    when 'PROPOSAL'    then v_to in ('NEGOTIATION','QUALIFYING','LOST')
    when 'NEGOTIATION' then v_to in ('PROPOSAL','LOST')
    when 'LOST'        then v_to = 'QUALIFYING'
    else false
  end;
  if not v_legal then
    raise exception 'Illegal opportunity transition % to %', o.stage, v_to using errcode = '22023';
  end if;
  if v_to = 'LOST' and nullif(trim(coalesce(p_lost_reason,'')),'') is null then
    raise exception 'A lost opportunity requires a reason' using errcode = '22023';
  end if;

  v_prob := case v_to
    when 'NEW' then 10 when 'QUALIFYING' then 25 when 'PROPOSAL' then 50
    when 'NEGOTIATION' then 75 when 'LOST' then 0 else o.probability end;

  update public.crm_opportunities
     set stage = v_to,
         probability = v_prob,
         lost_at = case when v_to = 'LOST' then now() end,
         lost_reason = case when v_to = 'LOST' then trim(p_lost_reason) end,
         updated_at = now()
   where id = o.id;

  insert into public.crm_stage_history(agency_id, branch_id, opportunity_id, from_stage, to_stage, probability, note)
  values (o.agency_id, o.branch_id, o.id, o.stage, v_to, v_prob, v_note);

  insert into public.crm_activities(
    agency_id, branch_id, customer_id, opportunity_id, activity_type, subject, body)
  values (o.agency_id, o.branch_id, o.customer_id, o.id, 'SYSTEM',
          'Stage ' || o.stage || ' to ' || v_to, coalesce(v_note, nullif(trim(coalesce(p_lost_reason,'')),'')));

  if v_to = 'LOST' then
    update public.crm_followups set status = 'CANCELLED', updated_at = now()
     where opportunity_id = o.id and status = 'OPEN';
    update public.crm_quotes set status = 'EXPIRED', updated_at = now()
     where opportunity_id = o.id and status in ('DRAFT','SENT');
  end if;

  update public.crm_customers set last_activity_at = now(), updated_at = now() where id = o.customer_id;

  return jsonb_build_object(
    'id', o.id, 'from_stage', o.stage, 'to_stage', v_to, 'probability', v_prob);
end;
$$;
revoke all on function private.move_crm_opportunity_stage(uuid,text,text,text)
  from public, anon, authenticated;
-- ============================================================================
-- L. Lifecycle commands: send and decline a quote
-- ============================================================================

create or replace function private.send_crm_quote(p_quote_id uuid, p_valid_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  q       public.crm_quotes%rowtype;
  o       public.crm_opportunities%rowtype;
  v_lines integer;
  v_until date;
begin
  if not public.has_permission('crm_quotes','update') then
    raise exception 'Not authorized to send quotes' using errcode = '42501';
  end if;

  select * into q from public.crm_quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = '42501'; end if;
  if not public.row_in_staff_scope(q.agency_id, q.branch_id) then
    raise exception 'Quote outside staff scope' using errcode = '42501';
  end if;
  if q.status <> 'DRAFT' then
    raise exception 'Only a draft quote can be sent (this one is %)', q.status using errcode = '22023';
  end if;

  select count(*) into v_lines from public.crm_quote_lines where quote_id = q.id;
  if v_lines = 0 then
    raise exception 'A quote needs at least one line before it can be sent' using errcode = '22023';
  end if;
  if coalesce(q.total_amount, 0) <= 0 then
    raise exception 'A quote total must be greater than zero before it can be sent' using errcode = '22023';
  end if;

  v_until := coalesce(q.valid_until, current_date + greatest(coalesce(p_valid_days, 14), 1));
  if v_until < current_date then
    raise exception 'Quote validity date is already in the past' using errcode = '22023';
  end if;

  update public.crm_quotes
     set status = 'SENT', sent_at = now(), valid_until = v_until, updated_at = now()
   where id = q.id;

  select * into o from public.crm_opportunities where id = q.opportunity_id for update;
  if found and o.stage in ('NEW','QUALIFYING') then
    perform private.move_crm_opportunity_stage(o.id, 'PROPOSAL', 'Quote ' || q.quote_number || ' sent');
  end if;

  insert into public.crm_activities(
    agency_id, branch_id, customer_id, opportunity_id, quote_id, activity_type, direction, subject, body)
  values (q.agency_id, q.branch_id, q.customer_id, q.opportunity_id, q.id, 'EMAIL', 'OUTBOUND',
          'Quote ' || q.quote_number || ' sent',
          'Total ' || q.total_amount::text || ' ' || q.currency_code || ', valid until ' || v_until::text);

  return jsonb_build_object(
    'id', q.id, 'quote_number', q.quote_number, 'status', 'SENT', 'valid_until', v_until,
    'total_amount', q.total_amount, 'currency_code', q.currency_code);
end;
$$;
revoke all on function private.send_crm_quote(uuid,integer) from public, anon, authenticated;

create or replace function private.decline_crm_quote(p_quote_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  q        public.crm_quotes%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  if not public.has_permission('crm_quotes','update') then
    raise exception 'Not authorized to decline quotes' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'A declined quote requires a reason' using errcode = '22023';
  end if;

  select * into q from public.crm_quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = '42501'; end if;
  if not public.row_in_staff_scope(q.agency_id, q.branch_id) then
    raise exception 'Quote outside staff scope' using errcode = '42501';
  end if;
  if q.status not in ('DRAFT','SENT') then
    raise exception 'Only an open quote can be declined (this one is %)', q.status using errcode = '22023';
  end if;

  update public.crm_quotes
     set status = 'DECLINED', declined_at = now(), declined_reason = v_reason, updated_at = now()
   where id = q.id;

  insert into public.crm_activities(
    agency_id, branch_id, customer_id, opportunity_id, quote_id, activity_type, direction, subject, body)
  values (q.agency_id, q.branch_id, q.customer_id, q.opportunity_id, q.id, 'SYSTEM', 'INBOUND',
          'Quote ' || q.quote_number || ' declined', v_reason);

  return jsonb_build_object('id', q.id, 'status', 'DECLINED', 'declined_reason', v_reason);
end;
$$;
revoke all on function private.decline_crm_quote(uuid,text) from public, anon, authenticated;
-- ============================================================================
-- M. The money path: accepting a quote creates the pilgrim, the booking, the
--    payment and the journal entry in one transaction, exactly as
--    private.confirm_reservation_transaction does for public reservations.
-- ============================================================================

create or replace function private.accept_crm_quote(
  p_quote_id           uuid,
  p_payment_amount_dzd numeric default 0,
  p_payment_amount_sar numeric default 0,
  p_payment_method     text    default 'Cash',
  p_group_id           uuid    default null,
  p_passport_number    text    default null,
  p_notes              text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  q            public.crm_quotes%rowtype;
  o            public.crm_opportunities%rowtype;
  c            public.crm_customers%rowtype;
  pk           public.packages%rowtype;
  v_package    uuid;
  v_travelers  integer;
  v_pilgrim    uuid;
  v_booking    uuid;
  v_payment    uuid;
  v_journal    uuid;
  v_reference  text;
  v_total_dzd  numeric(14,2);
  v_total_sar  numeric(14,2);
  v_paid_dzd   numeric(14,2) := round(greatest(coalesce(p_payment_amount_dzd, 0), 0), 2);
  v_paid_sar   numeric(14,2) := round(greatest(coalesce(p_payment_amount_sar, 0), 0), 2);
begin
  if not public.has_permission('crm_quotes','update') then
    raise exception 'Not authorized to accept quotes' using errcode = '42501';
  end if;
  if not public.has_permission('bookings','create') then
    raise exception 'Not authorized to create bookings' using errcode = '42501';
  end if;
  if (v_paid_dzd > 0 or v_paid_sar > 0)
     and not public.has_permission('payments','create') then
    raise exception 'Not authorized to record payments' using errcode = '42501';
  end if;
  if v_paid_dzd > 0 and v_paid_sar > 0 then
    raise exception 'Multi-currency payment must be posted as separate currency transactions'
      using errcode = '22023';
  end if;
  select * into q from public.crm_quotes where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = '42501'; end if;
  if not public.row_in_staff_scope(q.agency_id, q.branch_id) then
    raise exception 'Quote outside staff scope' using errcode = '42501';
  end if;
  if q.status = 'ACCEPTED' then
    raise exception 'Quote % is already accepted', q.quote_number using errcode = '22023';
  end if;
  if q.status <> 'SENT' then
    raise exception 'Only a sent quote can be accepted (this one is %)', q.status using errcode = '22023';
  end if;
  if q.valid_until is not null and q.valid_until < current_date then
    raise exception 'Quote % expired on %', q.quote_number, q.valid_until using errcode = '22023';
  end if;
  if q.currency_code = 'DZD' and v_paid_sar > 0 then
    raise exception 'This quote is priced in DZD; record the payment in DZD' using errcode = '22023';
  end if;
  if q.currency_code = 'SAR' and v_paid_dzd > 0 then
    raise exception 'This quote is priced in SAR; record the payment in SAR' using errcode = '22023';
  end if;

  select * into o from public.crm_opportunities where id = q.opportunity_id for update;
  if not found then raise exception 'Opportunity not found' using errcode = '42501'; end if;
  if o.stage = 'WON' then
    raise exception 'Opportunity % is already won', o.reference using errcode = '22023';
  end if;
  if o.stage = 'LOST' then
    raise exception 'A lost opportunity cannot be won' using errcode = '22023';
  end if;

  select * into c from public.crm_customers where id = q.customer_id for update;
  if not found then raise exception 'Customer not found' using errcode = '42501'; end if;

  v_package := coalesce(q.package_id, o.package_id);
  if v_package is null then
    raise exception 'A quote must reference a package before it can be accepted' using errcode = '22023';
  end if;
  select * into pk from public.packages where id = v_package for update;
  if not found then raise exception 'Package not found' using errcode = '22023'; end if;
  if not public.row_in_staff_scope(pk.agency_id, pk.branch_id) then
    raise exception 'Package outside staff scope' using errcode = '42501';
  end if;
  if pk.status <> 'ACTIVE' then
    raise exception 'Package % is not active', pk.code using errcode = '22023';
  end if;

  v_travelers := greatest(coalesce(q.travelers, 1), 1);
  if coalesce(pk.seats_available, 0) < v_travelers then
    raise exception 'Package capacity exceeded: % seat(s) left, % requested',
      coalesce(pk.seats_available, 0), v_travelers using errcode = '22023';
  end if;

  v_total_dzd := case when q.currency_code = 'DZD' then q.total_amount else 0 end;
  v_total_sar := case when q.currency_code = 'SAR' then q.total_amount else 0 end;
  if v_paid_dzd > v_total_dzd or v_paid_sar > v_total_sar then
    raise exception 'Payment exceeds the quoted total' using errcode = '22023';
  end if;
  -- Reuse the customer's pilgrim record when one already exists, so a repeat
  -- customer does not become a second person in the operational tables.
  v_pilgrim := c.pilgrim_id;
  if v_pilgrim is null then
    insert into public.pilgrims(
      agency_id, branch_id, full_name, full_name_ar, passport_number, phone, email,
      wilaya, group_id, package_id, payment_status, visa_status, status, notes)
    values (q.agency_id, q.branch_id, c.full_name, coalesce(c.full_name_ar, c.full_name),
            nullif(trim(coalesce(p_passport_number,'')),''), c.phone, nullif(trim(coalesce(c.email,'')),''),
            c.wilaya, p_group_id, pk.id,
            case when v_paid_dzd > 0 or v_paid_sar > 0 then 'PARTIAL' else 'NONE' end,
            'NOT_STARTED', 'REGISTERED', p_notes)
    returning id into v_pilgrim;
    update public.crm_customers set pilgrim_id = v_pilgrim, updated_at = now() where id = c.id;
  else
    update public.pilgrims
       set package_id = pk.id,
           group_id = coalesce(p_group_id, group_id),
           passport_number = coalesce(nullif(trim(coalesce(p_passport_number,'')),''), passport_number),
           updated_at = now()
     where id = v_pilgrim;
  end if;

  v_reference := 'BOOK-' || to_char(current_date,'YYMMDD') || '-' ||
                 upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.bookings(
    agency_id, branch_id, reference, pilgrim_id, package_id, group_id, status, travelers,
    total_dzd, total_sar, paid_dzd, paid_sar, payment_method, notes, confirmed_at)
  values (q.agency_id, q.branch_id, v_reference, v_pilgrim, pk.id, p_group_id, 'CONFIRMED', v_travelers,
          v_total_dzd, v_total_sar, v_paid_dzd, v_paid_sar, p_payment_method,
          coalesce(p_notes, 'From quote ' || q.quote_number), now())
  returning id into v_booking;

  if v_paid_dzd > 0 or v_paid_sar > 0 then
    insert into public.payments(
      agency_id, branch_id, booking_id, pilgrim_id, amount_dzd, amount_sar, method, status, reference, notes)
    values (q.agency_id, q.branch_id, v_booking, v_pilgrim, v_paid_dzd, v_paid_sar, p_payment_method,
            'CONFIRMED',
            'PAY-' || to_char(current_date,'YYMMDD') || '-' ||
              upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
            coalesce(p_notes, 'Quote ' || q.quote_number))
    returning id into v_payment;
    select private.post_payment_journal(v_payment) into v_journal;
  end if;

  update public.packages
     set seats_available = seats_available - v_travelers, updated_at = now()
   where id = pk.id;
  update public.crm_quotes
     set status = 'ACCEPTED', accepted_at = now(), booking_id = v_booking, updated_at = now()
   where id = q.id;

  -- Any other open quote on the same opportunity is now moot.
  update public.crm_quotes
     set status = 'EXPIRED', updated_at = now()
   where opportunity_id = o.id and id <> q.id and status in ('DRAFT','SENT');

  update public.crm_opportunities
     set stage = 'WON', probability = 100, won_at = now(), booking_id = v_booking,
         expected_value_dzd = case when q.currency_code = 'DZD' then q.total_amount else expected_value_dzd end,
         lost_at = null, lost_reason = null, updated_at = now()
   where id = o.id;

  insert into public.crm_stage_history(agency_id, branch_id, opportunity_id, from_stage, to_stage, probability, note)
  values (o.agency_id, o.branch_id, o.id, o.stage, 'WON', 100,
          'Quote ' || q.quote_number || ' accepted, booking ' || v_reference);

  update public.crm_followups set status = 'CANCELLED', updated_at = now()
   where opportunity_id = o.id and status = 'OPEN';

  update public.crm_customers
     set first_won_at = coalesce(first_won_at, now()), last_activity_at = now(),
         status = 'ACTIVE', updated_at = now()
   where id = c.id;

  if o.lead_id is not null then
    update public.crm_leads
       set status = 'CONVERTED', converted_at = coalesce(converted_at, now()), updated_at = now()
     where id = o.lead_id and status <> 'CONVERTED';
  end if;

  insert into public.crm_activities(
    agency_id, branch_id, customer_id, lead_id, opportunity_id, quote_id,
    activity_type, direction, subject, body)
  values (q.agency_id, q.branch_id, c.id, o.lead_id, o.id, q.id, 'SYSTEM', 'INBOUND',
          'Quote ' || q.quote_number || ' accepted',
          'Booking ' || v_reference || ' created for ' || v_travelers::text || ' traveller(s)');

  return jsonb_build_object(
    'quote_id', q.id, 'quote_number', q.quote_number, 'opportunity_id', o.id,
    'customer_id', c.id, 'pilgrim_id', v_pilgrim, 'booking_id', v_booking,
    'booking_reference', v_reference, 'payment_id', v_payment, 'journal_entry_id', v_journal,
    'travelers', v_travelers, 'currency_code', q.currency_code, 'total_amount', q.total_amount);
end;
$$;
revoke all on function private.accept_crm_quote(uuid,numeric,numeric,text,uuid,text,text)
  from public, anon, authenticated;
-- ============================================================================
-- N. Public command surface. Business names only; the UI never names a table.
--    SECURITY DEFINER, like the adapters in 20260630134500, so the wrapper
--    itself carries the authority to reach the private body.
-- ============================================================================

create or replace function public.convert_crm_lead_command(
  p_lead_id             uuid,
  p_package_id          uuid    default null,
  p_travelers           integer default 1,
  p_expected_value_dzd  numeric default null,
  p_expected_close_date date    default null,
  p_title               text    default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.convert_crm_lead($1, $2, $3, $4, $5, $6);
$w$;

create or replace function public.transition_crm_opportunity_stage(
  p_opportunity_id uuid,
  p_to_stage       text,
  p_note           text default null,
  p_lost_reason    text default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.move_crm_opportunity_stage($1, $2, $3, $4);
$w$;

create or replace function public.send_crm_quote_command(
  p_quote_id uuid, p_valid_days integer default 14
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.send_crm_quote($1, $2);
$w$;

create or replace function public.decline_crm_quote_command(
  p_quote_id uuid, p_reason text
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.decline_crm_quote($1, $2);
$w$;

create or replace function public.accept_crm_quote_command(
  p_quote_id           uuid,
  p_payment_amount_dzd numeric default 0,
  p_payment_amount_sar numeric default 0,
  p_payment_method     text    default 'Cash',
  p_group_id           uuid    default null,
  p_passport_number    text    default null,
  p_notes              text    default null
) returns jsonb language sql security definer set search_path = public, pg_catalog as $w$
  select private.accept_crm_quote($1, $2, $3, $4, $5, $6, $7);
$w$;

revoke all on function public.convert_crm_lead_command(uuid,uuid,integer,numeric,date,text) from public, anon;
revoke all on function public.transition_crm_opportunity_stage(uuid,text,text,text) from public, anon;
revoke all on function public.send_crm_quote_command(uuid,integer) from public, anon;
revoke all on function public.decline_crm_quote_command(uuid,text) from public, anon;
revoke all on function public.accept_crm_quote_command(uuid,numeric,numeric,text,uuid,text,text) from public, anon;

grant execute on function public.convert_crm_lead_command(uuid,uuid,integer,numeric,date,text) to authenticated;
grant execute on function public.transition_crm_opportunity_stage(uuid,text,text,text) to authenticated;
grant execute on function public.send_crm_quote_command(uuid,integer) to authenticated;
grant execute on function public.decline_crm_quote_command(uuid,text) to authenticated;
grant execute on function public.accept_crm_quote_command(uuid,numeric,numeric,text,uuid,text,text) to authenticated;
-- ============================================================================
-- O. Generic helpers: skip generated columns.
--    crm_quote_lines.line_total is GENERATED ALWAYS, and both helpers in
--    20260630134500 / 20260823130000 enumerate every column in
--    information_schema.columns. An UPDATE that names a generated column fails
--    with "can only be updated to DEFAULT", so the patch helper would break on
--    any table that has one. Same body, one extra predicate.
-- ============================================================================

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
  v_table_name := regexp_replace(p_table::text, '^.*\.', '');
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
    and is_generated = 'NEVER'
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
revoke all on function public.patch_scoped_command_row(regclass,uuid,jsonb) from public,anon,authenticated;
-- The insert helper had two type problems that the CRM tables expose:
-- it cast every value with ($1->>'col')::<data_type>, so information_schema's
-- data_type of 'ARRAY' (crm_customers.tags) produced an invalid cast, and text
-- extraction cannot build an array literal anyway. jsonb_populate_record does
-- the whole conversion correctly for arrays, enums and timestamps alike, and
-- pg_attribute lets us skip generated columns.
create or replace function public.insert_scoped_command_row(
    p_table REGCLASS,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
    v_table_name TEXT;
    v_has_agency BOOLEAN;
    v_has_branch BOOLEAN;
    v_cols       TEXT;
    v_values     TEXT;
    v_sql        TEXT;
    v_row        JSONB;
BEGIN
    IF p_payload IS NULL OR p_payload = '{}'::JSONB THEN
        RAISE EXCEPTION 'Command payload is empty' USING ERRCODE = '22023';
    END IF;

    v_table_name := regexp_replace(p_table::text, '^.*\.', '');

    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
           string_agg('r.' || quote_ident(a.attname), ', ' ORDER BY a.attnum)
      INTO v_cols, v_values
    FROM pg_attribute a
    WHERE a.attrelid = p_table
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attgenerated = ''
      AND a.attname = ANY (ARRAY(SELECT jsonb_object_keys(p_payload)))
      AND a.attname NOT IN ('id', 'agency_id', 'branch_id', 'created_at', 'updated_at');

    IF v_cols IS NULL THEN
        RAISE EXCEPTION 'No valid insert columns for command table %', v_table_name USING ERRCODE = '22023';
    END IF;

    SELECT exists(SELECT 1 FROM pg_attribute a WHERE a.attrelid = p_table AND a.attname = 'agency_id' AND a.attnum > 0 AND NOT a.attisdropped),
           exists(SELECT 1 FROM pg_attribute a WHERE a.attrelid = p_table AND a.attname = 'branch_id' AND a.attnum > 0 AND NOT a.attisdropped)
      INTO v_has_agency, v_has_branch;

    IF v_has_agency THEN
        v_cols := v_cols || ', agency_id';
        v_values := v_values || ', public.current_staff_agency_id()';
    END IF;
    IF v_has_branch THEN
        v_cols := v_cols || ', branch_id';
        v_values := v_values || ', public.staff_branch_id()';
    END IF;

    v_sql := format(
      'with ins as (insert into %1$s (%2$s) select %3$s from jsonb_populate_record(null::%1$s, $1) r returning *) select to_jsonb(ins) from ins',
      p_table, v_cols, v_values);

    EXECUTE v_sql INTO v_row USING p_payload;
    RETURN v_row;
END;
$fn$;
REVOKE ALL ON FUNCTION public.insert_scoped_command_row(REGCLASS, JSONB) FROM PUBLIC, anon, authenticated;
-- ============================================================================
-- P. Domain-named CRUD adapters for the new CRM tables
-- ============================================================================

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('crm_customer',    'crm_customers'),
      ('crm_opportunity', 'crm_opportunities'),
      ('crm_quote',       'crm_quotes'),
      ('crm_quote_line',  'crm_quote_lines'),
      ('crm_activity',    'crm_activities'),
      ('crm_followup',    'crm_followups'),
      ('crm_campaign',    'crm_campaigns')
    ) as t(name, tbl)
  loop
    execute format($f$
      create or replace function public.create_%1$s_command(p_payload jsonb)
      returns jsonb language sql security definer set search_path=public,pg_catalog as $w$
        select public.insert_scoped_command_row('public.%2$s'::regclass, p_payload);
      $w$;
    $f$, spec.name, spec.tbl);
    execute format($f$
      create or replace function public.update_%1$s_command(p_id uuid, p_payload jsonb)
      returns jsonb language sql security definer set search_path=public,pg_catalog as $w$
        select public.patch_scoped_command_row('public.%2$s'::regclass, p_id, p_payload);
      $w$;
    $f$, spec.name, spec.tbl);
    execute format($f$
      create or replace function public.delete_%1$s_command(p_id uuid)
      returns jsonb language sql security definer set search_path=public,pg_catalog as $w$
        select public.delete_scoped_command_row('public.%2$s'::regclass, p_id);
      $w$;
    $f$, spec.name, spec.tbl);

    execute format('revoke all on function public.create_%s_command(jsonb) from public, anon', spec.name);
    execute format('revoke all on function public.update_%s_command(uuid,jsonb) from public, anon', spec.name);
    execute format('revoke all on function public.delete_%s_command(uuid) from public, anon', spec.name);
    execute format('grant execute on function public.create_%s_command(jsonb) to authenticated', spec.name);
    execute format('grant execute on function public.update_%s_command(uuid,jsonb) to authenticated', spec.name);
    execute format('grant execute on function public.delete_%s_command(uuid) to authenticated', spec.name);
  end loop;
end $$;

-- tags is text[]; it goes through its own command rather than a jsonb payload.
create or replace function public.set_crm_customer_tags_command(p_id uuid, p_tags text[])
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row jsonb;
begin
  update public.crm_customers t
     set tags = coalesce(p_tags, '{}'), updated_at = now()
   where t.id = p_id and public.row_in_staff_scope(t.agency_id, t.branch_id)
  returning to_jsonb(t) into v_row;
  if v_row is null then
    raise exception 'Record not found in authorized scope' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
revoke all on function public.set_crm_customer_tags_command(uuid,text[]) from public, anon;
grant execute on function public.set_crm_customer_tags_command(uuid,text[]) to authenticated;

-- Completing a follow-up is a state change, not a free-form patch.
create or replace function public.complete_crm_followup_command(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare f public.crm_followups%rowtype;
begin
  select * into f from public.crm_followups where id = p_id for update;
  if not found or not public.row_in_staff_scope(f.agency_id, f.branch_id) then
    raise exception 'Record not found in authorized scope' using errcode = '42501';
  end if;
  if f.status <> 'OPEN' then
    raise exception 'Follow-up is already %', f.status using errcode = '22023';
  end if;
  update public.crm_followups
     set status = 'DONE', completed_at = now(),
         notes = coalesce(nullif(trim(coalesce(p_note,'')),''), notes), updated_at = now()
   where id = f.id;
  insert into public.crm_activities(
    agency_id, branch_id, customer_id, lead_id, opportunity_id, activity_type, subject, body)
  values (f.agency_id, f.branch_id, f.customer_id, f.lead_id, f.opportunity_id, 'SYSTEM',
          'Follow-up completed: ' || f.title, nullif(trim(coalesce(p_note,'')),''));
  return jsonb_build_object('id', f.id, 'status', 'DONE');
end;
$$;
revoke all on function public.complete_crm_followup_command(uuid,text) from public, anon;
grant execute on function public.complete_crm_followup_command(uuid,text) to authenticated;
-- ============================================================================
-- Q. Analytics. SECURITY DEFINER bypasses RLS, so every query filters on
--    public.row_in_staff_scope explicitly.
-- ============================================================================

create or replace function public.get_crm_pipeline_summary(
  p_from date default null, p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_from date := coalesce(p_from, current_date - 365);
  v_to   date := coalesce(p_to, current_date + 365);
  v      jsonb;
begin
  if not public.has_permission('crm_opportunities','read') then
    raise exception 'Not authorized to read the CRM pipeline' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.sort_order), '[]'::jsonb) into v
  from (
    select s.stage,
           s.sort_order,
           count(o.id)                                                        as opportunity_count,
           coalesce(sum(o.expected_value_dzd), 0)::numeric(16,2)              as value_dzd,
           coalesce(sum(o.expected_value_dzd * o.probability / 100.0), 0)::numeric(16,2) as weighted_dzd,
           coalesce(sum(o.travelers), 0)                                      as travelers
    from (values ('NEW',1),('QUALIFYING',2),('PROPOSAL',3),('NEGOTIATION',4),('WON',5),('LOST',6))
           as s(stage, sort_order)
    left join public.crm_opportunities o
           on o.stage = s.stage
          and public.row_in_staff_scope(o.agency_id, o.branch_id)
          and o.created_at::date between v_from and v_to
    group by s.stage, s.sort_order
  ) x;
  return v;
end;
$$;

create or replace function public.get_crm_forecast(p_months integer default 6)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $$
declare
  v_months integer := least(greatest(coalesce(p_months, 6), 1), 24);
  v        jsonb;
begin
  if not public.has_permission('crm_opportunities','read') then
    raise exception 'Not authorized to read the CRM forecast' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.month), '[]'::jsonb) into v
  from (
    select to_char(date_trunc('month', m.month), 'YYYY-MM')                    as month,
           count(o.id)                                                         as opportunity_count,
           coalesce(sum(o.expected_value_dzd), 0)::numeric(16,2)               as pipeline_dzd,
           coalesce(sum(case when o.stage not in ('WON','LOST')
                             then o.expected_value_dzd * o.probability / 100.0 end), 0)::numeric(16,2) as weighted_dzd,
           coalesce(sum(case when o.stage = 'WON' then o.expected_value_dzd end), 0)::numeric(16,2)    as won_dzd,
           coalesce(sum(case when o.stage = 'LOST' then o.expected_value_dzd end), 0)::numeric(16,2)   as lost_dzd
    from generate_series(date_trunc('month', current_date),
                         date_trunc('month', current_date) + make_interval(months => v_months - 1),
                         interval '1 month') as m(month)
    left join public.crm_opportunities o
           on date_trunc('month', coalesce(o.expected_close_date, o.created_at::date)) = m.month
          and public.row_in_staff_scope(o.agency_id, o.branch_id)
    group by m.month
  ) x;
  return v;
end;
$$;
create or replace function public.get_crm_funnel(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $fn$
declare
  v_from date := coalesce(p_from, (current_date - interval '180 days')::date);
  v_to   date := coalesce(p_to, current_date);
  v_leads bigint; v_contacted bigint; v_qualified bigint; v_converted bigint; v_lead_lost bigint;
  v_opps bigint; v_quoted bigint; v_won bigint; v_lost bigint; v_won_dzd numeric;
begin
  if not (public.has_permission('crm_opportunities','read') or public.is_admin()) then
    raise exception 'Not authorized to read the CRM funnel' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where l.status <> 'NEW'),
         count(*) filter (where l.status in ('QUALIFIED','PROPOSAL','CONVERTED')),
         count(*) filter (where l.status = 'CONVERTED'),
         count(*) filter (where l.status = 'LOST')
    into v_leads, v_contacted, v_qualified, v_converted, v_lead_lost
  from public.crm_leads l
  where public.row_in_staff_scope(l.agency_id, l.branch_id)
    and l.created_at::date between v_from and v_to;

  select count(*),
         count(*) filter (where o.stage = 'WON'),
         count(*) filter (where o.stage = 'LOST'),
         coalesce(sum(o.expected_value_dzd) filter (where o.stage = 'WON'), 0)
    into v_opps, v_won, v_lost, v_won_dzd
  from public.crm_opportunities o
  where public.row_in_staff_scope(o.agency_id, o.branch_id)
    and o.created_at::date between v_from and v_to;

  select count(distinct q.opportunity_id)
    into v_quoted
  from public.crm_quotes q
  where public.row_in_staff_scope(q.agency_id, q.branch_id)
    and q.status <> 'DRAFT'
    and q.created_at::date between v_from and v_to;

  -- Every ratio is a division of two counts printed above it, so the caller can
  -- re-derive it. Nothing here is a stored or hand-maintained number.
  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'stages', jsonb_build_array(
      jsonb_build_object('key','LEADS',        'label','عملاء محتملون', 'count', v_leads),
      jsonb_build_object('key','CONTACTED',    'label','تم التواصل',    'count', v_contacted),
      jsonb_build_object('key','QUALIFIED',    'label','مؤهل',          'count', v_qualified),
      jsonb_build_object('key','OPPORTUNITIES','label','فرص',           'count', v_opps),
      jsonb_build_object('key','QUOTED',       'label','عروض مرسلة',    'count', v_quoted),
      jsonb_build_object('key','WON',          'label','مكتسب',         'count', v_won)
    ),
    'lost', jsonb_build_object('leads', v_lead_lost, 'opportunities', v_lost),
    'won_value_dzd', round(v_won_dzd, 2),
    'rates', jsonb_build_object(
      'contact_rate',            case when v_leads > 0 then round(v_contacted::numeric * 100 / v_leads, 1) else null end,
      'qualification_rate',      case when v_leads > 0 then round(v_qualified::numeric * 100 / v_leads, 1) else null end,
      'lead_conversion_rate',    case when v_leads > 0 then round(v_converted::numeric * 100 / v_leads, 1) else null end,
      'quote_coverage_rate',     case when v_opps  > 0 then round(v_quoted::numeric * 100 / v_opps, 1) else null end,
      'win_rate',                case when (v_won + v_lost) > 0 then round(v_won::numeric * 100 / (v_won + v_lost), 1) else null end
    )
  );
end;
$fn$;

-- Customer 360: one round trip returning the customer, their pipeline, their
-- paper trail and their money. The pilgrim link is what joins CRM to operations
-- and accounting -- a customer with no pilgrim row simply has empty booking and
-- payment arrays rather than a fabricated zero.
create or replace function public.get_crm_customer_360(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $fn$
declare
  c public.crm_customers;
  v_out jsonb;
begin
  if not (public.has_permission('crm_customers','read') or public.is_admin()) then
    raise exception 'Not authorized to read customers' using errcode = '42501';
  end if;

  select * into c from public.crm_customers where id = p_customer_id;
  if not found or not public.row_in_staff_scope(c.agency_id, c.branch_id) then
    raise exception 'Customer not found in authorized scope' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'customer', to_jsonb(c),
    'lead', (select to_jsonb(l) from public.crm_leads l where l.id = c.lead_id),
    'campaign', (select jsonb_build_object('id', m.id, 'code', m.code, 'name', m.name, 'channel', m.channel)
                   from public.crm_campaigns m where m.id = c.campaign_id),
    'opportunities', (
      select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb)
      from public.crm_opportunities o where o.customer_id = c.id),
    'quotes', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
      from public.crm_quotes q where q.customer_id = c.id),
    'activities', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb)
      from (select * from public.crm_activities
             where customer_id = c.id order by occurred_at desc limit 100) a),
    'followups', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.due_at), '[]'::jsonb)
      from public.crm_followups f where f.customer_id = c.id and f.status = 'OPEN'),
    'bookings', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at desc), '[]'::jsonb)
      from public.bookings b
      where c.pilgrim_id is not null and b.pilgrim_id = c.pilgrim_id
        and public.row_in_staff_scope(b.agency_id, b.branch_id)),
    'payments', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p.received_at desc), '[]'::jsonb)
      from public.payments p
      where c.pilgrim_id is not null and p.pilgrim_id = c.pilgrim_id
        and public.row_in_staff_scope(p.agency_id, p.branch_id)),
    'totals', (
      select jsonb_build_object(
        'bookings', count(*),
        'travelers', coalesce(sum(b.travelers), 0),
        'booked_dzd', coalesce(sum(b.total_dzd), 0),
        'booked_sar', coalesce(sum(b.total_sar), 0),
        'paid_dzd', coalesce(sum(b.paid_dzd), 0),
        'paid_sar', coalesce(sum(b.paid_sar), 0),
        'outstanding_dzd', coalesce(sum(b.total_dzd - b.paid_dzd), 0),
        'outstanding_sar', coalesce(sum(b.total_sar - b.paid_sar), 0))
      from public.bookings b
      where c.pilgrim_id is not null and b.pilgrim_id = c.pilgrim_id
        and public.row_in_staff_scope(b.agency_id, b.branch_id)
        and b.status <> 'CANCELLED'),
    'open_pipeline_dzd', (
      select coalesce(sum(o.expected_value_dzd), 0) from public.crm_opportunities o
      where o.customer_id = c.id and o.stage not in ('WON','LOST'))
  ) into v_out;

  return v_out;
end;
$fn$;

-- Customer profitability. There is no cost column on packages anywhere in this
-- schema, so a per-customer "margin" cannot be read off a field -- it has to be
-- derived from the ledger or not reported at all. Cost here is the customer's
-- share of their group's POSTED EXPENSE debits, allocated per traveller. When a
-- booking's group carries no expense lines, cost is null and margin is null
-- rather than zero: an unknown cost must not render as a 100% margin.
alter table public.journal_entries add column if not exists group_id uuid;

create or replace function public.get_crm_customer_profitability(
  p_from  date default null,
  p_to    date default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $fn$
declare
  v_from  date := coalesce(p_from, (current_date - interval '365 days')::date);
  v_to    date := coalesce(p_to, current_date);
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_rows  jsonb;
begin
  if not (public.has_permission('crm_customers','read') or public.is_admin()) then
    raise exception 'Not authorized to read customer profitability' using errcode = '42501';
  end if;

  with scoped_bookings as (
    select b.id, b.pilgrim_id, b.group_id, b.travelers, b.total_dzd, b.paid_dzd
    from public.bookings b
    where public.row_in_staff_scope(b.agency_id, b.branch_id)
      and b.status <> 'CANCELLED'
      and b.created_at::date between v_from and v_to
  ),
  group_cost as (
    select je.group_id, sum(jl.debit - jl.credit) as cost_dzd
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.chart_of_accounts a on a.id = jl.account_id
    where je.group_id is not null
      and je.status = 'POSTED'
      and a.account_type = 'EXPENSE'
      and jl.currency_code = 'DZD'
      and public.row_in_staff_scope(je.agency_id, je.branch_id)
    group by je.group_id
  ),
  group_load as (
    select b.group_id, sum(b.travelers) as travelers
    from public.bookings b
    where b.group_id is not null and b.status <> 'CANCELLED'
      and public.row_in_staff_scope(b.agency_id, b.branch_id)
    group by b.group_id
  ),
  per_booking as (
    select sb.id, sb.pilgrim_id, sb.travelers, sb.total_dzd, sb.paid_dzd,
           case when coalesce(gl.travelers, 0) > 0 and gc.cost_dzd is not null
                then round(gc.cost_dzd / gl.travelers * sb.travelers, 2)
           end as alloc_cost_dzd
    from scoped_bookings sb
    left join group_cost gc on gc.group_id = sb.group_id
    left join group_load gl on gl.group_id = sb.group_id
  ),
  per_customer as (
    select c.id, c.code, c.full_name, c.customer_type, c.status, c.phone, c.first_won_at,
           count(pb.id)                                as bookings,
           coalesce(sum(pb.travelers), 0)              as travelers,
           coalesce(sum(pb.total_dzd), 0)              as booked_dzd,
           coalesce(sum(pb.paid_dzd), 0)               as collected_dzd,
           coalesce(sum(pb.total_dzd - pb.paid_dzd), 0) as outstanding_dzd,
           sum(pb.alloc_cost_dzd)                      as cost_dzd,
           coalesce(sum(pb.total_dzd) filter (where pb.alloc_cost_dzd is not null), 0) as costed_dzd
    from public.crm_customers c
    join per_booking pb
      on c.pilgrim_id is not null and pb.pilgrim_id = c.pilgrim_id
    where public.row_in_staff_scope(c.agency_id, c.branch_id)
    group by c.id, c.code, c.full_name, c.customer_type, c.status, c.phone, c.first_won_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'customer_id', r.id, 'code', r.code, 'full_name', r.full_name,
           'customer_type', r.customer_type, 'status', r.status, 'phone', r.phone,
           'first_won_at', r.first_won_at,
           'bookings', r.bookings, 'travelers', r.travelers,
           'booked_dzd', round(r.booked_dzd, 2),
           'collected_dzd', round(r.collected_dzd, 2),
           'outstanding_dzd', round(r.outstanding_dzd, 2),
           'cost_dzd', case when r.cost_dzd is null then null else round(r.cost_dzd, 2) end,
           'margin_dzd', case when r.cost_dzd is null then null
                              else round(r.collected_dzd - r.cost_dzd, 2) end,
           'margin_pct', case when r.cost_dzd is null or r.collected_dzd <= 0 then null
                              else round((r.collected_dzd - r.cost_dzd) * 100 / r.collected_dzd, 1) end,
           -- What share of this customer's booked value actually had ledger cost
           -- behind it. 0 means the margin above is null, not that cost was zero.
           'cost_coverage_pct', case when r.booked_dzd > 0
                                     then round(r.costed_dzd * 100 / r.booked_dzd, 1) else null end
         ) order by r.collected_dzd desc), '[]'::jsonb)
    into v_rows
  from (select * from per_customer order by collected_dzd desc limit v_limit) r;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'limit', v_limit,
    'cost_basis', 'GROUP_EXPENSE_PER_TRAVELLER',
    'cost_currency', 'DZD',
    'customers', v_rows
  );
end;
$fn$;

-- Campaign ROI. Spend is the only figure a human types in; every other number
-- is counted from leads, opportunities and bookings attributed to the campaign.
-- Ratios are null when their denominator is zero -- an undefined ROI is not 0%.
create or replace function public.get_crm_campaign_roi(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $fn$
declare
  v_from date := coalesce(p_from, (current_date - interval '365 days')::date);
  v_to   date := coalesce(p_to, current_date);
  v_rows jsonb;
begin
  if not (public.has_permission('crm_campaigns','read') or public.is_admin()) then
    raise exception 'Not authorized to read campaign performance' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign_id', m.id, 'code', m.code, 'name', m.name,
           'channel', m.channel, 'status', m.status,
           'start_date', m.start_date, 'end_date', m.end_date,
           'budget_dzd', m.budget_dzd, 'spend_dzd', m.spend_dzd,
           'leads', lc.leads, 'converted_leads', lc.converted,
           'opportunities', oc.opportunities, 'won', oc.won,
           'won_pipeline_dzd', round(oc.won_dzd, 2),
           'bookings', bc.bookings,
           'booked_dzd', round(bc.booked_dzd, 2),
           'collected_dzd', round(bc.collected_dzd, 2),
           'cost_per_lead_dzd', case when lc.leads > 0 and m.spend_dzd > 0
                                     then round(m.spend_dzd / lc.leads, 2) end,
           'cost_per_won_dzd',  case when oc.won > 0 and m.spend_dzd > 0
                                     then round(m.spend_dzd / oc.won, 2) end,
           'conversion_rate',   case when lc.leads > 0
                                     then round(lc.converted::numeric * 100 / lc.leads, 1) end,
           'roi_pct',           case when m.spend_dzd > 0
                                     then round((bc.collected_dzd - m.spend_dzd) * 100 / m.spend_dzd, 1) end,
           'budget_used_pct',   case when m.budget_dzd > 0
                                     then round(m.spend_dzd * 100 / m.budget_dzd, 1) end
         ) order by m.start_date desc nulls last, m.created_at desc), '[]'::jsonb)
    into v_rows
  from public.crm_campaigns m
  cross join lateral (
    select count(*) as leads,
           count(*) filter (where l.status = 'CONVERTED') as converted
    from public.crm_leads l
    where l.campaign_id = m.id
      and public.row_in_staff_scope(l.agency_id, l.branch_id)
      and l.created_at::date between v_from and v_to
  ) lc
  cross join lateral (
    select count(*) as opportunities,
           count(*) filter (where o.stage = 'WON') as won,
           coalesce(sum(o.expected_value_dzd) filter (where o.stage = 'WON'), 0) as won_dzd
    from public.crm_opportunities o
    where o.campaign_id = m.id
      and public.row_in_staff_scope(o.agency_id, o.branch_id)
      and o.created_at::date between v_from and v_to
  ) oc
  cross join lateral (
    select count(*) as bookings,
           coalesce(sum(b.total_dzd), 0) as booked_dzd,
           coalesce(sum(b.paid_dzd), 0)  as collected_dzd
    from public.crm_customers c
    join public.bookings b on b.pilgrim_id = c.pilgrim_id
    where c.campaign_id = m.id
      and c.pilgrim_id is not null
      and public.row_in_staff_scope(c.agency_id, c.branch_id)
      and public.row_in_staff_scope(b.agency_id, b.branch_id)
      and b.status <> 'CANCELLED'
      and b.created_at::date between v_from and v_to
  ) bc
  where public.row_in_staff_scope(m.agency_id, m.branch_id);

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    'revenue_basis', 'COLLECTED_BOOKING_PAYMENTS_DZD',
    'campaigns', v_rows
  );
end;
$fn$;

-- One round trip for the CRM home screen. Composed from the RPCs above rather
-- than re-implementing their arithmetic, so the dashboard and the detail views
-- can never disagree with each other.
create or replace function public.get_crm_dashboard(p_days integer default 90)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog
as $fn$
declare
  v_days integer := least(greatest(coalesce(p_days, 90), 7), 730);
  v_from date := (current_date - make_interval(days => v_days))::date;
begin
  if not (public.has_permission('crm_opportunities','read') or public.is_admin()) then
    raise exception 'Not authorized to read the CRM dashboard' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'window_days', v_days,
    'from', v_from,
    'to', current_date,
    'pipeline', public.get_crm_pipeline_summary(v_from, current_date),
    'funnel',   public.get_crm_funnel(v_from, current_date),
    'forecast', public.get_crm_forecast(6),
    'counters', (
      select jsonb_build_object(
        'open_leads', (select count(*) from public.crm_leads l
                        where public.row_in_staff_scope(l.agency_id, l.branch_id)
                          and l.status not in ('CONVERTED','LOST')),
        'customers', (select count(*) from public.crm_customers c
                       where public.row_in_staff_scope(c.agency_id, c.branch_id)
                         and c.status = 'ACTIVE'),
        'open_opportunities', (select count(*) from public.crm_opportunities o
                                where public.row_in_staff_scope(o.agency_id, o.branch_id)
                                  and o.stage not in ('WON','LOST')),
        'quotes_awaiting_reply', (select count(*) from public.crm_quotes q
                                   where public.row_in_staff_scope(q.agency_id, q.branch_id)
                                     and q.status = 'SENT'),
        'overdue_followups', (select count(*) from public.crm_followups f
                               where public.row_in_staff_scope(f.agency_id, f.branch_id)
                                 and f.status = 'OPEN' and f.due_at < now()),
        'due_today_followups', (select count(*) from public.crm_followups f
                                 where public.row_in_staff_scope(f.agency_id, f.branch_id)
                                   and f.status = 'OPEN'
                                   and f.due_at::date = current_date),
        'active_campaigns', (select count(*) from public.crm_campaigns m
                              where public.row_in_staff_scope(m.agency_id, m.branch_id)
                                and m.status = 'ACTIVE'))
    ),
    'due_followups', (
      select coalesce(jsonb_agg(to_jsonb(f) order by f.due_at), '[]'::jsonb)
      from (select * from public.crm_followups
             where public.row_in_staff_scope(agency_id, branch_id)
               and status = 'OPEN' and due_at < current_date + interval '1 day'
             order by due_at limit 50) f
    ),
    'recent_activities', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb)
      from (select * from public.crm_activities
             where public.row_in_staff_scope(agency_id, branch_id)
             order by occurred_at desc limit 30) a
    ),
    'top_open_opportunities', (
      select coalesce(jsonb_agg(to_jsonb(o) order by o.expected_value_dzd desc), '[]'::jsonb)
      from (select * from public.crm_opportunities
             where public.row_in_staff_scope(agency_id, branch_id)
               and stage not in ('WON','LOST')
             order by expected_value_dzd desc limit 10) o
    )
  );
end;
$fn$;

revoke all on function public.get_crm_pipeline_summary(date, date) from public, anon;
revoke all on function public.get_crm_forecast(integer) from public, anon;
revoke all on function public.get_crm_funnel(date, date) from public, anon;
revoke all on function public.get_crm_customer_360(uuid) from public, anon;
revoke all on function public.get_crm_customer_profitability(date, date, integer) from public, anon;
revoke all on function public.get_crm_campaign_roi(date, date) from public, anon;
revoke all on function public.get_crm_dashboard(integer) from public, anon;

grant execute on function public.get_crm_pipeline_summary(date, date) to authenticated;
grant execute on function public.get_crm_forecast(integer) to authenticated;
grant execute on function public.get_crm_funnel(date, date) to authenticated;
grant execute on function public.get_crm_customer_360(uuid) to authenticated;
grant execute on function public.get_crm_customer_profitability(date, date, integer) to authenticated;
grant execute on function public.get_crm_campaign_roi(date, date) to authenticated;
grant execute on function public.get_crm_dashboard(integer) to authenticated;

-- ============================================================================
-- R. Repair of public.get_group_profitability.
--
--    The definition in 20260822000007_unit_economics_engine.sql was accepted by
--    Postgres and failed on every call: it read jl.credit_dzd / jl.debit_dzd /
--    jl.credit_sar / jl.debit_sar / jl.entry_id and joined a table named
--    `accounts`, none of which exist. The real shapes are
--    public.journal_lines(journal_entry_id, account_id, currency_code, debit,
--    credit) and public.chart_of_accounts(account_type). It was also SECURITY
--    DEFINER with no SET search_path and no tenancy filter, so it would have let
--    any authenticated caller read any agency's group economics.
--
--    Same signature and same output columns as before, so the declaration in
--    src/types/database.ts stays correct.
-- ============================================================================
create or replace function public.get_group_profitability(p_group_id uuid)
returns table (
  total_revenue_dzd numeric,
  total_revenue_sar numeric,
  total_cost_dzd    numeric,
  total_cost_sar    numeric,
  margin_dzd        numeric,
  margin_sar        numeric,
  margin_percentage numeric
)
language plpgsql stable security definer set search_path = public, pg_catalog
as $fn$
declare
  g_agency uuid;
  g_branch uuid;
  v_rev_dzd  numeric := 0;
  v_rev_sar  numeric := 0;
  v_cost_dzd numeric := 0;
  v_cost_sar numeric := 0;
begin
  if not (public.has_permission('groups','read') or public.is_admin()) then
    raise exception 'Not authorized to read group economics' using errcode = '42501';
  end if;

  select gr.agency_id, gr.branch_id into g_agency, g_branch
  from public.groups gr where gr.id = p_group_id;
  if not found or not public.row_in_staff_scope(g_agency, g_branch) then
    raise exception 'Group not found in authorized scope' using errcode = '42501';
  end if;

  -- REVENUE accounts are credit-normal, EXPENSE accounts debit-normal, so each
  -- side is netted in its own direction. Only POSTED entries count; DRAFT and
  -- VOID entries are not economics.
  select
    coalesce(sum(case when a.account_type = 'REVENUE' and jl.currency_code = 'DZD'
                      then jl.credit - jl.debit end), 0),
    coalesce(sum(case when a.account_type = 'REVENUE' and jl.currency_code = 'SAR'
                      then jl.credit - jl.debit end), 0),
    coalesce(sum(case when a.account_type = 'EXPENSE' and jl.currency_code = 'DZD'
                      then jl.debit - jl.credit end), 0),
    coalesce(sum(case when a.account_type = 'EXPENSE' and jl.currency_code = 'SAR'
                      then jl.debit - jl.credit end), 0)
    into v_rev_dzd, v_rev_sar, v_cost_dzd, v_cost_sar
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.chart_of_accounts a on a.id = jl.account_id
  where je.group_id = p_group_id
    and je.status = 'POSTED'
    and public.row_in_staff_scope(je.agency_id, je.branch_id);

  return query
  select round(v_rev_dzd, 2),
         round(v_rev_sar, 2),
         round(v_cost_dzd, 2),
         round(v_cost_sar, 2),
         round(v_rev_dzd - v_cost_dzd, 2),
         round(v_rev_sar - v_cost_sar, 2),
         -- Undefined rather than 0 when there is no revenue to divide by.
         case when v_rev_dzd > 0
              then round((v_rev_dzd - v_cost_dzd) * 100 / v_rev_dzd, 2) end;
end;
$fn$;

revoke all on function public.get_group_profitability(uuid) from public, anon;
grant execute on function public.get_group_profitability(uuid) to authenticated;

-- The reconciliation module calls its line table public.bank_transactions, and
-- its matched_journal_line_id foreign key was never indexed (the FK-index pass
-- at 20260425042200 indexed a public.bank_statement_lines that never existed).
create index if not exists idx_bank_tx_matched_journal_line
  on public.bank_transactions(matched_journal_line_id);

-- ============================================================================
-- S. Realtime. 20260321133200 registers 26 tables with supabase_realtime so the
--    dashboards update without polling; a table created later is not in the
--    publication and its screen silently goes stale. Same loop, same
--    duplicate_object swallow, for the tables added above.
-- ============================================================================

do $realtime$
declare
  tbl text;
begin
  foreach tbl in array array[
    'crm_campaigns','crm_customers','crm_opportunities','crm_stage_history',
    'crm_quotes','crm_quote_lines','crm_activities','crm_followups'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', tbl);
    exception
      when duplicate_object then null;
      -- A self-hosted Postgres without the Supabase realtime publication is a
      -- valid target for this ledger; missing live updates must not stop a replay.
      when undefined_object then null;
      when insufficient_privilege then null;
    end;
  end loop;
end
$realtime$;



