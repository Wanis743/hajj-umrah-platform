-- Release security assertions. Run as a privileged CI role against a fresh database.

-- Public reservations are Edge-only: no direct PostgREST table access and no RPC bypass.
--
-- "Public" is the operative word: two intake paths exist and only one of them is anon's.
--   visitor -> supabase.functions.invoke('create-reservation')   src/lib/publicReservation.ts:40
--              runs as service_role behind an origin allowlist, Turnstile, an IP rate limit
--              and an idempotency key, and never touches the RPC below.
--   staff   -> supabase.rpc('create_reservation_request')        NewReservationModal.tsx:71
--              guarded by the function's own is_staff() 42501, and deriving agency_id and
--              branch_id from the caller's staff profile -- which the Edge path, having no
--              staff identity to read, cannot do at all.
--
-- 20260417203300 revoked EXECUTE from public, anon and authenticated in a single statement.
-- Only the anon half follows from "public intake is Edge-only"; the authenticated half left
-- the staff modal returning 42501 on every submit. 20260916140000 granted it back, so the
-- authenticated assertion below now guards the staff path rather than echoing the anon one.
select 'anon_reservations_select' as check_name,
       has_table_privilege('anon','public.reservations','select') = false as pass;
select 'anon_reservations_insert' as check_name,
       has_table_privilege('anon','public.reservations','insert') = false as pass;
select 'anon_reservations_update' as check_name,
       has_table_privilege('anon','public.reservations','update') = false as pass;
select 'anon_reservations_delete' as check_name,
       has_table_privilege('anon','public.reservations','delete') = false as pass;
select 'anon_create_reservation_rpc' as check_name,
       has_function_privilege('anon','public.create_reservation_request(jsonb)','EXECUTE') = false as pass;
select 'authenticated_create_reservation_rpc' as check_name,
       has_function_privilege('authenticated','public.create_reservation_request(jsonb)','EXECUTE') = true as pass;

-- Audit log is immutable to client roles.
select 'anon_audit_update' as check_name,
       has_table_privilege('anon','public.audit_logs','update') = false as pass;
select 'anon_audit_delete' as check_name,
       has_table_privilege('anon','public.audit_logs','delete') = false as pass;
select 'auth_audit_update' as check_name,
       has_table_privilege('authenticated','public.audit_logs','update') = false as pass;
select 'auth_audit_delete' as check_name,
       has_table_privilege('authenticated','public.audit_logs','delete') = false as pass;
select 'auth_audit_truncate' as check_name,
       has_table_privilege('authenticated','public.audit_logs','truncate') = false as pass;

-- staff_permissions is internal-only; has_permission is the only client-facing permission primitive.
select 'anon_staff_permissions_select' as check_name,
       has_table_privilege('anon','public.staff_permissions','select') = false as pass;
select 'auth_staff_permissions_select' as check_name,
       has_table_privilege('authenticated','public.staff_permissions','select') = false as pass;
select 'auth_staff_permissions_insert' as check_name,
       has_table_privilege('authenticated','public.staff_permissions','insert') = false as pass;
select 'auth_staff_permissions_update' as check_name,
       has_table_privilege('authenticated','public.staff_permissions','update') = false as pass;
select 'auth_staff_permissions_delete' as check_name,
       has_table_privilege('authenticated','public.staff_permissions','delete') = false as pass;
select 'staff_permissions_rls_enabled' as check_name,
       c.relrowsecurity = true as pass
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='staff_permissions';
select 'staff_permissions_rls_has_deny_policy' as check_name,
       exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename='staff_permissions') as pass;
select 'anon_has_permission_execute' as check_name,
       has_function_privilege('anon','public.has_permission(text,text)','EXECUTE') = false as pass;
select 'auth_has_permission_execute' as check_name,
       has_function_privilege('authenticated','public.has_permission(text,text)','EXECUTE') = true as pass;

-- has_permission is not alone. A policy's USING expression is evaluated with the
-- privileges of the role running the query, so every helper a policy names must be
-- executable by that role or row security fails 42501 instead of filtering. Only
-- has_permission was asserted here, which is how 20260830140000 revoked the other
-- five from authenticated and broke 48 tables without turning this file red.
-- Restored by 20260918100000. All six are SECURITY DEFINER over auth.uid(), so
-- authenticated learns only about itself -- and anon still gets nothing.
select 'auth_row_in_staff_scope_execute' as check_name,
       has_function_privilege('authenticated','public.row_in_staff_scope(uuid,uuid)','EXECUTE') = true as pass;
select 'auth_staff_role_execute' as check_name,
       has_function_privilege('authenticated','public.staff_role()','EXECUTE') = true as pass;
