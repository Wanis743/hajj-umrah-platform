-- =============================================================================
-- Tenant scope repair: return the package catalogue to its real agency.
--
-- 20260324000300 backfilled agency_id/branch_id across 26 tables with
--
--     update public.<t> set agency_id = $1, branch_id = $2
--      where agency_id is null or branch_id is null
--
-- an OR predicate paired with an unconditional two-column SET. A row correctly
-- filed under a real agency but missing only its branch_id still matched the
-- WHERE, and the SET then rewrote its agency_id to the DEFAULT bootstrap
-- tenant -- a tenant that by construction has no staff_profiles rows. Every
-- scope filter in the platform compares agency_id against the caller's staff
-- agency, so any row that landed there became invisible to every human user.
--
-- That statement is coalesce-guarded at source now, which stops the defect
-- recurring but does not undo what already landed. On this database it left
-- the entire package catalogue -- all eight rows, every one referenced by
-- bookings and pilgrims belonging to the real agency -- parked on the bootstrap
-- tenant while the bookings depending on them stayed behind: a cross-tenant
-- foreign key, and an empty Packages module for the only staff user.
--
-- The repair derives the destination from the dependents instead of naming a
-- uuid, so the file is correct on any database rather than just this one. A
-- package moves only when every booking and pilgrim pointing at it agrees on a
-- single agency, and only when it is currently sitting on the DEFAULT tenant --
-- so this can never shuffle a package between two real agencies. Packages with
-- no dependents, or with dependents split across tenants, are left exactly as
-- they are for a human to judge. Re-running finds nothing left to move.
--
-- Deliberately NOT repaired here: the invoices and payments still sitting on
-- the bootstrap tenant. Those are end-to-end test residue -- INV-E2E-*, the
-- P-MIN/P-CUR/P-SAR currency probes, and the four payments allocated to them --
-- and re-filing them would inject fictional receivables into a tenant that
-- today has none at all. Leaving them on a staff-less agency keeps them out of
-- every scope-filtered query. Deleting them is a separate, destructive call.
-- =============================================================================

do $$
declare
  v_moved integer := 0;
begin
  if to_regclass('public.packages') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.pilgrims') is null
     or to_regclass('public.agencies') is null then
    raise notice 'tenant_scope_repair: prerequisite tables absent, nothing to do';
    return;
  end if;

  with dependents as (
    select package_id, agency_id, branch_id
      from public.bookings
     where package_id is not null and agency_id is not null
    union all
    select package_id, agency_id, branch_id
      from public.pilgrims
     where package_id is not null and agency_id is not null
  ),
  resolved as (
    -- Postgres has no min(uuid) aggregate, so reduce through text. The HAVING
    -- clause guarantees a single distinct agency per group, so min() only ever
    -- picks that one value; the same holds for branch under its count = 1 guard.
    select d.package_id,
           min(d.agency_id::text)::uuid as agency_id,
           -- Only claim a branch when the dependents speak with one voice;
           -- otherwise leave whatever the package already carries.
           case when count(distinct d.branch_id) = 1
                then min(d.branch_id::text)::uuid end as branch_id
      from dependents d
     group by d.package_id
    having count(distinct d.agency_id) = 1
  )
  update public.packages p
     set agency_id = r.agency_id,
         branch_id = coalesce(r.branch_id, p.branch_id)
    from resolved r
   where p.id = r.package_id
     and p.agency_id is distinct from r.agency_id
     and p.agency_id in (select id from public.agencies where code = 'DEFAULT');

  get diagnostics v_moved = row_count;
  raise notice 'tenant_scope_repair: re-filed % package row(s)', v_moved;
end $$;

-- A gate that can actually fail: no package may remain on the bootstrap tenant
-- while the bookings that depend on it live in a different agency.
do $$
declare
  v_stranded integer;
begin
  if to_regclass('public.packages') is null or to_regclass('public.bookings') is null then
    return;
  end if;

  select count(*) into v_stranded
    from public.packages p
    join public.agencies a on a.id = p.agency_id and a.code = 'DEFAULT'
   where exists (
           select 1
             from public.bookings b
            where b.package_id = p.id
              and b.agency_id is not null
              and b.agency_id <> p.agency_id
         );

  if v_stranded > 0 then
    raise exception
      'tenant_scope_repair: % package(s) still stranded on the bootstrap tenant while their bookings live elsewhere',
      v_stranded
      using errcode = '23514';
  end if;
end $$;
