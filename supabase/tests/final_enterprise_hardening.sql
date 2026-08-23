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

select 'final enterprise hardening metadata checks passed' as status;
