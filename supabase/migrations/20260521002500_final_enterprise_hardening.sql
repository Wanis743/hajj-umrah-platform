-- FINAL ENTERPRISE HARDENING
-- Purpose: close remaining P0/P1 correctness/security gaps without adding tenant complexity.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Audit privacy, correlation and retention
-- -----------------------------------------------------------------------------
alter table public.audit_logs add column if not exists correlation_id uuid;
alter table public.audit_logs add column if not exists ip_address inet;
alter table public.audit_logs add column if not exists actor_role text;
alter table public.audit_logs add column if not exists retention_until timestamptz;

create or replace function private.redact_audit_jsonb(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  item record;
  result jsonb := case jsonb_typeof(p_value) when 'object' then '{}'::jsonb when 'array' then '[]'::jsonb else p_value end;
  key text;
  val jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) not in ('object','array') then
    return p_value;
  end if;
  if jsonb_typeof(p_value) = 'array' then
    for item in select value from jsonb_array_elements(p_value) loop
      result := result || jsonb_build_array(private.redact_audit_jsonb(item.value));
    end loop;
    return result;
  end if;
  for item in select key, value from jsonb_each(p_value) loop
    key := lower(item.key);
    if key ~ '(passport|document(_number)?|medical|emergency_phone|authorization|apikey|api_key|access_token|refresh_token|password|secret|cookie|cvv|card_number|iban)' then
      val := to_jsonb('[REDACTED]'::text);
    elsif key ~ '(phone|email)' then
      if jsonb_typeof(item.value) = 'string' then
        val := to_jsonb('[MASKED]'::text);
      else
        val := item.value;
      end if;
    else
      val := private.redact_audit_jsonb(item.value);
    end if;
    result := result || jsonb_build_object(item.key, val);
  end loop;
  return result;
end;
$$;

revoke all on function private.redact_audit_jsonb(jsonb) from public, anon, authenticated;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  h jsonb := '{}'::jsonb;
  request_text text;
  correlation_text text;
  actor uuid;
  actor_role text;
  ip inet;
