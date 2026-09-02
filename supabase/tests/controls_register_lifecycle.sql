-- ============================================================================
-- Controls register: lifecycle and catalogue suite
--
-- 20260902130000_controls_register.sql finishes `public.financial_controls`,
-- which shipped in 20260822000016 as a primary key, an agency column, RLS and
-- nothing else -- no grant, no history, no write path, and no RPC anywhere in
-- `supabase/` that touched it. The new migration adds the columns that make a
-- row a control, a `financial_control_tests` history table, one guard and three
-- commands. None of that is checked by the migration itself. This suite drives
-- it.
--
-- WHAT THIS SUITE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
--
-- It runs inside scripts/fresh-db-replay.sh, where psql connects as the local
-- stack's superuser. A superuser bypasses row security entirely: every policy
-- on every table is skipped, so a query that returns a row here proves nothing
-- about whether a signed-in staff member could have seen it. Any assertion of
-- the form "the other agency's control is invisible" would therefore pass in
-- this harness whether the policy were right, wrong, or absent -- which is worse
-- than no test, because it reads like coverage. This file writes none.
--
-- What it asserts instead comes in two kinds a superuser cannot make wrong.
--
--   Part 1 asks the catalogue. `relrowsecurity` is a flag on pg_class: reading
--   it as superuser gives the same answer as reading it as anyone else, because
--   it is a fact about the table and not about the connection. The same holds
--   for the grants, the constraints, the foreign key's delete action, the
--   indexes, the triggers, the function signatures and the RBAC matrix rows.
--   Not one Part 1 check claims that a policy filtered a row.
--
--   Part 2 drives the three commands and asserts by SQLSTATE. Every refusal in
--   this migration is written in PL/pgSQL -- `if not public.has_permission(...)
--   then raise`, `if v_result = 'failed' and v_exc is null then raise` -- and a
--   superuser connection cannot soften an `if ... then raise`, because it is not
--   row security. That is also how the suite proves a permission is genuinely
--   required: it deletes FINANCE's seeded `update` grant inside the transaction
--   and watches the two commands that need it raise 42501 for a session whose
--   agency is provably in range.
--
-- Part 2 is one `begin ... rollback;`. It creates its own auth.users row and
-- staff_profiles row and sets `request.jwt.claims` transaction-locally, so
-- auth.uid() is a real uuid it chose rather than NULL, and the guard is
-- satisfied by an RBAC row rather than by the connection. Part 3 then proves the
-- rollback took: no suite control, no suite test row, no suite account, and the
-- seeded permission rows back where they started.
--
-- ONE THING THE SUITE CANNOT ASSERT, AND WHY IT DOES NOT PRETEND TO
--
-- Every row written in Part 2 gets `now()` for its timestamps, and `now()` is
-- the transaction timestamp -- identical for all of them. So `idx_control_tests_
-- control_at`'s `tested_at desc` ordering cannot be demonstrated inside one
-- transaction: two tests recorded a statement apart share a timestamp to the
-- microsecond. The suite asserts counts, membership and the register's derived
-- columns, and makes no positional claim about the history's order.
--
-- Nothing here writes to either table directly except one clearly labelled
-- place: step 2j's `delete from public.financial_controls`, which is there
-- because `delete` is seeded to no role at all and there is no retire-by-delete
-- command, so the cascade is the only way to show that removing a control takes
-- its evidence with it.
-- ============================================================================

-- PART 1 ---------------------------------------------------------------------
-- Catalogue verdicts. Each statement emits one row of check_name, pass, detail;
-- scripts/run-sql-gate.mjs reads the `pass` column and fails the gate on f or
-- on NULL, so every expression below is total: a missing object folds to false
-- through a count, never to NULL through a bool_and over an empty set.

-- 1a  Both tables exist and carry the RLS flag. A catalogue fact: this is
--     `relrowsecurity` on pg_class, not evidence that a policy filtered a row.
select 'controls_tables_exist_with_rls' as check_name,
       count(c.oid) = 2
   and count(*) filter (where c.relrowsecurity) = 2 as pass,
       string_agg(t.name || case
                    when c.oid is null then ' MISSING'
                    when not c.relrowsecurity then ' RLS-OFF'
                    else ' rls' end, ', ' order by t.name) as detail
  from (values ('financial_controls'), ('financial_control_tests')) as t(name)
  left join pg_class c on c.oid = to_regclass('public.' || t.name);

-- 1b  anon holds nothing on either. 14 = two tables by seven table privileges.
select 'controls_anon_holds_no_table_privilege' as check_name,
       count(*) = 14
   and count(*) filter (where has_table_privilege('anon', c.oid, p.priv)) = 0
       as pass,
       coalesce(string_agg(t.name || '.' || p.priv, ', ')
                filter (where has_table_privilege('anon', c.oid, p.priv)),
                'anon holds nothing') as detail
  from (values ('financial_controls'), ('financial_control_tests')) as t(name)
  join pg_class c on c.oid = to_regclass('public.' || t.name)
  cross join (values ('select'), ('insert'), ('update'), ('delete'),
                     ('truncate'), ('references'), ('trigger')) as p(priv);

-- 1c  The write path is the three commands, and this is the check that says so.
--     `authenticated` holds select on both tables and none of insert, update or
--     delete on either. A client holding UPDATE on financial_controls could move
--     `last_result` without writing a test row, which is the single thing the
--     whole design exists to prevent. 8 = two tables by four DML privileges.
select 'controls_authenticated_holds_select_only' as check_name,
       count(*) = 8
   and count(*) filter (where p.priv = 'select'
                          and has_table_privilege('authenticated', c.oid, p.priv)) = 2
   and count(*) filter (where p.priv <> 'select'
                          and has_table_privilege('authenticated', c.oid, p.priv)) = 0
       as pass,
       coalesce(string_agg(t.name || '.' || p.priv, ', '
                           order by t.name, p.priv)
                filter (where has_table_privilege('authenticated', c.oid, p.priv)),
                'authenticated holds NOTHING -- select was expected on both') as detail
  from (values ('financial_controls'), ('financial_control_tests')) as t(name)
  join pg_class c on c.oid = to_regclass('public.' || t.name)
  cross join (values ('select'), ('insert'), ('update'), ('delete')) as p(priv);

