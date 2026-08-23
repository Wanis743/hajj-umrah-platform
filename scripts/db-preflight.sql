-- Production security/finance preflight checks.
-- Run with an authenticated admin DB role; these checks are read-only.
select 'unscoped_bookings' as check_name, count(*)::bigint as violations from public.bookings where agency_id is null or branch_id is null
union all select 'unscoped_pilgrims', count(*) from public.pilgrims where agency_id is null or branch_id is null
union all select 'unscoped_payments', count(*) from public.payments where agency_id is null or branch_id is null
union all select 'unscoped_documents', count(*) from public.documents where agency_id is null or branch_id is null
union all select 'unscoped_reservations', count(*) from public.reservations where agency_id is null or branch_id is null
union all select 'unscoped_invoices', count(*) from public.invoices where agency_id is null or branch_id is null
union all select 'unscoped_audit_logs', count(*) from public.audit_logs where agency_id is null or branch_id is null;

select tablename, policyname, roles, cmd from pg_policies where schemaname='public' and tablename in ('payments','bookings','pilgrims','documents','audit_logs','reservations','invoices') and (roles @> array['public']::name[] or roles @> array['anon']::name[]);