begin
  begin h := coalesce(current_setting('request.headers', true), '{}')::jsonb; exception when others then h := '{}'::jsonb; end;
  request_text := nullif(h->>'x-request-id','');
  correlation_text := coalesce(request_text, nullif(current_setting('request.id', true), ''));
  actor := auth.uid();
  actor_role := nullif(h->>'x-user-role','');
  begin ip := nullif(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for'), '')::inet; exception when others then ip := null; end;
  insert into public.audit_logs(
    id, actor_id, actor_role, action, resource, resource_id, agency_id, branch_id,
    before_data, after_data, request_id, correlation_id, ip_address, user_agent, created_at,
    retention_until
  ) values (
    gen_random_uuid(), actor, actor_role, tg_op, tg_table_name,
    coalesce((case when tg_op='DELETE' then old else new end)->>'id')::uuid,
    coalesce((case when tg_op='DELETE' then old else new end)->>'agency_id')::uuid,
    coalesce((case when tg_op='DELETE' then old else new end)->>'branch_id')::uuid,
    case when tg_op in ('UPDATE','DELETE') then private.redact_audit_jsonb(to_jsonb(old)) end,
    case when tg_op in ('INSERT','UPDATE') then private.redact_audit_jsonb(to_jsonb(new)) end,
    case when request_text is not null then request_text::uuid end,
    case when correlation_text is not null then correlation_text::uuid else uuid_in(md5((txid_current()::text || ':' || transaction_timestamp()::text))::cstring) end,
    ip,
    nullif(h->>'user-agent',''), now(), now() + interval '7 years'
  );
  return case when tg_op='DELETE' then old else new end;
exception when invalid_text_representation then
  insert into public.audit_logs(
    id, actor_id, actor_role, action, resource, resource_id, agency_id, branch_id,
    before_data, after_data, request_id, correlation_id, ip_address, user_agent, created_at,
    retention_until
  ) values (
    gen_random_uuid(), actor, actor_role, tg_op, tg_table_name,
    null, null, null,
    case when tg_op in ('UPDATE','DELETE') then private.redact_audit_jsonb(to_jsonb(old)) end,
    case when tg_op in ('INSERT','UPDATE') then private.redact_audit_jsonb(to_jsonb(new)) end,
    null, uuid_in(md5((txid_current()::text || ':' || transaction_timestamp()::text))::cstring), ip,
    nullif(h->>'user-agent',''), now(), now() + interval '7 years'
  );
  return case when tg_op='DELETE' then old else new end;
end;
$$;

revoke all on function public.write_audit_log() from public, anon, authenticated;

create index if not exists idx_audit_logs_correlation_id on public.audit_logs(correlation_id);
create index if not exists idx_audit_logs_retention on public.audit_logs(retention_until);

-- -----------------------------------------------------------------------------
-- Admin bootstrap: claim before touching Auth, one-time + expiring + auditable.
-- -----------------------------------------------------------------------------
alter table public.admin_bootstrap add column if not exists claimed_at timestamptz;
alter table public.admin_bootstrap add column if not exists claim_token uuid;
alter table public.admin_bootstrap add column if not exists expires_at timestamptz;
alter table public.admin_bootstrap add column if not exists attempts integer not null default 0 check (attempts >= 0);

create or replace function private.claim_admin_bootstrap(p_claim_token uuid, p_ttl_seconds integer default 300)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare updated_count integer;
begin
  update public.admin_bootstrap
     set claim_token = p_claim_token,
         claimed_at = now(),
         expires_at = now() + make_interval(secs => greatest(30, least(p_ttl_seconds, 900))),
         attempts = attempts + 1
   where id = true
     and used_at is null
     and (claim_token is null or expires_at < now());
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function private.claim_admin_bootstrap(uuid, integer) from public, anon, authenticated;

grant usage on schema private to service_role;

-- -----------------------------------------------------------------------------
-- Storage validation metadata + controlled object naming.
-- -----------------------------------------------------------------------------
alter table public.documents add column if not exists checksum_sha256 text;
alter table public.documents add column if not exists storage_bucket text;
alter table public.documents add column if not exists storage_path text;
alter table public.documents add column if not exists uploaded_at timestamptz;
alter table public.documents add column if not exists uploaded_by uuid;

alter table public.documents add constraint documents_positive_size check (size_bytes is null or size_bytes >= 0);

-- -----------------------------------------------------------------------------
-- Payment method -> accounting account mapping.
-- -----------------------------------------------------------------------------
create table if not exists public.payment_method_accounts (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  method_code text not null references public.payment_methods(code) on delete restrict,
  currency_code text not null references public.currencies(code) on delete restrict,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (agency_id, method_code, currency_code)
);
alter table public.payment_method_accounts enable row level security;
revoke all on public.payment_method_accounts from anon, authenticated;
drop policy if exists payment_method_accounts_client_deny on public.payment_method_accounts;
create policy payment_method_accounts_client_deny on public.payment_method_accounts as restrictive for all to anon, authenticated using (false) with check (false);

create or replace function private.resolve_payment_account(p_agency_id uuid, p_method text, p_currency text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare account_id uuid;
begin
  select pma.account_id into account_id
    from public.payment_method_accounts pma
   where pma.agency_id = p_agency_id
     and pma.method_code = upper(replace(p_method,' ','_'))
     and pma.currency_code = p_currency;
  if account_id is null then
    select id into account_id from public.chart_of_accounts
     where agency_id=p_agency_id and code=case when p_currency='SAR' then '1101' else '1100' end;
  end if;
  if account_id is null then raise exception 'No accounting account configured for payment method/currency' using errcode='22023'; end if;
  return account_id;
end;
$$;
revoke all on function private.resolve_payment_account(uuid,text,text) from public,anon,authenticated;

-- Seed only safe defaults when the corresponding accounts exist.
insert into public.payment_method_accounts(agency_id,method_code,currency_code,account_id)
select a.id, pm.code, c.code, ca.id
from public.agencies a
cross join public.payment_methods pm
cross join public.currencies c
join public.chart_of_accounts ca
  on ca.agency_id=a.id
 and ca.currency_code=c.code
 and ca.code=case when c.code='SAR' then '1101' else '1100' end
where pm.is_active
on conflict (agency_id,method_code,currency_code) do nothing;

-- -----------------------------------------------------------------------------
-- Package / reservation invariants.
-- -----------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='reservations' and column_name='package_id' and data_type <> 'uuid') then
    alter table public.reservations add column package_uuid uuid;
    update public.reservations r set package_uuid = nullif(r.package_id,'')::uuid where r.package_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    create index if not exists idx_reservations_package_uuid on public.reservations(package_uuid);
  end if;
end $$;

alter table public.packages add constraint packages_nonnegative_price_dzd check (price_dzd >= 0);
alter table public.packages add constraint packages_nonnegative_price_sar check (price_sar >= 0);
alter table public.packages add constraint packages_nonnegative_capacity check (seats_available >= 0);
alter table public.bookings add constraint bookings_nonnegative_totals check (total_dzd >= 0 and total_sar >= 0 and paid_dzd >= 0 and paid_sar >= 0);
alter table public.payments add constraint payments_nonnegative_amounts check (amount_dzd >= 0 and amount_sar >= 0);
-- public.payment_reversals is never created by any migration in this repo, so
-- this ALTER stopped a fresh replay of the ledger. The constraint is kept behind
-- a guard so it applies the day the table is built; see also
-- public.reverse_payment_transaction, which inserts into the same missing table.
do $reversal_guard$ begin
  if to_regclass('public.payment_reversals') is not null then
    alter table public.payment_reversals drop constraint if exists payment_reversals_nonnegative_amounts;
    alter table public.payment_reversals add constraint payment_reversals_nonnegative_amounts check (amount_dzd >= 0 and amount_sar >= 0);
  end if;
end $reversal_guard$;

-- -----------------------------------------------------------------------------
-- Atomic financial workflow: every confirmed payment posts its journal before commit.
-- -----------------------------------------------------------------------------
create or replace function private.post_payment_transaction_atomic(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare je uuid;
begin
  select private.post_payment_journal(p_payment_id) into je;
  return je;
end;
$$;
revoke all on function private.post_payment_transaction_atomic(uuid) from public,anon,authenticated;

-- Override the existing writer so a payment can never commit without its journal.
create or replace function private.record_payment_transaction(
  p_booking_id uuid,
  p_amount_dzd numeric default 0,
  p_amount_sar numeric default 0,
  p_method text default 'Cash',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  b public.bookings%rowtype;
  payment_id uuid;
  next_paid_dzd numeric(14,2);
  next_paid_sar numeric(14,2);
  journal_id uuid;
begin
  if not public.has_permission('payments','create') then raise exception 'Not authorized to record payments' using errcode='42501'; end if;
  if coalesce(p_amount_dzd,0) < 0 or coalesce(p_amount_sar,0) < 0 or (coalesce(p_amount_dzd,0)=0 and coalesce(p_amount_sar,0)=0) then raise exception 'A payment must contain a positive amount' using errcode='22023'; end if;
  select * into b from public.bookings where id=p_booking_id for update;
  if not found or not public.row_in_staff_scope(b.agency_id,b.branch_id) then raise exception 'Booking not found in staff scope' using errcode='42501'; end if;
  next_paid_dzd:=coalesce(b.paid_dzd,0)+coalesce(p_amount_dzd,0);
  next_paid_sar:=coalesce(b.paid_sar,0)+coalesce(p_amount_sar,0);
  if next_paid_dzd > coalesce(b.total_dzd,0) or next_paid_sar > coalesce(b.total_sar,0) then raise exception 'Payment exceeds booking balance' using errcode='22023'; end if;
  insert into public.payments(agency_id,branch_id,booking_id,pilgrim_id,amount_dzd,amount_sar,method,status,reference,notes)
  values(b.agency_id,b.branch_id,b.id,b.pilgrim_id,coalesce(p_amount_dzd,0),coalesce(p_amount_sar,0),p_method,'CONFIRMED','PAY-'||to_char(current_date,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),nullif(trim(p_notes),''))
  returning id into payment_id;
  update public.bookings set paid_dzd=next_paid_dzd, paid_sar=next_paid_sar, status=case when next_paid_dzd=coalesce(total_dzd,0) and next_paid_sar=coalesce(total_sar,0) then 'PAID' else status end, updated_at=now() where id=b.id;
  select private.post_payment_transaction_atomic(payment_id) into journal_id;
  return jsonb_build_object('payment_id',payment_id,'booking_id',b.id,'journal_entry_id',journal_id);
end;
$$;

create or replace function public.record_payment_transaction(p_booking_id uuid,p_amount_dzd numeric default 0,p_amount_sar numeric default 0,p_method text default 'Cash',p_notes text default null)
returns jsonb language sql security invoker set search_path=public,pg_catalog as $$ select private.record_payment_transaction($1,$2,$3,$4,$5) $$;
revoke all on function public.record_payment_transaction(uuid,numeric,numeric,text,text) from public,anon;
grant execute on function public.record_payment_transaction(uuid,numeric,numeric,text,text) to authenticated;

-- -----------------------------------------------------------------------------
-- Force confirmation payment into the same atomic journal workflow.
-- -----------------------------------------------------------------------------
create or replace function private.confirm_reservation_transaction(
  p_reservation_id uuid,p_package_id uuid,p_group_id uuid default null,p_passport_number text default null,
  p_payment_amount_dzd numeric default 0,p_payment_amount_sar numeric default 0,p_payment_method text default 'Cash',p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare r public.reservations%rowtype; p public.packages%rowtype; pilgrim_id uuid; booking_id uuid; payment_id uuid; journal_id uuid; travelers int; total_dzd numeric(14,2); total_sar numeric(14,2);
begin
  if not public.has_permission('reservations','update') and public.staff_role()<>'ADMIN' then raise exception 'Not authorized to confirm reservations' using errcode='42501'; end if;
  select * into r from public.reservations where id=p_reservation_id for update;
  if not found then raise exception 'Reservation not found'; end if;
  if not public.row_in_staff_scope(r.agency_id,r.branch_id) then raise exception 'Reservation outside staff scope' using errcode='42501'; end if;
  if r.status='confirmed' then raise exception 'Reservation already confirmed'; end if;
  select * into p from public.packages where id=p_package_id for update;
  if not found or p.status<>'ACTIVE' then raise exception 'Package not available' using errcode='22023'; end if;
  travelers:=greatest(coalesce(r.travelers,1),1);
  if coalesce(p.seats_available,0) < travelers then raise exception 'Package capacity exceeded' using errcode='40901'; end if;
  total_dzd:=coalesce(p.price_dzd,0)*travelers; total_sar:=coalesce(p.price_sar,0)*travelers;
  if p_payment_amount_dzd<0 or p_payment_amount_sar<0 or p_payment_amount_dzd>total_dzd or p_payment_amount_sar>total_sar then raise exception 'Invalid payment amount' using errcode='22023'; end if;
  insert into public.pilgrims(agency_id,branch_id,full_name,full_name_ar,passport_number,phone,email,group_id,package_id,payment_status,visa_status,status)
  values(r.agency_id,r.branch_id,r.name,r.name,nullif(trim(p_passport_number),''),r.phone,nullif(trim(r.email),''),p_group_id,p.id,case when p_payment_amount_dzd>0 or p_payment_amount_sar>0 then 'PARTIAL' else 'NONE' end,'NOT_STARTED','REGISTERED') returning id into pilgrim_id;
  insert into public.bookings(agency_id,branch_id,reference,pilgrim_id,package_id,group_id,status,travelers,total_dzd,total_sar,paid_dzd,paid_sar,payment_method,notes,confirmed_at)
  values(r.agency_id,r.branch_id,'BOOK-'||to_char(current_date,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),pilgrim_id,p.id,p_group_id,'CONFIRMED',travelers,total_dzd,total_sar,p_payment_amount_dzd,p_payment_amount_sar,p_payment_method,p_notes,now()) returning id into booking_id;
  if p_payment_amount_dzd>0 or p_payment_amount_sar>0 then
    insert into public.payments(agency_id,branch_id,booking_id,pilgrim_id,amount_dzd,amount_sar,method,status,reference,notes)
    values(r.agency_id,r.branch_id,booking_id,pilgrim_id,p_payment_amount_dzd,p_payment_amount_sar,p_payment_method,'CONFIRMED','PAY-'||to_char(current_date,'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),p_notes)
    returning id into payment_id;
    select private.post_payment_transaction_atomic(payment_id) into journal_id;
  end if;
  update public.packages set seats_available=seats_available-travelers,updated_at=now() where id=p.id and seats_available>=travelers;
  if not found then raise exception 'Package capacity changed; retry transaction' using errcode='40001'; end if;
  update public.reservations set status='confirmed',updated_at=now() where id=r.id;
  return jsonb_build_object('booking_id',booking_id,'pilgrim_id',pilgrim_id,'payment_id',payment_id,'journal_entry_id',journal_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Strict reservation abuse controls: production requires Turnstile + idempotency.
-- -----------------------------------------------------------------------------
create table if not exists private.reservation_abuse_log (
  id bigserial primary key,
  ip_hash text not null,
  event_type text not null,
  created_at timestamptz not null default now()
);
revoke all on private.reservation_abuse_log from public,anon,authenticated;
create index if not exists idx_reservation_abuse_log_ip_created on private.reservation_abuse_log(ip_hash,created_at desc);

-- -----------------------------------------------------------------------------
-- Storage policy invariants: private bucket is canonical.
-- -----------------------------------------------------------------------------
insert into storage.buckets(id,name,public) values ('pilgrim-documents','pilgrim-documents',false)
on conflict (id) do update set public=false;

-- -----------------------------------------------------------------------------
-- Critical foreign keys where schema drift previously allowed orphans.
-- -----------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.bookings') is not null then
    alter table public.bookings drop constraint if exists fk_bookings_pilgrim;
    alter table public.bookings add constraint fk_bookings_pilgrim foreign key (pilgrim_id) references public.pilgrims(id) on delete restrict;
    alter table public.bookings drop constraint if exists fk_bookings_package;
    alter table public.bookings add constraint fk_bookings_package foreign key (package_id) references public.packages(id) on delete restrict;
  end if;
  if to_regclass('public.payments') is not null then
    alter table public.payments drop constraint if exists fk_payments_booking;
    alter table public.payments add constraint fk_payments_booking foreign key (booking_id) references public.bookings(id) on delete restrict;
    alter table public.payments drop constraint if exists fk_payments_pilgrim;
    alter table public.payments add constraint fk_payments_pilgrim foreign key (pilgrim_id) references public.pilgrims(id) on delete restrict;
  end if;
end $$;
drop policy if exists pilgrim_documents_delete on storage.objects;
create policy pilgrim_documents_delete on storage.objects for delete to authenticated using (
  bucket_id='pilgrim-documents' and public.has_permission('documents','delete')
  and (storage.foldername(name))[1]=public.staff_agency_id()::text
  and (public.staff_role()='ADMIN' or (storage.foldername(name))[2]=public.staff_branch_id()::text)
);