-- 1d  The unique constraint is per agency, and the global one is gone. Two
--     agencies both running a control called FC-01 is the normal case, and the
--     shipped `control_code TEXT NOT NULL UNIQUE` made the second one a
--     duplicate-key error naming a row RLS forbids the caller to see.
select 'controls_unique_is_per_agency' as check_name,
       count(*) filter (where cardinality(c.conkey) = 2
                          and 'agency_id' = any(k.names)
                          and 'control_code' = any(k.names)) = 1
   and count(*) filter (where cardinality(c.conkey) = 1
                          and 'control_code' = any(k.names)) = 0 as pass,
       coalesce(string_agg(c.conname || ' (' || array_to_string(k.names, '+') || ')',
                           ', ' order by c.conname),
                'no unique constraint at all') as detail
  from pg_constraint c
  cross join lateral (
    select array_agg(a.attname order by a.attnum) as names
      from pg_attribute a
     where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  ) as k
 where c.conrelid = to_regclass('public.financial_controls')
   and c.contype = 'u';

-- 1e  The four vocabularies exist and are validated. `not valid` then `validate`
--     is how the migration adds them without failing on a row that predates the
--     rule; on a fresh replay both tables are empty -- nothing in `supabase/`
--     seeds a control -- so validation must have succeeded, and a `convalidated`
--     of false here means a check was added and then quietly not enforced.
select 'controls_vocabularies_are_validated' as check_name,
       count(*) = 4
   and count(*) filter (where c.convalidated) = 4 as pass,
       coalesce(string_agg(t.name || '.' || t.con
                           || case when c.oid is null then ' MISSING'
                                   when not c.convalidated then ' NOT-VALIDATED'
                                   else ' ok' end,
                           ', ' order by t.con),
                'no check constraints found') as detail
  from (values
         ('financial_controls',      'financial_controls_status_chk'),
         ('financial_controls',      'financial_controls_frequency_chk'),
         ('financial_controls',      'financial_controls_last_result_chk'),
         ('financial_control_tests', 'financial_control_tests_result_chk')
       ) as t(name, con)
  left join pg_constraint c
         on c.conrelid = to_regclass('public.' || t.name)
        and c.conname = t.con
        and c.contype = 'c';

-- 1f  The history hangs off the register and follows it into the grave.
--     confdeltype 'c' is ON DELETE CASCADE. Without it, deleting a control would
--     either fail on the reference or leave test rows pointing at nothing, and
--     step 2j asserts the behaviour this catalogue row describes.
select 'control_tests_fk_cascades' as check_name,
       count(*) = 1
   and count(*) filter (where c.confdeltype = 'c') = 1 as pass,
       coalesce(string_agg(c.conname || ' on-delete=' || c.confdeltype, ', '),
                'financial_control_tests has no foreign key to financial_controls')
       as detail
  from pg_constraint c
 where c.conrelid = to_regclass('public.financial_control_tests')
   and c.confrelid = to_regclass('public.financial_controls')
   and c.contype = 'f';

-- 1g  Both tables carry an agency policy, and both sides of it are written. A
--     FOR ALL policy with a USING and no WITH CHECK reads as though it governs
--     writes and does not: PostgreSQL falls back to USING for the write check on
--     UPDATE but not on INSERT, so an INSERT would be unrestricted. The register
--     inherits its policy from 20260822000016; the history's is created here.
select 'controls_policies_write_both_sides' as check_name,
       count(*) = 2
   and count(*) filter (where p.polqual is not null) = 2
   and count(*) filter (where p.polwithcheck is not null) = 2 as pass,
       coalesce(string_agg(c.relname || '.' || p.polname
                           || case when p.polqual is null then ' NO-USING' else '' end
                           || case when p.polwithcheck is null then ' NO-WITH-CHECK' else '' end,
                           ', ' order by c.relname),
                'neither table has a policy') as detail
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
 where c.oid in (to_regclass('public.financial_controls'),
                 to_regclass('public.financial_control_tests'));

-- 1h  The audit trail is wired on both tables. `public.audit_financial_action()`
--     is the shipped trigger body; AFTER is the only correct timing for it,
--     because it reads NEW after the row is final and writes elsewhere.
select 'controls_audit_triggers_are_after' as check_name,
       count(*) = 2
   and count(*) filter (where (g.tgtype & 2) = 0) = 2 as pass,
       coalesce(string_agg(c.relname || '.' || g.tgname
                           || case when (g.tgtype & 2) <> 0 then ' BEFORE' else ' after' end,
                           ', ' order by c.relname),
                'no audit trigger on either table') as detail
  from pg_trigger g
  join pg_class c on c.oid = g.tgrelid
 where c.oid in (to_regclass('public.financial_controls'),
                 to_regclass('public.financial_control_tests'))
   and not g.tgisinternal
   and g.tgfoid = to_regprocedure('public.audit_financial_action()');

-- 1i  The three commands resolve at the exact signatures the client calls, are
--     SECURITY DEFINER, and are executable by `authenticated` and by nobody
--     else. Definer is not a style choice here: 1c grants the caller no DML on
--     either table, so an invoker-rights command would raise permission denied
--     on its own INSERT. The privilege tests go through CASE rather than AND so
--     an unresolvable signature folds to false instead of asking
--     has_function_privilege about a NULL oid.
select 'controls_commands_are_definer_and_granted' as check_name,
       count(*) = 3
   and count(*) filter (where p.prosecdef) = 3
   and count(*) filter (where case when f.oid is null then false
                             else has_function_privilege('authenticated', f.oid, 'execute') end) = 3
   and count(*) filter (where case when f.oid is null then false
                             else has_function_privilege('anon', f.oid, 'execute') end) = 0
       as pass,
       coalesce(string_agg(t.sig
                           || case when f.oid is null then ' MISSING'
                                   when not p.prosecdef then ' INVOKER'
                                   when not has_function_privilege('authenticated', f.oid, 'execute')
                                        then ' NOT-GRANTED'
                                   when has_function_privilege('anon', f.oid, 'execute')
                                        then ' ANON-CAN-EXECUTE'
                                   else ' ok' end,
                           ', ' order by t.sig),
                'none of the three commands exist') as detail
  from (values
         ('public.upsert_financial_control_command(uuid,text,text,text,text)'),
         ('public.record_control_test_command(uuid,text,text,text,text)'),
         ('public.retire_financial_control_command(uuid,text)')
       ) as t(sig)
  left join pg_proc p on p.oid = to_regprocedure(t.sig)
  left join pg_proc f on f.oid = p.oid;

