-- =============================================================================
-- Close the anon hole on the two orphaned accounting tables.
--
-- 20260822000010_accounting_vertical.sql was an early accounting slice written
-- before the platform had a tenancy model. It ran five CREATE TABLE IF NOT
-- EXISTS statements; three of them (invoices, payments, journal_lines) were
-- silent no-ops against tables that already existed, because the IF NOT EXISTS
-- guard checks the name and never the shape. The only two objects it genuinely
-- created were public.journals and public.reconciliations -- and it created them
-- with no row level security, no revoke, and no agency_id/branch_id at all.
--
-- The real double-entry core that superseded that slice is journal_entries +
-- journal_lines + bank_reconciliations. Those three carry RLS, real policies,
-- and no anon grants. These two were left behind, and left open:
--
--   journals         RLS off, 0 policies, anon holds SELECT/INSERT/UPDATE/
--   reconciliations  DELETE/TRUNCATE on both
--
-- The anon key ships inside the client bundle, so as it stands anyone holding a
-- copy of the app can write to or truncate these tables over PostgREST.
--
-- Enabling RLS with no policies is normally a way to break an application --
-- a table with RLS on and no policy denies every row to every non-owner role.
-- It is safe here, and only here, because these two tables are orphaned. That
-- was verified against the live catalog rather than assumed from source:
--
--   rows in each table ............................. 0
--   TypeScript queries naming either table ......... none (4 UI strings only)
--   functions in public/private referencing them ... none
--   foreign keys referencing them .................. none
--   views referencing them ......................... none
--   policies authored in any migration ............. none
--
-- There is no read path to break. service_role carries BYPASSRLS and postgres
-- owns the tables, so any future SECURITY DEFINER routine still reaches them;
-- what disappears is the direct anonymous one.
--
-- Deliberately no policies: a scope policy compares agency_id against the
-- caller's staff agency, and neither table has an agency_id to compare. Adding
-- the columns would mean building out a vertical the platform has already
-- replaced. If these tables are ever revived, add the tenant columns first and
-- model the policies on journal_entries.
-- =============================================================================

do $$
declare
  v_tbl text;
begin
  foreach v_tbl in array array['journals', 'reconciliations']
  loop
    if to_regclass('public.' || v_tbl) is null then
      raise notice 'lock_orphaned_accounting_tables: public.% absent, skipping', v_tbl;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', v_tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', v_tbl);
  end loop;
end $$;

-- A gate that can actually fail: both tables must end this migration with RLS
-- on, zero policies, and nothing granted to the two PostgREST client roles.
do $$
declare
  v_open text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_open
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname in ('journals', 'reconciliations')
     and (
       not c.relrowsecurity
       or exists (
            select 1
              from information_schema.table_privileges tp
             where tp.table_schema = 'public'
               and tp.table_name = c.relname
               and tp.grantee in ('anon', 'authenticated')
          )
     );

  if v_open is not null then
    raise exception
      'lock_orphaned_accounting_tables: % still reachable by anon/authenticated or missing RLS',
      v_open
      using errcode = '42501';
  end if;
end $$;
