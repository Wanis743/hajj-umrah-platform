-- Full authorization coverage assertions for exposed roles.
-- This validates permission configuration, object grants, RLS presence and critical invariants.

with roles(role) as (
  values ('ADMIN'),('OPERATIONS_MANAGER'),('FINANCE'),('VISA_AGENT'),('GUIDE'),('CRM'),('AGENT')
), resources(resource) as (
  values ('pilgrims'),('bookings'),('payments'),('invoices'),('visas'),('documents'),('groups'),('flights'),
         ('hotels'),('room_allocations'),('transport_assignments'),('journal_entries'),('journal_lines'),
         ('bank_accounts'),('supplier_bills'),('credit_notes'),('audit_logs'),('incidents'),('sos_events')
), actions(action) as (values ('read'),('create'),('update'),('delete'))
select count(*) as matrix_cells,
       count(*) filter (where not exists (
         select 1 from public.staff_permissions sp
         where sp.role = r.role and sp.resource = res.resource and sp.action = a.action
       ) and r.role <> 'ADMIN') as implicit_denies_for_non_admin
from roles r cross join resources res cross join actions a;

-- Every critical public table must have RLS enabled.
with required(tablename) as (
  values ('pilgrims'),('bookings'),('payments'),('invoices'),('visas'),('documents'),('groups'),('flights'),
         ('hotels'),('room_allocations'),('transport_assignments'),('journal_entries'),('journal_lines'),
         ('bank_accounts'),('supplier_bills'),('credit_notes'),('audit_logs'),('incidents'),('sos_events'),('staff_permissions')
)
select r.tablename, coalesce(c.relrowsecurity,false) as rls_enabled
from required r
left join pg_class c on c.relname=r.tablename
left join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
order by r.tablename;

-- Client roles must not have direct staff_permissions access.
select
  has_table_privilege('anon','public.staff_permissions','select') = false as anon_select_denied,
  has_table_privilege('authenticated','public.staff_permissions','select') = false as auth_select_denied,
  has_table_privilege('authenticated','public.staff_permissions','insert') = false as auth_insert_denied,
  has_table_privilege('authenticated','public.staff_permissions','update') = false as auth_update_denied,
  has_table_privilege('authenticated','public.staff_permissions','delete') = false as auth_delete_denied;

-- Audit is append-only from client roles.
select
  has_table_privilege('anon','public.audit_logs','update') = false as anon_update_denied,
  has_table_privilege('anon','public.audit_logs','delete') = false as anon_delete_denied,
  has_table_privilege('authenticated','public.audit_logs','update') = false as auth_update_denied,
  has_table_privilege('authenticated','public.audit_logs','delete') = false as auth_delete_denied,
  has_table_privilege('authenticated','public.audit_logs','truncate') = false as auth_truncate_denied;