-- 1j  The guard is private and stays private. It returns a whole
--     financial_controls row, so a client that could call it could read any
--     control in its agency without going through the table's policy at all.
select 'controls_guard_is_unreachable_from_the_client' as check_name,
       to_regprocedure('private.controls_guard(uuid,text,boolean)') is not null
   and not has_function_privilege('authenticated',
             to_regprocedure('private.controls_guard(uuid,text,boolean)'), 'execute')
   and not has_function_privilege('anon',
             to_regprocedure('private.controls_guard(uuid,text,boolean)'), 'execute')
       as pass,
       coalesce(to_regprocedure('private.controls_guard(uuid,text,boolean)')::text,
                'private.controls_guard is MISSING') as detail;

-- 1k  The three indexes exist. Each one backs a read the UI actually performs:
--     the register is listed per agency filtered by status, and the history is
--     read newest-first for one control and newest-first for the whole agency.
select 'controls_indexes_exist' as check_name,
       count(i.oid) = 3 as pass,
       string_agg(t.name || case when i.oid is null then ' MISSING' else ' ok' end,
                  ', ' order by t.name) as detail
  from (values ('idx_financial_controls_agency_status'),
               ('idx_control_tests_control_at'),
               ('idx_control_tests_agency')) as t(name)
  left join pg_class i on i.oid = to_regclass('public.' || t.name)
                      and i.relkind = 'i';

-- 1l  The RBAC matrix says what the migration's Section F claims it says: read
--     to all six non-ADMIN roles on both resources, create and update to FINANCE
--     alone, and delete to nobody at all. Twelve plus four, and the exact counts
--     matter in both directions -- a thirteenth read row would mean some other
--     migration is also seeding these resources, and a fifth write row would mean
--     a role that cannot sign an assurance has been handed the pen. Nothing else
--     in supabase/ mentions either resource name, so these totals are closed.
select 'controls_rbac_matrix_is_exactly_as_seeded' as check_name,
       count(*) filter (where p.action = 'read') = 12
   and count(*) filter (where p.action = 'read'
                          and p.role in ('FINANCE', 'OPERATIONS_MANAGER', 'CRM',
                                         'AGENT', 'VISA_AGENT', 'GUIDE')) = 12
   and count(*) filter (where p.action in ('create', 'update')) = 4
   and count(*) filter (where p.action in ('create', 'update')
                          and p.role = 'FINANCE') = 4
   and count(*) filter (where p.action = 'delete') = 0 as pass,
       coalesce(string_agg(p.action || ':' || p.role || '@' || p.resource, ', '
                           order by p.resource, p.action, p.role),
                'no controls-register permissions were seeded at all') as detail
  from public.staff_permissions p
 where p.resource in ('financial_controls', 'financial_control_tests');

-- PART 2 ---------------------------------------------------------------------
-- The lifecycle. One transaction, rolled back at the end, driven through the
-- three commands. Failures here raise rather than report: psql runs with
-- ON_ERROR_STOP=1, so a raise aborts the file with a nonzero exit and the gate
-- fails. Row security is bypassed by this connection, so nothing below claims a
-- policy filtered anything -- every assertion is either an `if ... then raise`
-- inside PL/pgSQL, which a superuser cannot soften, or a row read back out of a
-- table the commands were supposed to have written.

begin;

-- A refusal that is not asserted by SQLSTATE is not asserted at all: a probe
-- that swallows `whatever went wrong` passes when the statement failed for an
-- unrelated reason. The helper also fails loudly when nothing was raised, which
-- is the worst outcome of an expected-failure test and the easiest to miss.
create or replace function pg_temp.ctl_refuses(p_sql text, p_state text,
                                              p_what text)
returns void language plpgsql as $fn$
declare v_caught text;
begin
  begin
    execute p_sql;
  exception when others then
    v_caught := sqlstate;
  end;
  if v_caught is distinct from p_state then
    raise exception '% : expected SQLSTATE %, got %', p_what, p_state,
      coalesce(v_caught, 'no error at all -- the statement SUCCEEDED');
  end if;
end $fn$;

-- Several refusals in this migration share SQLSTATE 22023 -- a blank code, an
-- unknown frequency, an unknown result, a failed test with no exceptions, a
-- missing retire reason, a double retire and a test against a retired control
-- are all "invalid parameter value". The state alone therefore cannot tell them
-- apart, and a probe that accepted any 22023 would pass when the command
-- refused for the wrong reason. Where that matters the probe reads the message.
create or replace function pg_temp.ctl_refuses_saying(p_sql text, p_state text,
                                                     p_needle text,
                                                     p_what text)
returns void language plpgsql as $fn$
declare v_caught text; v_said text;
begin
  begin
    execute p_sql;
  exception when others then
    v_caught := sqlstate; v_said := sqlerrm;
  end;
  if v_caught is distinct from p_state then
    raise exception '% : expected SQLSTATE %, got %', p_what, p_state,
      coalesce(v_caught, 'no error at all -- the statement SUCCEEDED');
  end if;
  if position(p_needle in coalesce(v_said, '')) = 0 then
    raise exception '% : SQLSTATE % was right, but the message never said "%"; it said "%"',
      p_what, p_state, p_needle, v_said;
  end if;
end $fn$;

-- auth.uid() is NULL in a psql session, and NULL is the caller the guard's first
-- line refuses. So the suite becomes somebody: the claim is set
-- transaction-locally, which is why it cannot outlive the rollback, and the
-- helper then checks that auth.uid() really moved. `is distinct from` rather
-- than `<>` on purpose -- if the claim had not taken, auth.uid() would be NULL,
-- `NULL <> v_id` would be NULL, and `if NULL then` does not raise.
--
-- The claim carries `email` as well as `sub`, which the spine suite's equivalent
-- does not need. Here it is load-bearing: `financial_control_tests.tested_by_email`
-- is denormalised from auth.email() at write time precisely because PostgREST
-- cannot join auth.users, and a simulated session with no email claim would leave
-- that column null and the denormalisation untested.
create or replace function pg_temp.ctl_become(p_email text)
returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then
    raise exception 'no suite account %', p_email;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated',
                      'email', p_email)::text, true);
  if auth.uid() is distinct from v_id then
    raise exception 'the simulated session did not take: auth.uid() is %',
      coalesce(auth.uid()::text, 'NULL');
  end if;
  if auth.email() is distinct from p_email then
    raise exception 'the simulated session has e-mail % rather than %',
      coalesce(auth.email(), 'NULL'), p_email;
  end if;
  return v_id;
