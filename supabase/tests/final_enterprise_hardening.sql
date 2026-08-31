-- Runtime database tests. Execute against a fresh/staging database with test identities.
\set ON_ERROR_STOP on
DO $$ begin
  if not exists (select 1 from pg_class where oid='public.admin_bootstrap'::regclass and relrowsecurity) then raise exception 'admin_bootstrap RLS missing'; end if;
  if not exists (select 1 from pg_class where oid='public.payment_method_accounts'::regclass and relrowsecurity) then raise exception 'payment_method_accounts RLS missing'; end if;
  if not exists (select 1 from pg_class where oid='public.audit_logs'::regclass and relrowsecurity) then raise exception 'audit_logs RLS missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='audit_logs' and column_name='correlation_id') then raise exception 'audit correlation_id missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='audit_logs' and column_name='retention_until') then raise exception 'audit retention missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='documents' and column_name='checksum_sha256') then raise exception 'document checksum missing'; end if;
end $$;

DO $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='record_payment_transaction') then raise exception 'private atomic payment writer missing'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='confirm_reservation_transaction') then raise exception 'private atomic confirmation writer missing'; end if;
end $$;

-- The staff-scope helpers, asserted at runtime because their absence is the one
-- defect class that a live database hides perfectly: current_staff_agency_id() and
-- current_staff_branch_id() were named by 147 sites in supabase/migrations and
-- created by none of them, and nothing looked wrong because the production database
-- carried both from a hand-typed session. scripts/verify-migrations.mjs now fails
-- statically on a DDL reference no earlier migration satisfies; this block is the
-- other half, and answers the question the static gate cannot -- whether the
-- database actually in front of us has them, with the security properties the
-- ledger says they have.
DO $$
declare
  v_name text;
  v_oid oid;
begin
  foreach v_name in array array[
    'current_staff_agency_id','current_staff_branch_id','staff_agency_id','staff_branch_id'
  ] loop
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name and p.pronargs = 0;
    if v_oid is null then
      raise exception 'staff-scope helper public.%() is missing', v_name;
    end if;
    if not (select prosecdef from pg_proc where oid = v_oid) then
      raise exception 'staff-scope helper public.%() is not SECURITY DEFINER', v_name;
    end if;
    if not exists (select 1 from pg_proc where oid = v_oid
                    and proconfig is not null
                    and exists (select 1 from unnest(proconfig) c where c like 'search\_path=%')) then
      raise exception 'staff-scope helper public.%() has no pinned search_path', v_name;
    end if;
    if has_function_privilege('anon', v_oid, 'execute') then
      raise exception 'staff-scope helper public.%() is executable by anon', v_name;
    end if;
    if has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception 'staff-scope helper public.%() is executable by authenticated', v_name;
    end if;
  end loop;
end $$;

select 'final enterprise hardening metadata checks passed' as status;