select 'auth_current_staff_agency_id_execute' as check_name,
       has_function_privilege('authenticated','public.current_staff_agency_id()','EXECUTE') = true as pass;
select 'auth_current_staff_branch_id_execute' as check_name,
       has_function_privilege('authenticated','public.current_staff_branch_id()','EXECUTE') = true as pass;
select 'anon_row_in_staff_scope_execute' as check_name,
       has_function_privilege('anon','public.row_in_staff_scope(uuid,uuid)','EXECUTE') = false as pass;
select 'anon_staff_role_execute' as check_name,
       has_function_privilege('anon','public.staff_role()','EXECUTE') = false as pass;
select 'anon_current_staff_agency_id_execute' as check_name,
       has_function_privilege('anon','public.current_staff_agency_id()','EXECUTE') = false as pass;
select 'anon_current_staff_branch_id_execute' as check_name,
       has_function_privilege('anon','public.current_staff_branch_id()','EXECUTE') = false as pass;

-- The invariant the six assertions above are a proxy for: no policy may name a
-- function the role bound to that policy cannot execute. This catches the next
-- helper as well as these six.
select 'no_policy_calls_an_unexecutable_function' as check_name,
       not exists (
         select 1
           from pg_policies p
           join pg_class c on c.relname = p.tablename
           join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
          -- The '.' is deliberately NOT in the exclusion class. pg_policies renders
          -- public-schema quals unqualified, but anything rendered as
          -- public.has_permission( would be skipped by a class containing '.',
          -- and a check that silently stops looking is worse than no check.
          cross join lateral regexp_matches(
            coalesce(p.qual::text,'') || ' ' || coalesce(p.with_check::text,''),
            '(?:^|[^a-z0-9_])([a-z_][a-z0-9_]*)\s*\(', 'g') m
           join pg_proc fn on fn.proname = m[1]
           join pg_namespace fns on fns.oid = fn.pronamespace and fns.nspname = 'public'
          where p.schemaname = 'public'
            and 'authenticated' = any(p.roles)
            and has_table_privilege('authenticated', c.oid, 'SELECT')
            and not has_function_privilege('authenticated', fn.oid, 'EXECUTE')
       ) as pass;

-- Permission matrix invariants for the highest-risk resources.
with matrix(role,resource,action,allowed) as (
  values
    ('ADMIN','journal_entries','read',true),('ADMIN','journal_entries','create',true),('ADMIN','bank_accounts','read',true),
    ('OPERATIONS_MANAGER','journal_entries','read',false),('OPERATIONS_MANAGER','bank_accounts','read',false),('OPERATIONS_MANAGER','manifest_snapshots','read',true),
    ('FINANCE','journal_entries','read',true),('FINANCE','journal_entries','create',true),('FINANCE','journal_lines','read',true),('FINANCE','bank_accounts','read',true),('FINANCE','supplier_bills','write',true),
    ('VISA_AGENT','chart_of_accounts','read',false),('VISA_AGENT','bank_accounts','read',false),('VISA_AGENT','journal_entries','read',false),('VISA_AGENT','visas','read',true),
    ('GUIDE','journal_entries','read',false),('GUIDE','bank_accounts','read',false),('GUIDE','supplier_bills','read',false),('GUIDE','manifest_snapshots','read',true),
    ('CRM','journal_entries','read',false),('CRM','bank_accounts','read',false),('CRM','crm_leads','read',true),
    ('AGENT','journal_entries','read',false),('AGENT','fiscal_periods','read',false),('AGENT','bookings','read',true)
), actual as (
  select m.*, exists(
    select 1 from public.staff_permissions sp
    where sp.role=m.role and sp.resource=m.resource and sp.action=m.action
  ) as configured
  from matrix m
)
select 'rbac_'||lower(replace(role,' ','_'))||'_'||resource||'_'||action as check_name,
       (configured = allowed) as pass
from actual
order by role,resource,action;

-- Branch/agency isolation policies must exist on critical business tables.
with required(table_name) as (
  values ('pilgrims'),('bookings'),('payments'),('documents'),('groups'),('visas'),('flights'),
         ('hotels'),('room_allocations'),('transport_assignments'),('incidents'),('sos_events'),('invoices')
), checks as (
  select r.table_name,
         exists(
           select 1 from pg_policies p
           where p.schemaname='public' and p.tablename=r.table_name
             and (p.qual::text ilike '%row_in_staff_scope%' or p.with_check::text ilike '%row_in_staff_scope%')
         ) as scoped
  from required r
)
select 'branch_scope_'||table_name as check_name, scoped as pass from checks order by table_name;