end $fn$;

-- Read back through the tables rather than trusting the jsonb a command
-- returned: a command that reported success and wrote nothing would otherwise
-- pass its own assertions. That is the whole point of the register -- the
-- summary columns have to be moved by the write path, not reported by it.
create or replace function pg_temp.ctl_register_of(p_control uuid)
returns public.financial_controls language sql as $fn$
  select * from public.financial_controls where id = p_control;
$fn$;

create or replace function pg_temp.ctl_tests_on(p_control uuid)
returns integer language sql as $fn$
  select count(*)::integer from public.financial_control_tests
   where control_id = p_control;
$fn$;

-- 2a  Two disposable accounts in the DEFAULT agency's HQ branch. FINANCE drives
--     the lifecycle; GUIDE exists so that step 2k can prove the write verbs are
--     genuinely required by a session whose agency is provably in range, which a
--     foreign-agency probe could not distinguish from a scope failure. Neither is
--     ADMIN: has_permission() short-circuits true for ADMIN, so an ADMIN profile
--     would satisfy the guard without consulting one RBAC row and every 42501
--     assertion in this file would become unreachable.
do $step$
declare
  v_agency uuid;
  v_branch uuid;
  v_fin    uuid := 'c0117001-0000-4000-8000-000000000001';
  v_gde    uuid := 'c0117001-0000-4000-8000-000000000002';
begin
  select a.id, b.id into v_agency, v_branch
    from public.agencies a
    join public.branches b on b.agency_id = a.id and b.code = 'HQ'
   where a.code = 'DEFAULT'
   limit 1;
  if v_agency is null or v_branch is null then
    raise exception 'the suite needs the DEFAULT agency and its HQ branch; a fresh reset seeds both';
  end if;

  insert into auth.users(id, email) values
    (v_fin, 'controls-suite-finance@invalid.test'),
    (v_gde, 'controls-suite-guide@invalid.test');

  insert into public.staff_profiles(user_id, role, agency_id, branch_uuid,
                                    branch_id, is_active)
  values (v_fin, 'FINANCE', v_agency, v_branch, v_branch::text, true),
         (v_gde, 'GUIDE',   v_agency, v_branch, v_branch::text, true);

  if pg_temp.ctl_become('controls-suite-finance@invalid.test') <> v_fin then
    raise exception 'the FINANCE session resolved to the wrong uuid';
  end if;
  raise notice '2a ok: agency %, branch %, FINANCE and GUIDE seeded', v_agency, v_branch;
end $step$;

-- 2b  The session is genuinely non-ADMIN, and the matrix answers as Section F
--     seeded it -- for both roles. Without this a later 42501 could be a scope
--     failure wearing a permission failure's SQLSTATE, and the two are
--     indistinguishable by state alone.
--
--     The GUIDE half is the one that matters most, and it is asserted from
--     inside a GUIDE session rather than by reading the table: has_permission()
--     answers about whoever is connected, so asking it as FINANCE would prove
--     nothing about what a GUIDE can do. current_staff_agency_id() is checked
--     for both, because the guard's first line refuses a null agency and a null
--     there would make every 42501 below ambiguous.
do $step$
declare
  v_agency uuid;
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  if public.staff_role() <> 'FINANCE' then
    raise exception 'staff_role() is % for the suite session, not FINANCE',
      public.staff_role();
  end if;
  v_agency := public.current_staff_agency_id();
  if v_agency is null then
    raise exception 'the FINANCE session has no agency; the guard would refuse it as Unauthorized';
  end if;
  if not (public.has_permission('financial_controls', 'read')
      and public.has_permission('financial_controls', 'create')
      and public.has_permission('financial_controls', 'update')
      and public.has_permission('financial_control_tests', 'read')
      and public.has_permission('financial_control_tests', 'create')
      and public.has_permission('financial_control_tests', 'update')) then
    raise exception 'FINANCE is missing one of the six controls permissions Section F seeds';
  end if;
  if public.has_permission('financial_controls', 'delete')
     or public.has_permission('financial_control_tests', 'delete') then
    raise exception 'the matrix granted a delete Section F deliberately withholds';
  end if;

  perform pg_temp.ctl_become('controls-suite-guide@invalid.test');
  if public.staff_role() <> 'GUIDE' then
    raise exception 'staff_role() is % for the second suite session, not GUIDE',
      public.staff_role();
  end if;
  if public.current_staff_agency_id() is distinct from v_agency then
    raise exception 'the GUIDE session is in a different agency; its 42501 would be a scope failure';
  end if;
  if not public.has_permission('financial_controls', 'read') then
    raise exception 'GUIDE cannot read the register, which is the one thing Section F gives every role';
  end if;
  if public.has_permission('financial_controls', 'create')
     or public.has_permission('financial_controls', 'update')
     or public.has_permission('financial_control_tests', 'create')
     or public.has_permission('financial_control_tests', 'update') then
    raise exception 'GUIDE holds a controls write verb; Section F seeds those to FINANCE alone';
  end if;

  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  raise notice '2b ok: FINANCE reads and writes, GUIDE reads only, neither may delete';
end $step$;

