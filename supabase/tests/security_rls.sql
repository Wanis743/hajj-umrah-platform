-- Release security assertions. Run as a privileged CI role against a fresh database.

-- Public reservations are Edge-only: no direct PostgREST table access and no RPC bypass.
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
       has_function_privilege('authenticated','public.create_reservation_request(jsonb)','EXECUTE') = false as pass;

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
