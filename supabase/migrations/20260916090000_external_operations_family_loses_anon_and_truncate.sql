-- =============================================================================
-- Take TRUNCATE away from the roles that reach this database over the wire.
--
-- -----------------------------------------------------------------------------
-- What is actually wrong
-- -----------------------------------------------------------------------------
-- 20260709003000_external_operations.sql creates three tables --
-- external_operations, external_operation_evidence, external_references --
-- enables RLS on all three, and writes four policies for each. Every one of
-- those twelve policies is `TO authenticated` and scoped by
-- row_in_staff_scope(). That part is correct and stays untouched.
--
-- What that migration never does is issue a single GRANT or REVOKE. So the
-- privileges on all three tables are whatever the schema default handed out,
-- and in a Supabase project the default on a new table in public is ALL to
-- anon and ALL to authenticated. Nobody chose that; it is simply what is left
-- when a migration declines to say anything about grants.
--
-- For almost every privilege this does not matter, because RLS catches it:
-- anon holds SELECT/INSERT/UPDATE/DELETE, and no policy on any of the three
-- tables names anon, so every row operation an anonymous caller attempts
-- matches nothing and returns nothing. The grant is inert.
--
-- TRUNCATE is the exception, and it is the whole finding. TRUNCATE is not a
-- row operation and row level security does not apply to it. A caller holding
-- TRUNCATE empties the table regardless of how carefully its policies are
-- written. The anon key ships inside the client bundle, so the one privilege
-- RLS cannot defend is the one privilege an anonymous caller genuinely has.
--
-- external_operation_evidence holds the storage paths and verification state
-- of uploaded evidence; external_references holds visa numbers, airline PNRs,
-- hotel confirmations and insurance policy numbers. These are not caches. They
-- are not reconstructible from anywhere else in the system.
--
-- This is why the advisor does not report it: rls_disabled_in_public asks
-- whether RLS is enabled, and on all three tables it is. The rule is satisfied
-- and the table is still wipeable.
--
-- -----------------------------------------------------------------------------
-- Why authenticated loses TRUNCATE too
-- -----------------------------------------------------------------------------
-- Revoking anon alone would close the anonymous path and leave a quieter one
-- open. The policies scope every row a staff member can see to their own
-- agency, which is the entire point of row_in_staff_scope(); TRUNCATE ignores
-- that scoping exactly as it ignores anon's. One signed-in staff member of one
-- agency can therefore destroy every other agency's operational history. That
-- is a cross-tenant action reachable by a legitimate login, which makes it
-- worse than the anonymous case, not better.
--
-- Nothing in the application truncates these tables. Deletion happens through
-- delete_external_operation(), which is a SECURITY DEFINER routine and does
-- not need the caller to hold anything. ExternalOperationsCenter.tsx reads the
-- base table directly through PostgREST, so authenticated keeps SELECT,
-- INSERT, UPDATE and DELETE -- all four of which RLS does police. Only the
-- privilege RLS cannot police is withdrawn.
--
-- -----------------------------------------------------------------------------
-- What this migration does not claim
-- -----------------------------------------------------------------------------
-- The default-grant mechanism described above applies to every table any
-- migration in this repository created without saying anything about grants,
-- which is most of them. This file fixes the three tables whose exposure was
-- actually examined. It is not a sweep, and the next person to look should
-- assume other tables carry the same inherited TRUNCATE until they have
-- checked.
-- =============================================================================

-- anon has no policy on any of these tables, so it can already read and write
-- nothing. Removing the grants removes the one privilege that outranked RLS,
-- and leaves nothing behind that RLS was silently compensating for.
revoke all on public.external_operations        from public, anon;
revoke all on public.external_operation_evidence from public, anon;
revoke all on public.external_references        from public, anon;

-- authenticated keeps everything the application uses and everything RLS can
-- actually judge. TRUNCATE is neither.
revoke truncate on public.external_operations        from authenticated;
revoke truncate on public.external_operation_evidence from authenticated;
revoke truncate on public.external_references        from authenticated;

-- -----------------------------------------------------------------------------
-- A gate that can actually fail.
-- -----------------------------------------------------------------------------
do $$
declare
  v_problem text;
  v_tables  text[] := array[
    'external_operations',
    'external_operation_evidence',
    'external_references'
  ];
begin
  select string_agg(msg, '; ' order by msg) into v_problem from (
    -- nothing anon-reachable on any of the three
    select 'anon or PUBLIC still granted ' || tp.privilege_type
           || ' on ' || tp.table_name as msg
      from information_schema.table_privileges tp
     where tp.table_schema = 'public'
       and tp.grantee in ('anon', 'public')
       and tp.table_name = any (v_tables)
    union all
    -- and no wire-reachable role may hold the privilege RLS cannot see
    select 'authenticated still holds TRUNCATE on ' || tp.table_name
      from information_schema.table_privileges tp
     where tp.table_schema = 'public'
       and tp.grantee = 'authenticated'
       and tp.privilege_type = 'TRUNCATE'
       and tp.table_name = any (v_tables)
    union all
    -- the reads this migration deliberately preserved must still be there;
    -- a revoke that overshoots would blank ExternalOperationsCenter instead
    select 'authenticated lost SELECT on ' || t.name
      from unnest(v_tables) as t(name)
     where not exists (
       select 1 from information_schema.table_privileges tp
        where tp.table_schema = 'public'
          and tp.grantee = 'authenticated'
          and tp.privilege_type = 'SELECT'
          and tp.table_name = t.name
     )
    union all
    -- RLS is what now carries the whole load, so prove it is still standing
    select 'RLS off on ' || t.name
      from unnest(v_tables) as t(name)
     where not exists (
       select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t.name and c.relrowsecurity
     )
    union all
    select 'no policy on ' || t.name
      from unnest(v_tables) as t(name)
     where not exists (
       select 1 from pg_policies
        where schemaname = 'public' and tablename = t.name
     )
  ) problems;

  if v_problem is not null then
    raise exception 'external_operations_family_loses_anon_and_truncate: %', v_problem
      using errcode = '42501';
  end if;
end $$;