-- 2c  A control is created. Everything is read back out of the table rather than
--     out of the jsonb: the register's whole value is that its summary columns
--     were moved by a write path, and a command that returned a cheerful object
--     and wrote nothing would pass an assertion made against its own return.
--
--     `last_tested_at` and `last_result` must both be null here. A control that
--     arrives claiming a result nobody recorded is the exact lie the history
--     table exists to make impossible, and the only place it could come from is
--     a default on the column.
do $step$
declare
  v_id     uuid;
  v_row    public.financial_controls;
  v_agency uuid;
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  v_agency := public.current_staff_agency_id();

  v_id := (public.upsert_financial_control_command(
             null, 'CTL-SUITE-01', 'Bank reconciliation is performed monthly',
             'FINANCE', 'monthly') ->> 'id')::uuid;
  if v_id is null then
    raise exception 'the create returned no id';
  end if;

  v_row := pg_temp.ctl_register_of(v_id);
  if v_row.id is null then
    raise exception 'the create reported success and the register has no such row';
  end if;
  if v_row.control_code <> 'CTL-SUITE-01' then
    raise exception 'control_code is %', v_row.control_code;
  end if;
  if v_row.agency_id is distinct from v_agency then
    raise exception 'the control landed in agency % and the session is in %',
      v_row.agency_id, v_agency;
  end if;
  if coalesce(v_row.status, 'active') <> 'active' then
    raise exception 'a new control is % rather than active', v_row.status;
  end if;
  if v_row.frequency <> 'monthly' or v_row.owner_role <> 'FINANCE' then
    raise exception 'frequency/owner came back as %/%', v_row.frequency, v_row.owner_role;
  end if;
  if v_row.last_tested_at is not null or v_row.last_result is not null then
    raise exception 'a control nobody has tested claims last_result % at %',
      v_row.last_result, v_row.last_tested_at;
  end if;
  if pg_temp.ctl_tests_on(v_id) <> 0 then
    raise exception 'creating a control invented % test rows', pg_temp.ctl_tests_on(v_id);
  end if;
  if not exists (select 1 from public.audit_logs
                  where action = 'CONTROL_CREATE' and resource_id = v_id::text) then
    raise exception 'the create left no CONTROL_CREATE row in audit_logs';
  end if;
  raise notice '2c ok: CTL-SUITE-01 created active, untested, and audited';
end $step$;

-- 2d  The same command amends. `p_id` is the whole difference between the two
--     branches, and the id must survive: an "upsert" that inserted a second row
--     when handed an id would leave two controls with one code, which the new
--     per-agency unique would then reject -- but only if the codes matched, so
--     the failure would be silent whenever the code changed too. Hence the count.
--
--     Amending is a replace, not a patch: the command writes all four editable
--     columns from its parameters, so an omitted description clears the stored
--     one. That is asserted here rather than assumed, because it is the contract
--     the UI form has to satisfy -- it must send every field, not the changed one.
do $step$
declare
  v_id  uuid;
  v_out jsonb;
  v_row public.financial_controls;
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  select id into v_id from public.financial_controls where control_code = 'CTL-SUITE-01';

  v_out := public.upsert_financial_control_command(
             v_id, 'CTL-SUITE-01A', null, 'OPERATIONS_MANAGER', 'QUARTERLY');
  if (v_out ->> 'created')::boolean then
    raise exception 'amending reported created = true';
  end if;
  if (v_out ->> 'id')::uuid is distinct from v_id then
    raise exception 'the amend returned id % for control %', v_out ->> 'id', v_id;
  end if;

  v_row := pg_temp.ctl_register_of(v_id);
  if v_row.control_code <> 'CTL-SUITE-01A' or v_row.owner_role <> 'OPERATIONS_MANAGER' then
    raise exception 'the amend left code %/owner %', v_row.control_code, v_row.owner_role;
  end if;
  if v_row.frequency <> 'quarterly' then
    raise exception 'QUARTERLY was stored as % rather than folded to lower case', v_row.frequency;
  end if;
  if v_row.description is not null then
    raise exception 'a null description left % in place; the amend is not a replace',
      v_row.description;
  end if;
  if (select count(*) from public.financial_controls
       where control_code in ('CTL-SUITE-01', 'CTL-SUITE-01A')) <> 1 then
    raise exception 'amending produced % rows rather than moving one',
      (select count(*) from public.financial_controls
        where control_code in ('CTL-SUITE-01', 'CTL-SUITE-01A'));
  end if;
  if not exists (select 1 from public.audit_logs
                  where action = 'CONTROL_AMEND' and resource_id = v_id::text) then
    raise exception 'the amend left no CONTROL_AMEND row in audit_logs';
  end if;
  raise notice '2d ok: one row moved, code and frequency normalised, description cleared';
end $step$;

-- 2e  What the register refuses to accept. All three of these are 22023 or
--     P0002 rather than a constraint violation, and the difference is the point:
--     `new row for relation "financial_controls" violates check constraint
--     "financial_controls_frequency_chk"` is a true statement that tells the
--     person typing into the form nothing they can act on, so the command names
--     the vocabulary itself. That message is asserted, not just its SQLSTATE --
--     seven different refusals in this migration share 22023, so the state alone
--     cannot tell a rejected frequency from a rejected result.
--
--     The last two lines matter as much as the probes: a refusal that had already
--     inserted before it raised would leave the row behind, because a raise
--     inside a command unwinds only to the statement that called it.
do $step$
declare v_ghost uuid := 'c0117001-0000-4000-8000-0000000000ff';
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');

  perform pg_temp.ctl_refuses_saying(
    $q$select public.upsert_financial_control_command(null, '   ', null, null, 'monthly')$q$,
    '22023', 'A control needs a code', 'creating a control with a blank code');
  perform pg_temp.ctl_refuses_saying(
    $q$select public.upsert_financial_control_command(null, 'CTL-SUITE-BAD', null, null, 'fortnightly')$q$,
    '22023', 'expected monthly, quarterly, annual or ad_hoc',
    'creating a control on a frequency nobody runs');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.upsert_financial_control_command(%L::uuid, 'CTL-SUITE-GHOST', null, null, 'monthly')$q$,
           v_ghost),
    'P0002', 'Control not found', 'amending a control this agency has no row for');

  if exists (select 1 from public.financial_controls
              where control_code in ('CTL-SUITE-BAD', 'CTL-SUITE-GHOST', '')) then
    raise exception 'a refused create left a row in the register';
  end if;
  raise notice '2e ok: blank code, unknown frequency and unknown id all refused, and none wrote';
end $step$;

-- 2f  The command the whole design exists for. One call has to do two things --
--     append a row to the history and move the register's four summary columns --
--     and it has to do them together, because the summary is only trustworthy if
--     it cannot be set without the evidence behind it. Both halves are read back
--     out of their tables.
--
--     `tested_by_email` is asserted because it is denormalised at write time and
--     can never be recovered later: PostgREST cannot join auth.users, so an
--     e-mail not captured here is an e-mail the register has lost for good.
do $step$
declare
  v_id      uuid;
  v_fin     uuid;
  v_out     jsonb;
  v_row     public.financial_controls;
  v_test    public.financial_control_tests;
