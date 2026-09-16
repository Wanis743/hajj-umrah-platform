-- =============================================================================
-- Close the two remaining security ERRORs the Supabase advisor reports, and
-- close a leak the advisor does not report at all.
--
-- -----------------------------------------------------------------------------
-- A. public.kpi_contract_registry -- rls_disabled_in_public (ERROR)
-- -----------------------------------------------------------------------------
-- Created by 20260625223000_enterprise_release_hardening.sql, which enables RLS
-- and revokes anon for its two sibling tables (notification_delivery_attempts,
-- observability_events) on the very lines above it, and does neither for this
-- one. The omission is visible in the source; nothing about the table asked to
-- be different.
--
-- It holds six rows declaring which function is authoritative for each KPI --
-- Revenue, Collections, NetProfit, Outstanding, VisaClearanceRate,
-- GroupReadiness. anon holds SELECT/INSERT/UPDATE/DELETE/TRUNCATE on it, and
-- the anon key ships inside the client bundle. Anyone with a copy of the app
-- could rewrite the definition of what "Revenue" means, or truncate the
-- registry outright. It is reference data about the numbers the business
-- reports; write access for the anonymous role is an integrity attack surface,
-- not a convenience.
--
-- Verified before choosing the policy: no TypeScript file names this table, no
-- function in public or private references it, no view selects from it. It has
-- six rows and no agency_id, because it is global reference data rather than
-- tenant data. So the shape is a read policy for signed-in staff and nothing
-- else -- there is no tenant column to compare, and inventing one would be
-- inventing a requirement.
--
-- -----------------------------------------------------------------------------
-- B. public.group_operations_summary, public.expiring_documents
--    -- security_definer_view (ERROR)
-- -----------------------------------------------------------------------------
-- Both views have reloptions = null, so neither carries security_invoker=true,
-- so both execute with their owner's privileges (postgres) and bypass the row
-- level security of every table they read. Both grant SELECT to anon.
--
-- That combination is worse than the lint's name suggests. group_operations_
-- summary aggregates groups + pilgrims + external_operations + room_allocations
-- + transport_assignments; expiring_documents joins documents + pilgrims and
-- exposes full_name, passport type and number, and expiry_date. Every one of
-- those base tables has RLS on with a staff_select policy, and the views walk
-- straight past all of it. Anyone holding the bundled anon key can read every
-- group and every expiring passport of every agency on the platform.
--
-- Today that is 2 groups belonging to 1 agency and 0 documents, so nothing has
-- leaked yet. The hole opens on the day a second agency is onboarded, which is
-- the argument for closing it now rather than later.
--
-- The advisor's suggested remedy -- set security_invoker = true -- is wrong
-- here, and that was tested rather than assumed. Under security_invoker the
-- base tables are read with the caller's privileges, and the caller has none:
--
--   set local role authenticated;
--   select count(*) from public.groups;
--   ERROR: 42501 permission denied for table groups
--
-- authenticated holds no grant on groups, pilgrims, documents,
-- room_allocations or transport_assignments -- only postgres and service_role
-- do. That is deliberate: this platform's clients reach data through SECURITY
-- DEFINER routines, not through direct PostgREST reads, so the staff_select
-- policies on those tables are never even reached over the wire. Flipping
-- security_invoker would not tighten these views, it would break them, and
-- GroupOperationsCenter.tsx reads group_operations_summary with a bare
-- .select('*') and no agency filter of its own.
--
-- So the views stay SECURITY DEFINER -- that is what lets them read the base
-- tables at all -- and instead each one carries the base tables' own policy
-- predicate inside its body. The definer context supplies the privilege; the
-- predicate supplies the scope. auth.uid() still resolves to the caller under
-- SECURITY DEFINER, because a definer function changes the privilege context
-- and not the request's JWT, so row_in_staff_scope() judges whoever is asking.
--
-- The predicates are copied from the base tables rather than invented, so each
-- view now returns exactly the rows a direct read would have returned if a
-- direct read were permitted:
--
--   groups.staff_select     has_permission('groups','read')
--                             and row_in_staff_scope(agency_id, branch_id)
--   documents.staff_select  has_permission('documents','read')    (+ pilgrims)
--                             and row_in_staff_scope(agency_id, branch_id)
--
-- expiring_documents joins two policed tables, so it carries both predicates:
-- that is what RLS would apply to the same join.
--
-- Verified against the live database under a real JWT before writing this:
--
--   as the real admin staff member  ->  2 of 2 groups match  (no change)
--   with no JWT at all              ->  0 groups match       (hole closed)
--
-- Note for whoever reads the next advisor report: these two views will STILL be
-- listed under security_definer_view after this migration. That lint tests for
-- the reloptions flag, and the flag is deliberately not set, for the reason
-- proven above. The leak is closed; the lint is not silenced. Silencing it
-- would mean breaking the application to satisfy a string comparison.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. kpi_contract_registry
-- -----------------------------------------------------------------------------

alter table public.kpi_contract_registry enable row level security;

revoke all on public.kpi_contract_registry from public, anon, authenticated;
grant select on public.kpi_contract_registry to authenticated;

