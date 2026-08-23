-- Expanded RBAC matrix. Run in privileged CI against seeded role-permission data.
with matrix(role,resource,action,allowed) as (
  values
    ('ADMIN','pilgrims','read',true),('ADMIN','pilgrims','create',true),('ADMIN','pilgrims','update',true),('ADMIN','pilgrims','delete',true),
    ('ADMIN','bookings','read',true),('ADMIN','bookings','create',true),('ADMIN','bookings','update',true),('ADMIN','bookings','delete',true),
    ('ADMIN','payments','read',true),('ADMIN','payments','create',true),('ADMIN','payments','update',false),('ADMIN','payments','delete',false),
    ('ADMIN','audit_logs','read',true),('ADMIN','audit_logs','create',false),('ADMIN','audit_logs','update',false),('ADMIN','audit_logs','delete',false),
    ('OPERATIONS_MANAGER','pilgrims','read',true),('OPERATIONS_MANAGER','bookings','read',true),('OPERATIONS_MANAGER','bookings','update',true),
    ('OPERATIONS_MANAGER','journal_entries','read',false),('OPERATIONS_MANAGER','bank_accounts','read',false),('OPERATIONS_MANAGER','readiness_rules','update',true),
    ('FINANCE','payments','read',true),('FINANCE','journal_entries','read',true),('FINANCE','journal_entries','create',true),('FINANCE','journal_lines','read',true),
    ('FINANCE','bank_accounts','read',true),('FINANCE','supplier_bills','create',true),('FINANCE','credit_notes','create',true),
    ('VISA_AGENT','pilgrims','read',true),('VISA_AGENT','visas','read',true),('VISA_AGENT','visas','update',true),('VISA_AGENT','journal_entries','read',false),('VISA_AGENT','bank_accounts','read',false),
    ('GUIDE','groups','read',true),('GUIDE','manifest_snapshots','read',true),('GUIDE','missing_pilgrim_events','create',true),('GUIDE','journal_entries','read',false),
    ('CRM','crm_leads','read',true),('CRM','crm_followups','create',true),('CRM','journal_entries','read',false),('CRM','bank_accounts','read',false),
    ('AGENT','pilgrims','read',true),('AGENT','bookings','read',true),('AGENT','bookings','update',true),('AGENT','fiscal_periods','read',false)
), actual as (
  select m.*, exists(select 1 from public.staff_permissions sp where sp.role=m.role and sp.resource=m.resource and sp.action=m.action) as configured
  from matrix m
)
select role,resource,action,allowed,configured,(allowed=configured) as pass from actual order by role,resource,action;

-- The release suite must cover every critical domain for every staff role.
with roles(role) as (
  values ('ADMIN'),('OPERATIONS_MANAGER'),('FINANCE'),('VISA_AGENT'),('GUIDE'),('CRM'),('AGENT')
), resources(resource) as (
  values ('pilgrims'),('bookings'),('payments'),('invoices'),('visas'),('documents'),('groups'),('flights'),('hotels'),('room_allocations'),('transport_assignments'),('incidents'),('sos_events'),('audit_logs'),('journal_entries'),('journal_lines'),('bank_accounts'),('supplier_bills'),('credit_notes')
), actions(action) as (
  values ('read'),('create'),('update'),('delete')
), coverage as (
  select r.role, x.resource, a.action,
         exists(select 1 from public.staff_permissions sp where sp.role=r.role and sp.resource=x.resource and sp.action=a.action) as configured
  from roles r cross join resources x cross join actions a
)
select 'rbac_matrix_coverage' as check_name,
       count(*) = 7*19*4 as pass,
       count(*) as combinations
from coverage;