begin
  v_fin := pg_temp.ctl_become('controls-suite-finance@invalid.test');
  select id into v_id from public.financial_controls where control_code = 'CTL-SUITE-01A';

  v_out := public.record_control_test_command(
             v_id, 'partial', 'all 412 entries in period 2026-08',
             '3 postings with no attachment', 'follow-up raised with the branch');
  if (v_out ->> 'result') <> 'partial' then
    raise exception 'the test returned result %', v_out ->> 'result';
  end if;

  if pg_temp.ctl_tests_on(v_id) <> 1 then
    raise exception 'the history holds % rows after one test', pg_temp.ctl_tests_on(v_id);
  end if;
  select * into v_test from public.financial_control_tests where control_id = v_id;
  if v_test.agency_id is distinct from public.current_staff_agency_id() then
    raise exception 'the test row landed in agency % and the session is in %',
      coalesce(v_test.agency_id::text, 'NULL'),
      coalesce(public.current_staff_agency_id()::text, 'NULL');
  end if;
  if v_test.tested_by is distinct from v_fin then
    raise exception 'the test was attributed to % rather than the FINANCE session %',
      coalesce(v_test.tested_by::text, 'NULL'), v_fin;
  end if;
  if v_test.tested_by_email is distinct from 'controls-suite-finance@invalid.test' then
    raise exception 'tested_by_email is %', coalesce(v_test.tested_by_email, 'NULL');
  end if;
  if v_test.exceptions <> '3 postings with no attachment'
     or v_test.population <> 'all 412 entries in period 2026-08'
     or v_test.note <> 'follow-up raised with the branch' then
    raise exception 'the history did not keep what was tested: pop %, exc %, note %',
      v_test.population, v_test.exceptions, v_test.note;
  end if;

  v_row := pg_temp.ctl_register_of(v_id);
  if v_row.last_result <> 'partial' then
    raise exception 'the register still reads last_result %',
      coalesce(v_row.last_result, 'NULL');
  end if;
  if v_row.last_tested_at is distinct from v_test.tested_at then
    raise exception 'last_tested_at is % and the test says %',
      coalesce(v_row.last_tested_at::text, 'NULL'), v_test.tested_at;
  end if;
  if v_row.test_population is distinct from v_test.population
     or v_row.exceptions is distinct from v_test.exceptions then
    raise exception 'the register kept pop % / exc % against the test''s % / %',
      v_row.test_population, v_row.exceptions, v_test.population, v_test.exceptions;
  end if;
  if coalesce(v_row.status, 'active') <> 'active' then
    raise exception 'recording a test changed the control''s status to %', v_row.status;
  end if;
  if not exists (select 1 from public.audit_logs
                  where action = 'CONTROL_TEST' and resource_id = v_id::text
                    and details ->> 'test_id' = v_test.id::text) then
    raise exception 'the test left no CONTROL_TEST row naming test % in audit_logs', v_test.id;
  end if;
  raise notice '2f ok: one history row written and all four register columns moved with it';
end $step$;

-- 2g  What a test result may not be. The rule with teeth is the second probe:
--     "it failed" with no statement of what failed is not a test result, it is a
--     shrug, and the person who reads this register in six months cannot act on a
--     shrug. `passed` and `partial` do not carry that rule, which 2h relies on.
--
--     The third probe sends whitespace rather than null, because the command
--     trims before it decides: if it checked `p_exceptions is null` instead of the
--     trimmed value, a space bar would satisfy the rule and the register would
--     fill up with blank explanations that read as filled in.
do $step$
declare
  v_id    uuid;
  v_ghost uuid := 'c0117001-0000-4000-8000-0000000000ff';
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  select id into v_id from public.financial_controls where control_code = 'CTL-SUITE-01A';

  perform pg_temp.ctl_refuses_saying(
    format($q$select public.record_control_test_command(%L::uuid, 'inconclusive')$q$, v_id),
    '22023', 'expected passed, failed or partial', 'recording a result nobody defined');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.record_control_test_command(%L::uuid, 'failed', 'the whole period')$q$, v_id),
    '22023', 'A failed test has to say what failed', 'recording a failure with no exceptions');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.record_control_test_command(%L::uuid, 'FAILED', 'the whole period', '   ')$q$, v_id),
    '22023', 'A failed test has to say what failed',
    'recording a failure whose exceptions are whitespace');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.record_control_test_command(%L::uuid, 'passed')$q$, v_ghost),
    'P0002', 'Control not found', 'testing a control this agency has no row for');

  if pg_temp.ctl_tests_on(v_id) <> 1 then
    raise exception 'a refused test appended to the history: % rows', pg_temp.ctl_tests_on(v_id);
  end if;
  raise notice '2g ok: four refusals, and the history still holds exactly the one real test';
end $step$;

-- 2h  A second test appends rather than replaces, and the register follows it.
--     This is a claim about what the second command wrote, not about the order of
--     the two rows: every row in this transaction gets the same `now()`, so
--     `tested_at desc` cannot be demonstrated here and no assertion below reads
--     the history positionally. The register's columns are checked against the
--     second call's own values instead, which is the same fact from the only
--     angle this harness can see it from.
--
--     The failure is recorded with its exceptions, so it also proves the rule in
--     2g is a rule about missing explanations rather than about failing at all.
do $step$
declare
  v_id  uuid;
  v_row public.financial_controls;
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  select id into v_id from public.financial_controls where control_code = 'CTL-SUITE-01A';

  perform public.record_control_test_command(
    v_id, 'failed', 'all 388 entries in period 2026-09',
    '11 postings unreconciled at cut-off', null);

  if pg_temp.ctl_tests_on(v_id) <> 2 then
    raise exception 'the history holds % rows after two tests', pg_temp.ctl_tests_on(v_id);
  end if;
  if (select count(*) from public.financial_control_tests
       where control_id = v_id and result = 'partial') <> 1
     or (select count(*) from public.financial_control_tests
          where control_id = v_id and result = 'failed') <> 1 then
    raise exception 'the second test overwrote the first rather than joining it';
  end if;

  v_row := pg_temp.ctl_register_of(v_id);
  if v_row.last_result <> 'failed' then
    raise exception 'the register reads last_result % after a failed test',
      coalesce(v_row.last_result, 'NULL');
  end if;
  if v_row.exceptions <> '11 postings unreconciled at cut-off'
     or v_row.test_population <> 'all 388 entries in period 2026-09' then
    raise exception 'the register kept the first test''s pop % / exc %',
      v_row.test_population, v_row.exceptions;
  end if;
  if (select count(*) from public.audit_logs
       where action = 'CONTROL_TEST' and resource_id = v_id::text) <> 2 then
    raise exception 'audit_logs holds % CONTROL_TEST rows for two tests',
      (select count(*) from public.audit_logs
        where action = 'CONTROL_TEST' and resource_id = v_id::text);
  end if;
  raise notice '2h ok: two tests kept, and the register carries the second';