-- `create policy` has no IF NOT EXISTS form; drop first so this file replays.
drop policy if exists kpi_contract_registry_staff_read on public.kpi_contract_registry;
create policy kpi_contract_registry_staff_read on public.kpi_contract_registry
for select to authenticated
using (true);

-- -----------------------------------------------------------------------------
-- B. the two definer views
-- -----------------------------------------------------------------------------
-- create or replace keeps the column list, the grants and the dependents; the
-- only change in each body is the closing predicate.

create or replace view public.group_operations_summary as
  select g.id as group_id,
         g.code,
         g.status as group_status,
         g.departure_date,
         g.agency_id,
         count(distinct p.id) as total_members,
         count(distinct p.id) filter (where p.visa_status = any (array['APPROVED'::text, 'ISSUED'::text])) as visa_done,
         count(distinct p.id) filter (where p.payment_status = 'PAID'::text) as payment_done,
         count(distinct eo.id) filter (where eo.internal_status = 'COMPLETED'::text) as ext_ops_completed,
         count(distinct eo.id) as ext_ops_total,
         count(distinct ra.id) filter (where ra.status = any (array['CONFIRMED'::text, 'CHECKED_IN'::text])) as hotel_allocated,
         count(distinct ta.id) filter (where ta.status = any (array['ASSIGNED'::text, 'IN_TRANSIT'::text, 'ARRIVED'::text])) as transport_assigned,
         g.readiness_score,
         g.readiness_details
    from groups g
    left join pilgrims p on p.group_id = g.id
    left join external_operations eo on (eo.group_id = g.id or eo.pilgrim_id = p.id) and eo.agency_id = g.agency_id
    left join room_allocations ra on ra.group_id = g.id
    left join transport_assignments ta on ta.group_id = g.id
   where public.has_permission('groups', 'read')
     and public.row_in_staff_scope(g.agency_id, g.branch_id)
   group by g.id, g.code, g.status, g.departure_date, g.agency_id, g.readiness_score, g.readiness_details;

create or replace view public.expiring_documents as
  select d.id,
         d.pilgrim_id,
         d.type,
         d.number,
         d.expiry_date,
         d.status,
         p.full_name,
         p.full_name_ar,
         p.agency_id,
         p.group_id,
         d.expiry_date::date - current_date as days_remaining,
         case
           when d.expiry_date::date < current_date then 'EXPIRED'::text
           when d.expiry_date::date < (current_date + '30 days'::interval) then 'EXPIRING_SOON'::text
           when d.expiry_date::date < (current_date + '90 days'::interval) then 'EXPIRING'::text
           else 'VALID'::text
         end as expiry_status
    from documents d
    join pilgrims p on p.id = d.pilgrim_id
   where (d.status <> all (array['SUPERSEDED'::text, 'REJECTED'::text]))
     and d.expiry_date is not null
     and public.has_permission('documents', 'read')
     and public.row_in_staff_scope(d.agency_id, d.branch_id)
     and public.has_permission('pilgrims', 'read')
     and public.row_in_staff_scope(p.agency_id, p.branch_id);

-- Defence in depth. The predicates above already return nothing to a caller
-- with no staff profile, but there is no reason for the anonymous role to hold
-- a grant on either view, and no reason for signed-in staff to hold anything
-- beyond SELECT on a read-only aggregate.
revoke all on public.group_operations_summary from public, anon, authenticated;
revoke all on public.expiring_documents        from public, anon, authenticated;
grant select on public.group_operations_summary to authenticated;
grant select on public.expiring_documents        to authenticated;

-- -----------------------------------------------------------------------------
-- A gate that can actually fail.
-- -----------------------------------------------------------------------------
do $$
declare
  v_problem text;
begin
  select string_agg(msg, '; ' order by msg) into v_problem from (
    -- the registry must end this migration with RLS on and a policy to match
    select 'kpi_contract_registry: RLS off' as msg
     where not exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'kpi_contract_registry'
          and c.relrowsecurity
     )
    union all
    select 'kpi_contract_registry: no policy'
     where not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = 'kpi_contract_registry'
     )
    -- nothing anon-reachable, on the registry or on either view
    union all
    select 'anon still granted on ' || tp.table_name
      from information_schema.table_privileges tp
     where tp.table_schema = 'public'
       and tp.grantee in ('anon', 'public')
       and tp.table_name in ('kpi_contract_registry', 'group_operations_summary', 'expiring_documents')
    -- authenticated must hold read only, never write, on all three
    union all
    select 'authenticated holds ' || tp.privilege_type || ' on ' || tp.table_name
      from information_schema.table_privileges tp
     where tp.table_schema = 'public'
       and tp.grantee = 'authenticated'
       and tp.privilege_type <> 'SELECT'
       and tp.table_name in ('kpi_contract_registry', 'group_operations_summary', 'expiring_documents')
    -- and both views must genuinely carry a scope predicate, not merely claim to
    union all
    select 'view ' || c.relname || ' carries no scope predicate'
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and c.relname in ('group_operations_summary', 'expiring_documents')
       and pg_get_viewdef(c.oid) not like '%row_in_staff_scope%'
  ) problems;

  if v_problem is not null then
    raise exception 'scope_definer_views_and_lock_kpi_registry: %', v_problem
      using errcode = '42501';
  end if;
end $$;