end $step$;

-- 2i  Retirement, and what retirement costs. Three things are asserted together
--     because they are one contract: the reason is mandatory, the row survives
--     with its history intact, and the control stops accepting tests.
--
--     The last of those is the one that matters. A retired control that still
--     accepts tests is a control that can be quietly resurrected by anyone who
--     kept its id, which defeats the point of retiring it in the first place.
--
--     Both the double-retire and the test-against-retired probes carry the needle
--     'is retired' rather than 'is already retired'. In a serial transaction the
--     guard's live check (migration line 297) always fires before the retire
--     UPDATE's own WHERE can miss, so the guard's wording is what a caller sees.
--     Line 567's 'is already retired' is the race-only path, reachable only when
--     two callers pass the unlocked `stable` guard at once, and nothing in a
--     single-session suite can provoke it. The needle is chosen so it matches the
--     first and does not substring-match the second: if the ordering ever changed,
--     this assertion would notice.
do $step$
declare
  v_id  uuid;
  v_row public.financial_controls;
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  select id into v_id from public.financial_controls where control_code = 'CTL-SUITE-01A';

  perform pg_temp.ctl_refuses_saying(
    format($q$select public.retire_financial_control_command(%L::uuid, '  ')$q$, v_id),
    '22023', 'Retiring a control needs a reason', 'retiring a control with no reason given');

  v_row := pg_temp.ctl_register_of(v_id);
  if coalesce(v_row.status, 'active') <> 'active' then
    raise exception 'the refused retire changed status to %', v_row.status;
  end if;

  perform public.retire_financial_control_command(
    v_id, 'superseded by the reconciliation control in the 2026-Q4 close pack');

  v_row := pg_temp.ctl_register_of(v_id);
  if v_row.status <> 'retired' then
    raise exception 'the control reads status % after being retired',
      coalesce(v_row.status, 'NULL');
  end if;
  if v_row.last_result <> 'failed' or v_row.last_tested_at is null then
    raise exception 'retiring the control erased its last result';
  end if;
  if pg_temp.ctl_tests_on(v_id) <> 2 then
    raise exception 'retiring the control took % of its history rows with it',
      2 - pg_temp.ctl_tests_on(v_id);
  end if;
  if not exists (
    select 1 from public.audit_logs
     where action = 'CONTROL_RETIRE'
       and resource_id = v_id::text
       and details ->> 'reason' like 'superseded by the reconciliation control%'
       and details ->> 'last_result' = 'failed'
  ) then
    raise exception 'no CONTROL_RETIRE audit row carrying the reason and the last result';
  end if;

  perform pg_temp.ctl_refuses_saying(
    format($q$select public.retire_financial_control_command(%L::uuid, 'again')$q$, v_id),
    '22023', 'is retired', 'retiring a control that is already retired');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.record_control_test_command(%L::uuid, 'passed', 'a later period')$q$, v_id),
    '22023', 'is retired', 'testing a control that has been retired');

  if pg_temp.ctl_tests_on(v_id) <> 2 then
    raise exception 'a refused test appended to a retired control''s history';
  end if;
  raise notice '2i ok: retired with a reason, history kept, and no further tests accepted';
end $step$;

-- 2j  The same three commands from inside a session that holds no write verb.
--     2b already proved a GUIDE is missing the verbs; this proves the commands
--     ask. A SECURITY DEFINER function runs as its owner, so nothing but its own
--     first few lines stands between a GUIDE and the register -- which is why each
--     command is probed rather than the guard alone.
--
--     The create probe is the one that would slip through a guard-only reading:
--     `upsert` with a null id never reaches `private.controls_guard`, and checks
--     the `create` verb itself at migration line 373.
--
--     A fresh control is created as FINANCE first, because 2i left the suite's
--     control retired and a retired row would answer 22023 before authority was
--     ever consulted -- which would look like a passing 42501 probe if the state
--     alone were asserted.
do $step$
declare
  v_live uuid;
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  select (public.upsert_financial_control_command(
            null, 'CTL-SUITE-02', 'Bank reconciliation completeness', 'FINANCE', 'monthly'
          ) ->> 'id')::uuid into v_live;

  perform pg_temp.ctl_become('controls-suite-guide@invalid.test');

  perform pg_temp.ctl_refuses_saying(
    $q$select public.upsert_financial_control_command(null, 'CTL-SUITE-GUIDE', null, null, 'monthly')$q$,
    '42501', 'Your role cannot create financial controls',
    'a role with no create verb opening a control');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.record_control_test_command(%L::uuid, 'passed', 'all of it')$q$, v_live),
    '42501', 'Your role cannot update financial controls',
    'a role with no update verb signing off a control');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.retire_financial_control_command(%L::uuid, 'not my call')$q$, v_live),
    '42501', 'Your role cannot update financial controls',
    'a role with no update verb retiring a control');

  if pg_temp.ctl_tests_on(v_live) <> 0 then
    raise exception 'a refused GUIDE test wrote a history row';
  end if;
  if (select count(*) from public.financial_controls
       where control_code = 'CTL-SUITE-GUIDE') <> 0 then
    raise exception 'a refused GUIDE create wrote a control';
  end if;
  if (select coalesce(status, 'active') from public.financial_controls where id = v_live) <> 'active' then
    raise exception 'a refused GUIDE retire changed the control''s status';
  end if;
  raise notice '2j ok: all three commands refuse a role that holds no write verb';
end $step$;

-- 2k  Where the authority actually comes from. 2j could be explained away by a
--     command that hard-codes a list of blessed role names, and a hard-coded list
--     is a different system from a permission matrix: it cannot be changed by an
--     administrator, and it drifts from the matrix the UI renders.
--
--     So this step takes the two rows away from FINANCE and re-runs the same two
--     probes. If the commands read the matrix, FINANCE now refuses with the same
--     two messages a GUIDE got. If they read the role name, both calls succeed and
--     the probes fail -- which is the finding, not a flake.
--
--     Only the `financial_controls` rows are removed. `financial_control_tests`
--     keeps its own two write rows, so a command that consulted the history
--     table's verb instead of the register's would still be authorised here and
--     would slip through: the deletion is scoped to make that a distinguishable
--     outcome rather than a coincidence.
do $step$
declare
  v_live    uuid;
  v_removed integer;
begin
  perform pg_temp.ctl_become('controls-suite-finance@invalid.test');
  select id into v_live from public.financial_controls where control_code = 'CTL-SUITE-02';

  if not public.has_permission('financial_controls', 'update') then
    raise exception 'FINANCE cannot update financial_controls before anything was removed';
  end if;

  with gone as (
    delete from public.staff_permissions
     where role = 'FINANCE'
       and resource = 'financial_controls'
       and action in ('create', 'update')
    returning 1
  )
  select count(*) into v_removed from gone;
  if v_removed <> 2 then
    raise exception 'expected to remove 2 FINANCE permission rows, removed %', v_removed;
  end if;
  if public.has_permission('financial_controls', 'update')
     or public.has_permission('financial_controls', 'create') then
    raise exception 'has_permission still answers yes after the rows were removed';
  end if;
  if not public.has_permission('financial_control_tests', 'update') then
    raise exception 'the deletion reached financial_control_tests, which it must not';
  end if;

  perform pg_temp.ctl_refuses_saying(
    $q$select public.upsert_financial_control_command(null, 'CTL-SUITE-NOPERM', null, null, 'monthly')$q$,
    '42501', 'Your role cannot create financial controls',
    'FINANCE creating a control after its create row was removed');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.record_control_test_command(%L::uuid, 'passed', 'all of it')$q$, v_live),
    '42501', 'Your role cannot update financial controls',
    'FINANCE testing a control after its update row was removed');
  perform pg_temp.ctl_refuses_saying(
    format($q$select public.retire_financial_control_command(%L::uuid, 'no longer mine')$q$, v_live),
    '42501', 'Your role cannot update financial controls',
    'FINANCE retiring a control after its update row was removed');

  if (select count(*) from public.financial_controls
       where control_code = 'CTL-SUITE-NOPERM') <> 0 then
    raise exception 'a refused create wrote a control after the permission was removed';
  end if;
  raise notice '2k ok: authority is read from the matrix, not from the role''s name';
end $step$;

-- 2l  The one direct write in this suite, and it is labelled because it is not a
--     claim about what a client can do. `authenticated` holds SELECT only (1c) and
--     no policy grants it DELETE, so a browser cannot reach this statement; psql
--     connects as the local superuser and bypasses both.
--
--     What it demonstrates is the runtime half of 1f. 1f reads `confdeltype = 'c'`
--     out of the catalogue, which is the declaration; this shows the declaration
--     doing its job, that a removed control does not leave its test history behind
--     as rows nobody can reach. There is no command that deletes a control -- the
--     delete verb is seeded to nobody and retirement is the supported path -- so a
--     direct statement is the only way to exercise the cascade at all.
do $step$
declare
  v_id     uuid;
  v_before integer;
begin
  select id into v_id from public.financial_controls where control_code = 'CTL-SUITE-01A';
  v_before := pg_temp.ctl_tests_on(v_id);
  if v_before <> 2 then
    raise exception 'expected 2 history rows to cascade, found %', v_before;
  end if;

  delete from public.financial_controls where id = v_id;

  if exists (select 1 from public.financial_controls where id = v_id) then
    raise exception 'the control survived its own delete';
  end if;
  if pg_temp.ctl_tests_on(v_id) <> 0 then
    raise exception '% history rows outlived the control they belong to',
      pg_temp.ctl_tests_on(v_id);
  end if;
  raise notice '2l ok: deleting a control takes its history with it (superuser path, labelled)';
end $step$;

rollback;

-- ============================================================================
-- Part 3  Residue.
--
--     Part 2 ran inside a transaction that has now been rolled back, so this part
--     asks whether the rollback actually took. It matters more here than it looks:
--     step 2k deleted two rows from a live RBAC table, and a suite that left them
--     deleted would quietly strip FINANCE of its authority over the register for
--     every later gate in the run and for the developer's own database afterwards.
--
--     These are Part 1-shaped rows again -- one per line, `pass` never null -- so
--     the harness fails the gate on any of them.
-- ============================================================================

select 'controls_suite_left_no_controls' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(control_code, ', ' order by control_code),
                'no CTL-SUITE-% rows remain') as detail
  from public.financial_controls
 where control_code like 'CTL-SUITE-%';

select 'controls_suite_left_no_test_rows' as check_name,
       count(*) = 0 as pass,
       count(*) || ' orphan test rows' as detail
  from public.financial_control_tests t
  left join public.financial_controls c on c.id = t.control_id
 where c.id is null
    or t.tested_by_email like 'controls-suite-%@invalid.test';

select 'controls_suite_left_no_accounts' as check_name,
       count(*) = 0 as pass,
       count(*) || ' suite rows across auth.users and staff_profiles' as detail
  from (
    select id from auth.users where email like 'controls-suite-%@invalid.test'
    union all
    select user_id from public.staff_profiles
     where user_id in ('c0117001-0000-4000-8000-000000000001',
                       'c0117001-0000-4000-8000-000000000002')
  ) as leftovers;

select 'controls_rbac_matrix_is_back' as check_name,
       count(*) = 16 as pass,
       count(*) || ' of 16 seeded permission rows present after rollback' as detail
  from public.staff_permissions
 where resource in ('financial_controls', 'financial_control_tests');

select 'controls_suite_left_no_session' as check_name,
       coalesce(auth.uid()::text, '') not in ('c0117001-0000-4000-8000-000000000001',
                                             'c0117001-0000-4000-8000-000000000002') as pass,
       'auth.uid() is now ' || coalesce(auth.uid()::text, 'NULL') as detail;
