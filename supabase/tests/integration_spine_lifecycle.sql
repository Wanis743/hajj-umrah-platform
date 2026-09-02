-- ============================================================================
-- Integration spine: lifecycle and catalogue suite
--
-- 20260902120000_integration_spine.sql installs three tables, twenty-two
-- private bodies and nine public wrappers whose entire purpose is to move one
-- piece of work between stages -- CRM hands to OPERATIONS, OPERATIONS hands to
-- DMS -- and to leave a ledger saying who moved it and when. Nothing about that
-- is checked by the migration's own closing assertions, which look only at the
-- shape of the schema. This suite drives the thing.
--
-- WHAT THIS SUITE ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
--
-- It runs inside scripts/fresh-db-replay.sh, where psql connects as the local
-- stack's superuser. A superuser bypasses row security entirely: every policy
-- on every table is skipped, so a query that returns a row here proves nothing
-- about whether a signed-in staff member could have seen it. Any assertion of
-- the form "the other agency's chain is invisible" would therefore pass in this
-- harness whether the policies were right, wrong, or absent -- which is worse
-- than no test, because it reads like coverage. This file writes none.
--
-- What it asserts instead comes in two kinds a superuser cannot make wrong.
--
--   Part 1 asks the catalogue. `relrowsecurity` is a flag on pg_class: reading
--   it as superuser gives the same answer as reading it as anyone else, because
--   it is a fact about the table and not about the connection. So the RLS
--   assertions here are catalogue checks -- RLS is switched on, the policies
--   exist, they are per-command rather than blanket, each one names both
--   has_permission() and row_in_staff_scope(), every UPDATE policy carries a
--   WITH CHECK, the ledger holds nothing but a read policy and an append
--   policy, and `anon` holds no table privilege at all. Not one of them claims
--   that a policy filtered a row. The same reasoning covers the trigger,
--   constraint, index, grant and RBAC-matrix checks: they are questions about
--   what is installed.
--
--   Part 2 drives the wrappers and asserts by SQLSTATE. The guards that refuse
--   things here are written in PL/pgSQL -- they ask has_permission() about rows
--   in staff_permissions, and row_in_staff_scope() about the agency on the row
--   in front of them. A superuser connection cannot soften those, because they
--   are not row security; they are `if not ... then raise`. That is also how
--   the suite can prove a permission is genuinely required: it deletes one
--   role's seeded spine grants inside the transaction and watches all nine
--   wrappers raise 42501 for a session whose scope is provably in range. The
--   status machine, the append-only ledger, the CHECK constraints and the
--   derived current_stage are the same story -- triggers and constraints, not
--   policies.
--
-- Part 2 is one `begin ... rollback;`. It creates its own auth.users rows and
-- staff_profiles rows and sets `request.jwt.claims` transaction-locally, so
-- auth.uid() is a real uuid it chose rather than NULL, and the guards are
-- satisfied by RBAC rows rather than by the connection. Part 3 then proves the
-- rollback took: no suite chain, no suite account, no suite profile, and the
-- 48 seeded permission rows back where they started.
--
-- ONE THING THE SUITE CANNOT ASSERT, AND WHY IT DOES NOT PRETEND TO
--
-- Every row written in Part 2 gets `now()` for its timestamps, and `now()` is
-- the transaction timestamp -- identical for all of them. So the orderings in
-- private.spine_chain (`order by ev.at, ev.id`), private.spine_inbox (`order by
-- h.opened_at, h.seq`) and private.spine_overview (`order by c.opened_at desc`)
-- are decided, inside one transaction, by a random uuid or by a seq that is
-- only unique per chain. Asserting a position in those arrays would pass or
-- fail by luck. The suite asserts membership, counts and shape there, and keeps
-- its one positional assertion for spine_chain's `handoffs`, which is ordered
-- by `seq` -- unique per chain, and therefore real.
--
-- Nothing here writes to spine_chains, spine_handoffs or spine_handoff_events
-- directly except three clearly labelled places that must reach behaviour no
-- wrapper can reach: the BEFORE UPDATE status machine in 2j, the append-only
-- ledger in 2p, and 2p's closing `delete from public.spine_chains`, which is
-- there because `delete` is seeded to no role at all and the cascade is the only
-- way to show that the ledger's DELETE guard lets a parent take its events with
-- it rather than refusing every delete it sees. Every other write in the file
-- goes through the nine public wrappers.
-- ============================================================================

-- PART 1 ---------------------------------------------------------------------
-- Catalogue verdicts. Each statement emits one row of check_name, pass, detail;
-- scripts/run-sql-gate.mjs reads the `pass` column and fails the gate on f or
-- on NULL, so every expression below is total: a missing object folds to false
-- through a count, never to NULL through a bool_and over an empty set.

-- 1a  The three tables exist and carry the RLS flag. A catalogue fact: this is
--     `relrowsecurity` on pg_class, not evidence that a policy filtered a row.
select 'spine_tables_exist_with_rls' as check_name,
       count(c.oid) = 3
   and count(*) filter (where c.relrowsecurity) = 3 as pass,
       string_agg(t.name || case
                    when c.oid is null then ' MISSING'
                    when not c.relrowsecurity then ' RLS-OFF'
                    else ' rls' end, ', ' order by t.name) as detail
  from (values ('spine_chains'), ('spine_handoffs'), ('spine_handoff_events'))
         as t(name)
  left join pg_class c on c.oid = to_regclass('public.' || t.name);

-- 1b  anon holds nothing on any of them. Section F revokes all three from anon
--     after creating them, so a default-privilege grant made earlier cannot
--     have leaked in. 21 = three tables by seven table privileges.
select 'spine_anon_holds_no_table_privilege' as check_name,
       count(*) = 21
   and count(*) filter (where has_table_privilege('anon', c.oid, p.priv)) = 0
       as pass,
       coalesce(string_agg(t.name || '.' || p.priv, ', ')
                filter (where has_table_privilege('anon', c.oid, p.priv)),
                'anon holds nothing') as detail
  from (values ('spine_chains'), ('spine_handoffs'), ('spine_handoff_events'))
         as t(name)
  join pg_class c on c.oid = to_regclass('public.' || t.name)
  cross join (values ('select'), ('insert'), ('update'), ('delete'),
                     ('truncate'), ('references'), ('trigger')) as p(priv);

-- 1c  Policy shape: four on chains, four on handoffs, two on the ledger, and
--     none of them blanket. polcmd '*' is a FOR ALL policy, which would let one
--     expression stand in for read, write and delete at once.
select 'spine_policy_shape' as check_name,
       count(*) filter (where c.relname = 'spine_chains') = 4
   and count(*) filter (where c.relname = 'spine_handoffs') = 4
   and count(*) filter (where c.relname = 'spine_handoff_events') = 2
   and count(*) filter (where p.polcmd = '*') = 0 as pass,
       coalesce(string_agg(c.relname || '.' || p.polname || '/' || p.polcmd,
                           ', ' order by c.relname, p.polname),
                'no spine policies at all') as detail
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname like 'spine\_%';

-- 1d  Every spine policy asks both questions. A policy that named only
--     has_permission would let any FINANCE login read every agency's chains;
--     one that named only row_in_staff_scope would ignore the RBAC matrix.
select 'spine_policies_name_permission_and_scope' as check_name,
       count(*) = 10
   and count(*) filter (
         where coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
               like '%has_permission%'
           and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
               like '%row_in_staff_scope%') = 10 as pass,
       coalesce(string_agg(p.tablename || '.' || p.policyname, ', ')
                filter (where coalesce(p.qual, '') || ' ' ||
                              coalesce(p.with_check, '')
                              not like '%row_in_staff_scope%'),
                'all ten name both helpers') as detail
  from pg_policies p
 where p.schemaname = 'public' and p.tablename like 'spine\_%';

-- 1e  The two UPDATE policies carry a WITH CHECK. Without one, a staff member
--     in scope could update a row into another agency and lose it.
select 'spine_update_policies_carry_with_check' as check_name,
       count(*) filter (where p.polcmd = 'w') = 2
   and count(*) filter (where p.polcmd = 'w' and p.polwithcheck is null) = 0
       as pass,
       coalesce(string_agg(c.relname || '.' || p.polname, ', ')
                filter (where p.polcmd = 'w'), 'no update policy found')
       as detail
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname like 'spine\_%';

-- 1f  The ledger has no policy that could rewrite or remove an event: polcmd
--     'r' is SELECT and 'a' is INSERT, and those are the only two it holds.
--     Part 2 proves the trigger refuses anyway, so the ledger is closed twice.
select 'spine_ledger_policies_are_read_and_append_only' as check_name,
       count(*) = 2
   and count(*) filter (where p.polcmd = 'r') = 1
   and count(*) filter (where p.polcmd = 'a') = 1 as pass,
       coalesce(string_agg(p.polname || '/' || p.polcmd, ', ' order by p.polname),
                'the ledger has no policies') as detail
  from pg_policy p
 where p.polrelid = to_regclass('public.spine_handoff_events');

-- 1g  The six guard triggers exist and are enabled. tgenabled 'O' is the normal
--     origin/local setting; 'D' would be a disabled trigger, which is how a
--     status machine stops being enforced without anyone editing a line of SQL.
with want(tbl, trg) as (values
  ('spine_chains',        'trg_spine_chains_subject'),
  ('spine_handoffs',      'trg_spine_handoffs_subject'),
  ('spine_handoffs',      'trg_spine_handoffs_ancestry'),
  ('spine_handoffs',      'trg_spine_handoffs_status'),
  ('spine_handoffs',      'trg_spine_handoffs_stage'),
  ('spine_handoff_events','trg_spine_events_append_only'))
select 'spine_guard_triggers_enabled' as check_name,
       count(g.oid) = 6
   and count(*) filter (where g.tgenabled = 'O') = 6 as pass,
       string_agg(w.trg || case
                    when g.oid is null then ' MISSING'
                    when g.tgenabled <> 'O' then ' ' || g.tgenabled
                    else ' on' end, ', ' order by w.tbl, w.trg) as detail
  from want w
  left join pg_trigger g
    on g.tgrelid = to_regclass('public.' || w.tbl)
   and g.tgname = w.trg
   and not g.tgisinternal;

-- 1h  The platform triggers Section F.2 installs conditionally really did
--     install. Each is guarded on to_regproc(...) in the migration, so if a
--     helper had been renamed the whole block would have gone quiet: no error,
--     no scope stamp, no audit row. The ledger correctly has no updated_at
--     trigger, because it has no updated_at column.
with want(tbl, trg) as (values
  ('spine_chains',        'trg_stamp_staff_scope'),
  ('spine_handoffs',      'trg_stamp_staff_scope'),
  ('spine_handoff_events','trg_stamp_staff_scope'),
  ('spine_chains',        'trg_audit_spine_chains'),
  ('spine_handoffs',      'trg_audit_spine_handoffs'),
  ('spine_handoff_events','trg_audit_spine_handoff_events'),
  ('spine_chains',        'trg_touch_updated_at'),
  ('spine_handoffs',      'trg_touch_updated_at'))
select 'spine_platform_triggers_installed' as check_name,
       count(g.oid) = 8
   and count(*) filter (where g.tgenabled = 'O') = 8
   and not exists (
         select 1 from pg_trigger x
          where x.tgrelid = to_regclass('public.spine_handoff_events')
            and x.tgname = 'trg_touch_updated_at') as pass,
       string_agg(w.tbl || '.' || w.trg ||
                  case when g.oid is null then ' MISSING' else '' end,
                  ', ' order by w.tbl, w.trg) as detail
  from want w
  left join pg_trigger g
    on g.tgrelid = to_regclass('public.' || w.tbl)
   and g.tgname = w.trg
   and not g.tgisinternal;

-- 1i  The four platform helpers those triggers and policies depend on exist by
--     exact signature. 1h proves the triggers are attached; this proves the
--     bodies they call are the ones this schema was written against.
with want(sig) as (values
  ('public.has_permission(text,text)'),
  ('public.row_in_staff_scope(uuid,uuid)'),
  ('public.staff_role()'),
  ('public.staff_agency_id()'),
  ('public.staff_branch_id()'),
  ('public.current_staff_agency_id()'),
  ('public.stamp_staff_scope()'),
  ('public.write_audit_log()'),
  ('public.update_updated_at_column()'))
select 'spine_platform_helpers_present' as check_name,
       count(to_regprocedure(w.sig)) = 9 as pass,
       coalesce(string_agg(w.sig, ', ')
                filter (where to_regprocedure(w.sig) is null),
                'all nine present') as detail
  from want w;

-- 1j  The public surface is exactly the nine wrappers, by exact signature: all
--     SECURITY DEFINER, all with search_path pinned, all executable by
--     authenticated and none by anon. A definer body with an unpinned
--     search_path is a schema-shadowing hole; an anon-executable one is an
--     unauthenticated write endpoint.
with want(sig) as (values
  ('public.open_spine_chain_command(text,text,uuid,text,text,text)'),
  ('public.open_spine_handoff_command(uuid,text,text,text,text,text,text,text,uuid,date,uuid,jsonb,text,uuid)'),
  ('public.accept_spine_handoff_command(uuid,text)'),
  ('public.complete_spine_handoff_command(uuid,text)'),
  ('public.decline_spine_handoff_command(uuid,text)'),
  ('public.close_spine_chain_command(uuid,text,text)'),
  ('public.get_spine_inbox(integer)'),
  ('public.get_spine_chain(uuid)'),
  ('public.get_spine_overview(integer)'))
select 'spine_public_surface_is_nine_definer_wrappers' as check_name,
       count(p.oid) = 9
   and count(*) filter (where p.prosecdef) = 9
   and count(*) filter (
         where coalesce(array_to_string(p.proconfig, ','), '')
               like '%search\_path=%') = 9
   and count(*) filter (
         where has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 9
   and count(*) filter (
         where has_function_privilege('anon', p.oid, 'EXECUTE')) = 0
   and (select count(*) from pg_proc q
         join pg_namespace m on m.oid = q.pronamespace
        where m.nspname = 'public' and q.proname like '%spine%') = 9 as pass,
       string_agg(split_part(w.sig, '(', 1) ||
                  case when p.oid is null then ' MISSING' else '' end,
                  ', ' order by w.sig) as detail
  from want w
  left join pg_proc p on p.oid = to_regprocedure(w.sig);

-- 1k  The twenty-two private bodies: eighteen definer, and not one of the
--     eighteen executable by authenticated. Section K revokes them so the only
--     way in is a wrapper -- which is what makes the wrappers the API and the
--     guards unavoidable. The four exceptions are the pure predicates in 1l.
select 'spine_private_bodies_are_unreachable' as check_name,
       count(*) = 22
   and count(*) filter (where p.prosecdef) = 18
   and count(*) filter (
         where p.prosecdef
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 0
   and count(*) filter (
         where has_function_privilege('anon', p.oid, 'EXECUTE')) = 0 as pass,
       count(*) || ' bodies, ' || count(*) filter (where p.prosecdef) ||
       ' definer, ' ||
       coalesce(nullif(string_agg(p.proname, ', ') filter (
                  where p.prosecdef
                    and has_function_privilege('authenticated', p.oid,
                                               'EXECUTE')), ''),
                'none reachable by authenticated') as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private' and p.proname like 'spine\_%';

-- 1l  The three predicates a CHECK constraint and a client both need are pure,
--     not definer, and granted to authenticated -- a form that wants to know
--     whether 'CRM' is a stage should not have to guess.
with want(sig) as (values
  ('private.spine_stage_ok(text)'),
  ('private.spine_subject_target(text)'),
  ('private.spine_role_ok(text)'))
select 'spine_predicates_pure_and_reachable' as check_name,
       count(p.oid) = 3
   and count(*) filter (where p.provolatile = 'i') = 3
   and count(*) filter (where p.prosecdef) = 0
   and count(*) filter (
         where has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 3
   and count(*) filter (
         where has_function_privilege('anon', p.oid, 'EXECUTE')) = 0 as pass,
       string_agg(split_part(w.sig, '(', 1) ||
                  case when p.oid is null then ' MISSING' else '' end,
                  ', ' order by w.sig) as detail
  from want w
  left join pg_proc p on p.oid = to_regprocedure(w.sig);

-- 1m  Every definer spine body, public or private, pins its search_path.
--     Twenty-seven of them: eighteen private plus the nine wrappers.
select 'spine_definer_bodies_pin_search_path' as check_name,
       count(*) = 27
   and count(*) filter (
         where coalesce(array_to_string(p.proconfig, ','), '')
               like '%search\_path=%') = 27 as pass,
       coalesce(nullif(string_agg(n.nspname || '.' || p.proname, ', ') filter (
                  where coalesce(array_to_string(p.proconfig, ','), '')
                        not like '%search\_path=%'), ''),
                count(*) || ' definer bodies, all pinned') as detail
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where p.proname like '%spine%'
   and n.nspname in ('public', 'private')
   and p.prosecdef;

-- 1n  The vocabulary functions answer. These are IMMUTABLE and take a text, so
--     they can be exercised by calling them -- no rows, no session, no scope.
--     The case-sensitivity checks matter: 'crm' is not a stage and 'Booking' is
--     not a subject, and nothing in this schema folds case for either, so a
--     client that lower-cases its enums gets a 23514 rather than a silent miss.
select 'spine_vocabulary_functions_answer' as check_name,
       (select count(*) filter (where private.spine_stage_ok(t.s))
          from unnest(array['CRM','OPERATIONS','DMS','ACCOUNTING','BI','MODELING',
                            'PLANNING','SIMULATION','DECISION','APPROVAL',
                            'EXECUTION','AUDIT']) as t(s)) = 12
   and not private.spine_stage_ok('crm')
   and not private.spine_stage_ok('NOWHERE')
   and not private.spine_stage_ok(null)
   and (select count(*) filter (where private.spine_subject_target(t.s) is not null)
          from unnest(array['pilgrim','booking','group','package','visa',
                            'external_operation','crm_customer','crm_opportunity',
                            'crm_quote','crm_activity','crm_campaign','invoice',
                            'payment','supplier','supplier_bill','journal_entry',
                            'bank_transaction','contract','hotel_contract',
                            'dms_document','close_task','fiscal_period',
                            'modeling_model','bi_dashboard','staff_profile'])
               as t(s)) = 25
   and private.spine_subject_target('staff_profile')
       = array['staff_profiles','user_id']
   and private.spine_subject_target('booking') = array['bookings','id']
   and private.spine_subject_target('Booking') is null
   and private.spine_subject_target('not_a_thing') is null
   and private.spine_subject_target(null) is null
   and cardinality(private.spine_status_next('OPEN')) = 4
   and cardinality(private.spine_status_next('ACCEPTED')) = 3
   and cardinality(private.spine_status_next('DONE')) = 0
   and cardinality(private.spine_status_next('DECLINED')) = 0
   and cardinality(private.spine_status_next('SUPERSEDED')) = 0
   and private.spine_status_next('NOPE') is null
   and private.spine_role_ok('GUIDE')
   and private.spine_role_ok(null)
   and not private.spine_role_ok('SUPERVISOR') as pass,
       '12 stages, 25 subjects, 3 terminal statuses, 7 roles' as detail;

-- 1o  The twenty-two named constraints, present and validated. Names are load
--     bearing here: Part 2 asserts refusals by SQLSTATE, and 23514 only tells
--     you a CHECK fired, so the constraint that fired has to be identifiable.
with want(tbl, con, kind) as (values
  ('spine_chains',        'spine_chains_title_present',         'c'),
  ('spine_chains',        'spine_chains_subject_known',         'c'),
  ('spine_chains',        'spine_chains_origin_stage_known',    'c'),
  ('spine_chains',        'spine_chains_current_stage_known',   'c'),
  ('spine_chains',        'spine_chains_status_known',          'c'),
  ('spine_chains',        'spine_chains_priority_known',        'c'),
  ('spine_chains',        'spine_chains_closure_consistent',    'c'),
  ('spine_handoffs',      'spine_handoffs_seq_positive',        'c'),
  ('spine_handoffs',      'spine_handoffs_seq_unique',          'u'),
  ('spine_handoffs',      'spine_handoffs_title_present',       'c'),
  ('spine_handoffs',      'spine_handoffs_from_known',          'c'),
  ('spine_handoffs',      'spine_handoffs_to_known',            'c'),
  ('spine_handoffs',      'spine_handoffs_crosses',             'c'),
  ('spine_handoffs',      'spine_handoffs_intent_known',        'c'),
  ('spine_handoffs',      'spine_handoffs_subject_known',       'c'),
  ('spine_handoffs',      'spine_handoffs_status_known',        'c'),
  ('spine_handoffs',      'spine_handoffs_role_known',          'c'),
  ('spine_handoffs',      'spine_handoffs_payload_object',      'c'),
  ('spine_handoffs',      'spine_handoffs_not_self_parent',     'c'),
  ('spine_handoffs',      'spine_handoffs_decision_consistent', 'c'),
  ('spine_handoff_events','spine_events_action_known',          'c'),
  ('spine_handoff_events','spine_events_detail_object',         'c'))
select 'spine_constraints_named_and_validated' as check_name,
       count(k.oid) = 22
   and count(*) filter (where k.contype = w.kind and k.convalidated) = 22
       as pass,
       coalesce(nullif(string_agg(w.con, ', ') filter (
                  where k.oid is null or k.contype <> w.kind
                     or not k.convalidated), ''),
                'all 22 present, right kind, validated') as detail
  from want w
  left join pg_constraint k
    on k.conrelid = to_regclass('public.' || w.tbl)
   and k.conname = w.con;

-- 1p  Eleven indexes, and exactly the two that should be partial are partial.
--     indpred is the WHERE of a partial index: idx_spine_chains_open and
--     idx_spine_handoffs_queue exist to keep the live set small, so if either
--     lost its predicate it would still answer queries and quietly stop being
--     the thing it was built for.
with want(name, partial) as (values
  ('idx_spine_chains_scope',    false),
  ('idx_spine_chains_subject',  false),
  ('idx_spine_chains_open',     true),
  ('idx_spine_handoffs_chain',  false),
  ('idx_spine_handoffs_parent', false),
  ('idx_spine_handoffs_subject',false),
  ('idx_spine_handoffs_scope',  false),
  ('idx_spine_handoffs_queue',  true),
  ('idx_spine_events_handoff',  false),
  ('idx_spine_events_chain',    false),
  ('idx_spine_events_scope',    false))
select 'spine_indexes_present_two_partial' as check_name,
       count(c.oid) = 11
   and count(*) filter (where c.relkind = 'i') = 11
   and count(*) filter (where (i.indpred is not null) = w.partial) = 11 as pass,
       coalesce(nullif(string_agg(w.name, ', ') filter (
                  where c.oid is null
                     or (i.indpred is not null) is distinct from w.partial), ''),
                '11 indexes, 2 partial') as detail
  from want w
  left join pg_class c on c.oid = to_regclass('public.' || w.name)
  left join pg_index i on i.indexrelid = c.oid;

-- 1q  The four foreign keys and their delete actions. This is the difference
--     between deleting a chain and deleting its history: chain_id and
--     handoff_id cascade so a removed chain takes its handoffs and events with
--     it, while parent_id sets null so retiring one step does not delete the
--     steps that were spawned from it. 'c' is CASCADE, 'n' is SET NULL.
with want(tbl, col, ref, del) as (values
  ('spine_handoffs',      'chain_id',  'spine_chains',   'c'),
  ('spine_handoffs',      'parent_id', 'spine_handoffs', 'n'),
  ('spine_handoff_events','handoff_id','spine_handoffs', 'c'),
  ('spine_handoff_events','chain_id',  'spine_chains',   'c'))
select 'spine_foreign_keys_act_as_designed' as check_name,
       count(k.oid) = 4
   and count(*) filter (
         where k.confrelid = to_regclass('public.' || w.ref)
           and k.confdeltype = w.del) = 4 as pass,
       coalesce(string_agg(w.tbl || '.' || w.col || ' -> ' ||
                           coalesce(k.confdeltype, '?'), ', '
                           order by w.tbl, w.col), 'no spine foreign keys')
       as detail
  from want w
  left join pg_constraint k
    on k.conrelid = to_regclass('public.' || w.tbl)
   and k.contype = 'f'
   and pg_get_constraintdef(k.oid) like 'FOREIGN KEY (' || w.col || ')%';

-- 1r  The RBAC matrix Section G seeds is exactly 48 rows: six non-ADMIN roles by
--     three resources by three actions, less the six the ledger does not take an
--     update for. No `delete` for anyone and no ADMIN row at all -- ADMIN needs
--     neither, because has_permission() short-circuits true for it, which is
--     also why Part 2 seeds a FINANCE profile rather than an ADMIN one when it
--     wants the permission checks to actually run.
select 'spine_permission_matrix_is_exactly_48' as check_name,
       count(*) = 48
   and count(distinct sp.role) = 6
   and count(*) filter (where sp.role = 'ADMIN') = 0
   and count(*) filter (where sp.action = 'delete') = 0
   and count(*) filter (where sp.resource = 'spine_chains') = 18
   and count(*) filter (where sp.resource = 'spine_handoffs') = 18
   and count(*) filter (where sp.resource = 'spine_handoff_events') = 12
   and count(*) filter (where sp.resource = 'spine_handoff_events'
                          and sp.action = 'update') = 0 as pass,
       count(*) || ' rows over ' || count(distinct sp.role) || ' roles: ' ||
       coalesce(string_agg(distinct sp.action, '/'), 'none') as detail
  from public.staff_permissions sp
 where sp.resource in ('spine_chains', 'spine_handoffs',
                       'spine_handoff_events');

-- 1s  The ledger's column set, closed in both directions. Twelve columns, and
--     the timestamp is `at` -- there is no created_at and no updated_at on this
--     table. That is not pedantry: private.spine_chain() projects the event rows
--     by name, and PL/pgSQL resolves a column name at first execution rather
--     than at install time, so `ev.created_at` would install perfectly and then
--     raise 42703 on every single get_spine_chain() call. This check is the
--     static half of that guarantee; step 2k is the half that runs it.
with actual(name) as (
  select a.attname from pg_attribute a
   where a.attrelid = to_regclass('public.spine_handoff_events')
     and a.attnum > 0 and not a.attisdropped),
expected(name) as (values
  ('id'), ('handoff_id'), ('chain_id'), ('agency_id'), ('branch_id'),
  ('action'), ('from_status'), ('to_status'), ('actor'), ('actor_email'),
  ('detail'), ('at'))
select 'spine_event_columns_closed_both_ways' as check_name,
       (select count(*) from actual) = 12
   and not exists (select name from expected except select name from actual)
   and not exists (select name from actual except select name from expected)
       as pass,
       coalesce((select string_agg(name, ', ' order by name) from actual),
                'spine_handoff_events does not exist') as detail;

-- 1t  Every column the wrappers, the reads and this suite name on the other two
--     tables. Presence, not closure: a later migration is free to add a column
--     to a chain, but not to remove one of these without breaking a body that
--     already projects it.
with want(tbl, col) as (values
  ('spine_chains','id'), ('spine_chains','agency_id'),
  ('spine_chains','branch_id'), ('spine_chains','title'),
  ('spine_chains','title_ar'), ('spine_chains','subject_type'),
  ('spine_chains','subject_id'), ('spine_chains','origin_stage'),
  ('spine_chains','current_stage'), ('spine_chains','status'),
  ('spine_chains','priority'), ('spine_chains','opened_by'),
  ('spine_chains','opened_at'), ('spine_chains','closed_by'),
  ('spine_chains','closed_at'), ('spine_chains','closed_note'),
  ('spine_chains','created_at'), ('spine_chains','updated_at'),
  ('spine_handoffs','id'), ('spine_handoffs','chain_id'),
  ('spine_handoffs','parent_id'), ('spine_handoffs','seq'),
  ('spine_handoffs','agency_id'), ('spine_handoffs','branch_id'),
  ('spine_handoffs','from_stage'), ('spine_handoffs','to_stage'),
  ('spine_handoffs','intent'), ('spine_handoffs','subject_type'),
  ('spine_handoffs','subject_id'), ('spine_handoffs','title'),
  ('spine_handoffs','title_ar'), ('spine_handoffs','note'),
  ('spine_handoffs','payload'), ('spine_handoffs','status'),
  ('spine_handoffs','assigned_role'), ('spine_handoffs','assigned_to'),
  ('spine_handoffs','due_on'), ('spine_handoffs','opened_by'),
  ('spine_handoffs','opened_at'), ('spine_handoffs','decided_by'),
  ('spine_handoffs','decided_at'), ('spine_handoffs','decided_note'),
  ('spine_handoffs','created_at'), ('spine_handoffs','updated_at'))
select 'spine_chain_and_handoff_columns_present' as check_name,
       count(a.attname) = 44 as pass,
       coalesce(nullif(string_agg(w.tbl || '.' || w.col, ', ')
                       filter (where a.attname is null), ''),
                '44 columns present') as detail
  from want w
  left join pg_attribute a
    on a.attrelid = to_regclass('public.' || w.tbl)
   and a.attname = w.col
   and a.attnum > 0
   and not a.attisdropped;

-- PART 2 ---------------------------------------------------------------------
-- The lifecycle. One transaction, rolled back at the end, driven through the
-- nine public wrappers. Failures here raise rather than report: psql runs with
-- ON_ERROR_STOP=1, so a raise aborts the file with a nonzero exit and the gate
-- fails. That is the intended reporting channel for a lifecycle -- a verdict
-- column would have to be threaded through twenty steps to say the same thing.

begin;

-- A refusal that is not asserted by SQLSTATE is not asserted at all: a probe
-- that swallows `whatever went wrong` passes when the statement failed for an
-- unrelated reason, which is the failure mode this file exists to avoid. The
-- helper also fails loudly when nothing was raised at all, because a silent
-- success is the worst outcome of an expected-failure test.
create or replace function pg_temp.spine_refuses(p_sql text, p_state text,
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

-- The one place this suite reads a message rather than a state. Requirement 8
-- is that the refusal names how many handoffs are still open, and no SQLSTATE
-- can carry a count, so the count has to come out of the text.
create or replace function pg_temp.spine_refuses_saying(p_sql text, p_state text,
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

-- auth.uid() is NULL in a psql session, and NULL is the caller every guard in
-- this schema is written to refuse. So the suite becomes somebody: the claim is
-- set transaction-locally, which is why it cannot outlive the rollback, and the
-- helper then checks that auth.uid() really moved. `is distinct from` rather
-- than `<>` on purpose -- if the claim had not taken, auth.uid() would be NULL,
-- `NULL <> v_id` would be NULL, and `if NULL then` does not raise. That is the
-- exact shape 20260830140000 was written to remove from this schema; a test
-- helper is not exempt from it.
create or replace function pg_temp.spine_become(p_email text)
returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then
    raise exception 'no suite account %', p_email;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from v_id then
    raise exception 'the simulated session did not take: auth.uid() is %',
      coalesce(auth.uid()::text, 'NULL');
  end if;
  return v_id;
end $fn$;

-- Read back through the tables rather than trusting the jsonb a command
-- returned: a command that reported success and wrote nothing would otherwise
-- pass its own assertions.
create or replace function pg_temp.spine_stage_of(p_chain uuid)
returns text language sql as $fn$
  select current_stage from public.spine_chains where id = p_chain;
$fn$;

create or replace function pg_temp.spine_status_of(p_handoff uuid)
returns text language sql as $fn$
  select status from public.spine_handoffs where id = p_handoff;
$fn$;

create or replace function pg_temp.spine_events_on(p_chain uuid, p_action text)
returns integer language sql as $fn$
  select count(*)::integer from public.spine_handoff_events
   where chain_id = p_chain and action = p_action;
$fn$;

-- 2a  Two disposable accounts in the DEFAULT agency's HQ branch. FINANCE drives
--     the lifecycle and GUIDE exists so that step 2r can prove a permission is
--     required by a session whose scope is provably in range. Neither is ADMIN:
--     has_permission() short-circuits true for ADMIN, so an ADMIN profile would
--     satisfy every guard in the schema without consulting one RBAC row, and
--     every 42501 assertion in this file would become unreachable.
do $step$
declare
  v_agency uuid;
  v_branch uuid;
  v_fin    uuid := '0f5e1c00-0000-4000-8000-000000000001';
  v_gde    uuid := '0f5e1c00-0000-4000-8000-000000000002';
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
    (v_fin, 'spine-suite-finance@invalid.test'),
    (v_gde, 'spine-suite-guide@invalid.test');

  insert into public.staff_profiles(user_id, role, agency_id, branch_uuid,
                                    branch_id, is_active)
  values (v_fin, 'FINANCE', v_agency, v_branch, v_branch::text, true),
         (v_gde, 'GUIDE',   v_agency, v_branch, v_branch::text, true);

  if pg_temp.spine_become('spine-suite-finance@invalid.test') <> v_fin then
    raise exception 'the FINANCE session resolved to the wrong uuid';
  end if;
  raise notice '2a ok: agency %, branch %, FINANCE and GUIDE seeded', v_agency, v_branch;
end $step$;

-- 2b  The session is genuinely non-ADMIN and the matrix answers as Section G
--     seeded it. Without this, a later 42501 could be a scope failure wearing a
--     permission failure's SQLSTATE, and the two are indistinguishable by state
--     alone. Note the deliberate hole: nobody holds update on the ledger, and
--     nobody holds delete on anything.
do $step$
declare
  v_agency uuid;
  v_branch uuid;
  v_fin    uuid;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select agency_id, branch_uuid into v_agency, v_branch
    from public.staff_profiles where user_id = v_fin;

  if public.staff_role() <> 'FINANCE' then
    raise exception 'staff_role() is % for the suite session, not FINANCE',
      public.staff_role();
  end if;
  if not (public.has_permission('spine_chains','read')
      and public.has_permission('spine_chains','create')
      and public.has_permission('spine_chains','update')
      and public.has_permission('spine_handoffs','read')
      and public.has_permission('spine_handoffs','create')
      and public.has_permission('spine_handoffs','update')
      and public.has_permission('spine_handoff_events','read')
      and public.has_permission('spine_handoff_events','create')) then
    raise exception 'FINANCE is missing one of the eight spine permissions Section G seeds';
  end if;
  if public.has_permission('spine_handoff_events','update')
     or public.has_permission('spine_chains','delete')
     or public.has_permission('spine_handoffs','delete')
     or public.has_permission('spine_handoff_events','delete') then
    raise exception 'the matrix granted a spine permission Section G deliberately withholds';
  end if;
  if not public.row_in_staff_scope(v_agency, v_branch) then
    raise exception 'the suite session is out of scope on its own agency and branch';
  end if;
  if public.row_in_staff_scope('00000000-0000-4000-8000-00000000ffff', v_branch) then
    raise exception 'row_in_staff_scope() admitted a foreign agency';
  end if;
  raise notice '2b ok: FINANCE holds read/create/update, not delete, not events.update';
end $step$;

-- 2c  REQUIREMENT 1. A chain opens at its origin stage. current_stage is derived
--     from here on -- a trigger owns it -- so the only moment it is set by hand
--     is this one, and if it disagreed with origin_stage the whole derivation
--     would start from the wrong place. The trimmed title is asserted too,
--     because every later step re-reads the chain by that exact title.
do $step$
declare
  v_fin   uuid;
  v_out   jsonb;
  v_chain uuid;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');

  v_out := public.open_spine_chain_command(
    p_title        => '  spine suite chain A  ',
    p_subject_type => 'staff_profile',
    p_subject_id   => v_fin,
    p_origin_stage => 'CRM');

  v_chain := (v_out->>'id')::uuid;
  if v_out->>'origin_stage' <> 'CRM' then
    raise exception 'the chain opened at origin stage %', v_out->>'origin_stage';
  end if;
  if v_out->>'current_stage' is distinct from v_out->>'origin_stage' then
    raise exception 'current_stage % does not equal origin_stage % at open',
      v_out->>'current_stage', v_out->>'origin_stage';
  end if;
  if v_out->>'title' <> 'spine suite chain A' then
    raise exception 'the title was stored as "%" -- btrim did not run',
      v_out->>'title';
  end if;
  if v_out->>'status' <> 'OPEN' or v_out->>'priority' <> 'NORMAL'
     or v_out->>'title_ar' is not null
     or v_out->>'closed_at' is not null
     or v_out->>'closed_note' <> '' then
    raise exception 'a freshly opened chain is not in its documented state: %',
      v_out::text;
  end if;
  if v_out->>'opened_by' is distinct from v_fin::text then
    raise exception 'opened_by is % rather than the session uuid %',
      v_out->>'opened_by', v_fin;
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'CRM' then
    raise exception 'the stored row says stage %, not CRM',
      pg_temp.spine_stage_of(v_chain);
  end if;
  raise notice '2c ok: chain A open at CRM, current_stage = origin_stage';
end $step$;

-- 2d  REQUIREMENTS 2 and 3. The first handoff on a chain takes seq 1, and it
--     inherits the chain's subject because the caller said nothing about one.
--     The OPENED event is asserted here in full -- actor, actor_email, the null
--     from_status of a handoff that did not exist a moment ago, and the intent
--     and destination carried in `detail` -- because this is the only step where
--     the ledger's first row can be identified without ambiguity.
do $step$
declare
  v_fin     uuid;
  v_chain   uuid;
  v_subject uuid;
  v_out     jsonb;
  v_h1      uuid;
  v_ev      public.spine_handoff_events;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id, subject_id into v_chain, v_subject
    from public.spine_chains where title = 'spine suite chain A';

  v_out := public.open_spine_handoff_command(
    p_chain_id   => v_chain,
    p_from_stage => 'CRM',
    p_to_stage   => 'OPERATIONS',
    p_intent     => 'REVIEW',
    p_title      => 'suite h1 review',
    p_note       => 'first look');

  v_h1 := (v_out->>'id')::uuid;
  if (v_out->>'seq')::integer <> 1 then
    raise exception 'the first handoff took seq %', v_out->>'seq';
  end if;
  if v_out->>'subject_type' <> 'staff_profile'
     or (v_out->>'subject_id')::uuid <> v_subject then
    raise exception 'the handoff did not inherit the chain subject: % / %',
      v_out->>'subject_type', v_out->>'subject_id';
  end if;
  if v_out->>'status' <> 'OPEN' or v_out->>'from_stage' <> 'CRM'
     or v_out->>'to_stage' <> 'OPERATIONS' or v_out->>'intent' <> 'REVIEW'
     or v_out->>'note' <> 'first look'
     or v_out->'payload' <> '{}'::jsonb
     or v_out->>'assigned_to' is not null
     or v_out->>'assigned_role' is not null
     or v_out->>'decided_at' is not null
     or v_out->>'opened_by' is distinct from v_fin::text then
    raise exception 'a freshly opened handoff is not in its documented state: %',
      v_out::text;
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'OPERATIONS' then
    raise exception 'opening a handoff left the chain at stage %',
      pg_temp.spine_stage_of(v_chain);
  end if;

  if (select count(*) from public.spine_handoff_events
       where handoff_id = v_h1) <> 1 then
    raise exception 'opening one handoff wrote % events',
      (select count(*) from public.spine_handoff_events where handoff_id = v_h1);
  end if;
  select * into v_ev from public.spine_handoff_events where handoff_id = v_h1;
  if v_ev.action <> 'OPENED' or v_ev.from_status is not null
     or v_ev.to_status <> 'OPEN' or v_ev.chain_id <> v_chain
     or v_ev.actor is distinct from v_fin
     or v_ev.actor_email <> 'spine-suite-finance@invalid.test'
     or v_ev.at is null
     or v_ev.detail->>'intent' <> 'REVIEW'
     or v_ev.detail->>'to_stage' <> 'OPERATIONS' then
    raise exception 'the OPENED event is wrong: action %, % -> %, actor %, email %, detail %',
      v_ev.action, coalesce(v_ev.from_status,'NULL'), v_ev.to_status,
      coalesce(v_ev.actor::text,'NULL'), v_ev.actor_email, v_ev.detail::text;
  end if;
  raise notice '2d ok: seq 1, subject inherited, one OPENED event, stage OPERATIONS';
end $step$;

-- 2e  REQUIREMENT 2, second half. A second handoff on the same chain takes seq 2.
--     The allocation is `coalesce(max(seq), 0) + 1` over the chain, so the only way
--     to see whether it is scoped to the chain rather than global is to open a
--     handoff on a second chain later and find it also starting at 1 -- step 2l
--     does that.
--
--     This handoff also passes its subject explicitly, which is the other side of
--     2d: the same two coalesce arms, this time taking the caller's value. The
--     type given is 'staff_profile' again, and deliberately so -- see the report's
--     note. `staff_profiles` is the only subject table this suite can guarantee a
--     row in, since it creates its own; every other one of the twenty-five arms
--     points at a table whose NOT NULL columns this file has no business seeding.
--     The subject_id is the GUIDE's, which differs from the chain's, so the
--     override is still observable.
do $step$
declare
  v_fin     uuid;
  v_gde     uuid;
  v_chain   uuid;
  v_out     jsonb;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_gde from auth.users where email = 'spine-suite-guide@invalid.test';
  select id into v_chain from public.spine_chains where title = 'spine suite chain A';

  v_out := public.open_spine_handoff_command(
    p_chain_id      => v_chain,
    p_from_stage    => 'OPERATIONS',
    p_to_stage      => 'DMS',
    p_intent        => 'DOCUMENT',
    p_title         => 'suite h2 document',
    p_subject_type  => 'staff_profile',
    p_subject_id    => v_gde,
    p_assigned_role => 'GUIDE',
    p_priority      => 'HIGH',
    p_payload       => jsonb_build_object('why', 'suite'));

  if (v_out->>'seq')::integer <> 2 then
    raise exception 'the second handoff on the chain took seq %, not 2',
      v_out->>'seq';
  end if;
  if (v_out->>'subject_id')::uuid <> v_gde then
    raise exception 'the explicit subject_id was overwritten with %',
      v_out->>'subject_id';
  end if;
  if v_out->>'assigned_role' <> 'GUIDE' or v_out->>'priority' <> 'HIGH'
     or v_out->'payload' <> jsonb_build_object('why', 'suite') then
    raise exception 'the handoff did not keep role/priority/payload: %',
      v_out::text;
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'DMS' then
    raise exception 'the chain sits at % after a second handoff opened to DMS',
      pg_temp.spine_stage_of(v_chain);
  end if;
  raise notice '2e ok: seq 2, explicit subject kept, stage followed to DMS';
end $step$;

-- 2f  REQUIREMENT 4. OPEN -> ACCEPTED, and the row records who took it. There is
--     no `accepted_by` column: `private.spine_accept_handoff` writes
--     `assigned_to = coalesce(h.assigned_to, auth.uid())`, so on a handoff nobody
--     was named on, accepting it is what names you. That is the column this step
--     asserts, and the ACCEPTED event carries the same actor independently.
--
--     Accepting does not touch the chain's stage. h1 is not the newest live
--     handoff -- h2 is -- and even if it were, the stage follows completions and
--     declines, not acceptances. The assertion that DMS is unchanged is the point,
--     not an afterthought.
do $step$
declare
  v_fin   uuid;
  v_chain uuid;
  v_h1    uuid;
  v_out   jsonb;
  v_ev    public.spine_handoff_events;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_chain from public.spine_chains where title = 'spine suite chain A';
  select id into v_h1 from public.spine_handoffs
   where chain_id = v_chain and seq = 1;

  if pg_temp.spine_status_of(v_h1) <> 'OPEN' then
    raise exception 'h1 was % before the accept', pg_temp.spine_status_of(v_h1);
  end if;

  v_out := public.accept_spine_handoff_command(v_h1);

  if v_out->>'status' <> 'ACCEPTED' then
    raise exception 'accepting an OPEN handoff produced status %',
      v_out->>'status';
  end if;
  if (v_out->>'assigned_to')::uuid is distinct from v_fin then
    raise exception 'the accept did not record who: assigned_to is %',
      coalesce(v_out->>'assigned_to', 'NULL');
  end if;
  if v_out->>'decided_at' is not null or v_out->>'decided_by' is not null then
    raise exception 'accepting a handoff decided it: % / %',
      v_out->>'decided_at', v_out->>'decided_by';
  end if;
  if pg_temp.spine_status_of(v_h1) <> 'ACCEPTED' then
    raise exception 'the stored h1 row says %', pg_temp.spine_status_of(v_h1);
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'DMS' then
    raise exception 'accepting h1 moved the chain to %',
      pg_temp.spine_stage_of(v_chain);
  end if;

  select * into v_ev from public.spine_handoff_events
   where handoff_id = v_h1 and action = 'ACCEPTED';
  if v_ev.from_status <> 'OPEN' or v_ev.to_status <> 'ACCEPTED'
     or v_ev.actor is distinct from v_fin or v_ev.at is null then
    raise exception 'the ACCEPTED event is wrong: % -> %, actor %',
      coalesce(v_ev.from_status,'NULL'), coalesce(v_ev.to_status,'NULL'),
      coalesce(v_ev.actor::text,'NULL');
  end if;
  raise notice '2f ok: OPEN -> ACCEPTED, assigned_to recorded, stage unmoved';
end $step$;

-- 2g  REQUIREMENT 5, and the place where the brief's phrasing does not survive
--     contact with the migration. "complete moves ACCEPTED -> DONE and advances
--     the chain's current_stage to the handoff's to_stage" is true only when the
--     completed handoff is the chain's newest live one, because
--     `private.spine_sync_chain_stage` does not look at the row that changed. It
--     recomputes from the chain: newest live handoff by `seq desc`, else newest
--     DONE by `seq desc`, else `origin_stage`.
--
--     So this step proves both halves, in the order that makes the difference
--     visible. h1 (seq 1, -> OPERATIONS) is completed while h2 (seq 2, -> DMS) is
--     still open: the status moves, and the stage stays at DMS rather than going
--     back to OPERATIONS. Then h2, the last live handoff, is completed: now the
--     chain has nothing live, the newest DONE by seq is h2, and current_stage is
--     h2.to_stage -- which is the case the requirement was written for.
--
--     Completing h2 also drives OPEN -> DONE directly, without an accept. The
--     status machine allows it deliberately (E.3), so a handoff that only needed
--     doing does not need a two-click formality first.
do $step$
declare
  v_fin   uuid;
  v_chain uuid;
  v_h1    uuid;
  v_h2    uuid;
  v_out   jsonb;
  v_ev    public.spine_handoff_events;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_chain from public.spine_chains where title = 'spine suite chain A';
  select id into v_h1 from public.spine_handoffs where chain_id = v_chain and seq = 1;
  select id into v_h2 from public.spine_handoffs where chain_id = v_chain and seq = 2;

  v_out := public.complete_spine_handoff_command(v_h1, '  done with h1  ');

  if v_out->>'status' <> 'DONE' then
    raise exception 'completing an ACCEPTED handoff produced status %',
      v_out->>'status';
  end if;
  if (v_out->>'decided_by')::uuid is distinct from v_fin
     or v_out->>'decided_at' is null
     or v_out->>'decided_note' <> 'done with h1' then
    raise exception 'the completion did not record who/when/why: %', v_out::text;
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'DMS' then
    raise exception 'completing h1 moved the chain to %, but h2 is still live',
      pg_temp.spine_stage_of(v_chain);
  end if;
  select * into v_ev from public.spine_handoff_events
   where handoff_id = v_h1 and action = 'COMPLETED';
  if v_ev.from_status <> 'ACCEPTED' or v_ev.to_status <> 'DONE'
     or v_ev.at is null or v_ev.detail->>'note' <> 'done with h1' then
    raise exception 'the COMPLETED event for h1 is wrong: % -> %, detail %',
      coalesce(v_ev.from_status,'NULL'), coalesce(v_ev.to_status,'NULL'),
      coalesce(v_ev.detail::text,'NULL');
  end if;

  v_out := public.complete_spine_handoff_command(v_h2);

  if v_out->>'status' <> 'DONE' or v_out->>'decided_note' <> '' then
    raise exception 'completing an OPEN handoff produced % / note "%"',
      v_out->>'status', v_out->>'decided_note';
  end if;
  if (select count(*) from public.spine_handoffs
       where chain_id = v_chain and status in ('OPEN', 'ACCEPTED')) <> 0 then
    raise exception 'the chain still has live handoffs after both completed';
  end if;
  if pg_temp.spine_stage_of(v_chain) is distinct from v_out->>'to_stage' then
    raise exception 'with nothing live, the chain sits at % rather than at h2.to_stage %',
      pg_temp.spine_stage_of(v_chain), v_out->>'to_stage';
  end if;
  select * into v_ev from public.spine_handoff_events
   where handoff_id = v_h2 and action = 'COMPLETED';
  if v_ev.from_status <> 'OPEN' or v_ev.to_status <> 'DONE' then
    raise exception 'the COMPLETED event for h2 recorded % -> %',
      coalesce(v_ev.from_status,'NULL'), coalesce(v_ev.to_status,'NULL');
  end if;
  raise notice '2g ok: ACCEPTED -> DONE and OPEN -> DONE; stage is the last live edge, not the completed one';
end $step$;

-- 2h  A third handoff, so the chain has something live again and 2i has a stage to
--     fall back FROM. Opening it is also the second half of the seq assertion made
--     in 2e: seq 3 on a chain whose first two are terminal proves the allocator
--     reads max(seq), not a count of live rows.
do $step$
declare
  v_fin   uuid;
  v_chain uuid;
  v_out   jsonb;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_chain from public.spine_chains where title = 'spine suite chain A';

  v_out := public.open_spine_handoff_command(
    p_chain_id   => v_chain,
    p_from_stage => 'DMS',
    p_to_stage   => 'ACCOUNTING',
    p_intent     => 'RECORD',
    p_title      => 'suite h3 record',
    p_due_on     => current_date + 3);

  if (v_out->>'seq')::integer <> 3 then
    raise exception 'the third handoff took seq %, not 3', v_out->>'seq';
  end if;
  if (v_out->>'due_on')::date <> current_date + 3 then
    raise exception 'due_on came back as %', v_out->>'due_on';
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'ACCOUNTING' then
    raise exception 'the chain sits at % after opening a handoff to ACCOUNTING',
      pg_temp.spine_stage_of(v_chain);
  end if;
  raise notice '2h ok: seq 3 allocated from max(seq), stage ACCOUNTING';
end $step$;

-- 2i  REQUIREMENT 6. OPEN -> DECLINED, and the reason is not optional. It is
--     refused twice over, at two different layers, and both are proven here:
--
--       * `public.decline_spine_handoff_command` has no DEFAULT on p_note, so a
--         one-argument call does not resolve to a function at all -- 42883, from
--         the parser, before any body runs. That is what a PostgREST client sees.
--       * a call that does pass a note, but a blank or whitespace one, reaches
--         `private.spine_decline_handoff` and is refused there with 22023. Null is
--         the same case: the body folds it through btrim(coalesce(p_note, '')).
--
--     The real decline then does what 2g set up: with h1 and h2 DONE and h3 no
--     longer live, the chain has nothing live at all, so the stage falls back to
--     the newest DONE by seq -- h2, at DMS. This is the only assertion in the
--     suite where the second branch of the coalesce in spine_sync_chain_stage
--     visibly moves the value, ACCOUNTING back down to DMS.
do $step$
declare
  v_fin   uuid;
  v_chain uuid;
  v_h3    uuid;
  v_out   jsonb;
  v_ev    public.spine_handoff_events;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_chain from public.spine_chains where title = 'spine suite chain A';
  select id into v_h3 from public.spine_handoffs where chain_id = v_chain and seq = 3;

  perform pg_temp.spine_refuses(
    format($q$select public.decline_spine_handoff_command(%L::uuid)$q$, v_h3),
    '42883', 'declining with no note argument at all');
  perform pg_temp.spine_refuses(
    format($q$select public.decline_spine_handoff_command(%L::uuid, '   ')$q$, v_h3),
    '22023', 'declining with a whitespace note');
  perform pg_temp.spine_refuses(
    format($q$select public.decline_spine_handoff_command(%L::uuid, null)$q$, v_h3),
    '22023', 'declining with a null note');

  if pg_temp.spine_status_of(v_h3) <> 'OPEN' then
    raise exception 'the refused declines changed h3 to %',
      pg_temp.spine_status_of(v_h3);
  end if;

  v_out := public.decline_spine_handoff_command(v_h3, '  not my ledger  ');

  if v_out->>'status' <> 'DECLINED' then
    raise exception 'declining an OPEN handoff produced status %',
      v_out->>'status';
  end if;
  if v_out->>'decided_note' <> 'not my ledger'
     or (v_out->>'decided_by')::uuid is distinct from v_fin
     or v_out->>'decided_at' is null then
    raise exception 'the decline did not record why/who/when: %', v_out::text;
  end if;
  select * into v_ev from public.spine_handoff_events
   where handoff_id = v_h3 and action = 'DECLINED';
  if v_ev.from_status <> 'OPEN' or v_ev.to_status <> 'DECLINED'
     or v_ev.detail->>'note' <> 'not my ledger' then
    raise exception 'the DECLINED event is wrong: % -> %, detail %',
      coalesce(v_ev.from_status,'NULL'), coalesce(v_ev.to_status,'NULL'),
      coalesce(v_ev.detail::text,'NULL');
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'DMS' then
    raise exception 'with nothing live, the chain should fall back to h2 at DMS; it is at %',
      pg_temp.spine_stage_of(v_chain);
  end if;
  raise notice '2i ok: a note is required twice over (42883, 22023); DECLINED, stage fell back to DMS';
end $step$;

-- 2j  REQUIREMENT 7. The status machine refuses illegal transitions, and it is
--     asked directly rather than only through the commands, because the commands
--     never get that far. `private.spine_guard_handoff(..., p_require_live => true)`
--     rejects a terminal handoff with 22023 before any UPDATE is attempted, so a
--     wrapper probe proves the guard, not the trigger. Both matter, so both are
--     here:
--
--       * through the wrappers: completing a DONE handoff and accepting a DECLINED
--         one, each 22023 from the guard's liveness test.
--       * directly against the table: DONE -> OPEN, which is the transition the
--         guard would never let a command attempt and the one that would make the
--         event ledger a record of something that did not happen. 22023 from
--         `trg_spine_handoffs_status`, whose successor list for DONE is empty.
--
--     The direct UPDATE is one of exactly two deliberate direct writes in this
--     file (the other is 2p's ledger probe), and it is a write that is *refused*.
--     A same-status UPDATE is then made to succeed, proving the trigger's early
--     `return new` when status does not change -- without which every touch of an
--     unrelated column on a terminal handoff would be refused.
do $step$
declare
  v_fin    uuid;
  v_chain  uuid;
  v_h2     uuid;
  v_h3     uuid;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_chain from public.spine_chains where title = 'spine suite chain A';
  select id into v_h2 from public.spine_handoffs where chain_id = v_chain and seq = 2;
  select id into v_h3 from public.spine_handoffs where chain_id = v_chain and seq = 3;

  perform pg_temp.spine_refuses(
    format($q$select public.complete_spine_handoff_command(%L::uuid)$q$, v_h2),
    '22023', 'completing a handoff that is already DONE');
  perform pg_temp.spine_refuses(
    format($q$select public.accept_spine_handoff_command(%L::uuid)$q$, v_h3),
    '22023', 'accepting a handoff that was DECLINED');
  perform pg_temp.spine_refuses(
    format($q$select public.decline_spine_handoff_command(%L::uuid, 'again')$q$, v_h3),
    '22023', 'declining a handoff that was already DECLINED');

  perform pg_temp.spine_refuses(
    format($q$update public.spine_handoffs set status = 'OPEN' where id = %L::uuid$q$,
      v_h2),
    '22023', 'reopening a DONE handoff by hand');
  perform pg_temp.spine_refuses(
    format($q$update public.spine_handoffs set status = 'ACCEPTED' where id = %L::uuid$q$,
      v_h3),
    '22023', 'moving a DECLINED handoff to ACCEPTED by hand');

  if pg_temp.spine_status_of(v_h2) <> 'DONE'
     or pg_temp.spine_status_of(v_h3) <> 'DECLINED' then
    raise exception 'a refused transition changed a status anyway: h2 %, h3 %',
      pg_temp.spine_status_of(v_h2), pg_temp.spine_status_of(v_h3);
  end if;

  update public.spine_handoffs set status = 'DONE', decided_note = 'same status'
   where id = v_h2;
  if pg_temp.spine_status_of(v_h2) <> 'DONE' then
    raise exception 'a same-status update left h2 at %',
      pg_temp.spine_status_of(v_h2);
  end if;
  if (select decided_note from public.spine_handoffs where id = v_h2)
       <> 'same status' then
    raise exception 'the same-status update did not take';
  end if;
  raise notice '2j ok: every illegal transition refused with 22023; a same-status update still allowed';
end $step$;

-- 2k  REQUIREMENT 12, the chain read -- and the regression test for a defect this
--     file was written alongside. `private.spine_chain` projects the event ledger
--     column by column, and it named `ev.created_at` for one revision. There is no
--     such column; the ledger's timestamp is `at`. PL/pgSQL resolves column names
--     when a body first executes rather than when it is created, so that migration
--     installed perfectly cleanly and raised 42703 on every single call. Nothing in
--     the catalogue can find that. Only calling it can.
--
--     So this step calls it, and asserts the shape it must come back with: the
--     three documented keys, a chain object, the handoffs in seq order, and an
--     events array that is not empty and whose every element carries a non-null
--     `at`. Check 1s pins the ledger's twelve column names from the other side, so
--     between them a rename cannot pass unnoticed in either direction.
--
--     The key counts are asserted too, because these two projections are narrower
--     than their tables on purpose -- no agency_id, no branch_id, no created_at or
--     updated_at, and no chain_id on an event that is already nested inside its
--     chain. A projection that silently widened would start returning tenancy
--     columns to a browser.
do $step$
declare
  v_fin    uuid;
  v_chain  uuid;
  v_doc    jsonb;
  v_keys   text[];
  v_events integer;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_chain from public.spine_chains where title = 'spine suite chain A';

  v_doc := public.get_spine_chain(v_chain);

  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_doc) k;
  if v_keys is distinct from array['chain', 'events', 'handoffs'] then
    raise exception 'get_spine_chain returned keys %', coalesce(v_keys::text, 'NULL');
  end if;
  if jsonb_typeof(v_doc->'chain') <> 'object'
     or jsonb_typeof(v_doc->'handoffs') <> 'array'
     or jsonb_typeof(v_doc->'events') <> 'array' then
    raise exception 'get_spine_chain returned types % / % / %',
      jsonb_typeof(v_doc->'chain'), jsonb_typeof(v_doc->'handoffs'),
      jsonb_typeof(v_doc->'events');
  end if;
  if (v_doc->'chain'->>'id')::uuid <> v_chain
     or v_doc->'chain'->>'current_stage' <> 'DMS'
     or v_doc->'chain'->>'status' <> 'OPEN' then
    raise exception 'the nested chain is wrong: %', (v_doc->'chain')::text;
  end if;

  -- Handoffs: three of them, in seq order. This is the suite's one positional
  -- assertion, and it is safe precisely because `seq` is unique per chain and the
  -- projection orders by it -- unlike the event and inbox orderings, which key on
  -- timestamps that are all identical inside one transaction.
  if jsonb_array_length(v_doc->'handoffs') <> 3 then
    raise exception 'the chain came back with % handoffs',
      jsonb_array_length(v_doc->'handoffs');
  end if;
  if (v_doc->'handoffs'->0->>'seq')::integer <> 1
     or (v_doc->'handoffs'->1->>'seq')::integer <> 2
     or (v_doc->'handoffs'->2->>'seq')::integer <> 3 then
    raise exception 'the handoffs are not in seq order: %, %, %',
      v_doc->'handoffs'->0->>'seq', v_doc->'handoffs'->1->>'seq',
      v_doc->'handoffs'->2->>'seq';
  end if;
  if v_doc->'handoffs'->0->>'status' <> 'DONE'
     or v_doc->'handoffs'->1->>'status' <> 'DONE'
     or v_doc->'handoffs'->2->>'status' <> 'DECLINED' then
    raise exception 'the nested handoff statuses are %, %, %',
      v_doc->'handoffs'->0->>'status', v_doc->'handoffs'->1->>'status',
      v_doc->'handoffs'->2->>'status';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_doc->'handoffs') as t(v)
     where (select count(*) from jsonb_object_keys(t.v) k) <> 22
        or t.v ? 'agency_id' or t.v ? 'branch_id'
        or t.v ? 'created_at' or t.v ? 'updated_at') then
    raise exception 'a nested handoff does not have exactly the 22 projected keys: %',
      (v_doc->'handoffs'->0)::text;
  end if;

  -- Events: the regression test. A non-empty array, every element carrying `at`.
  v_events := jsonb_array_length(v_doc->'events');
  if v_events = 0 then
    raise exception 'the chain has three handoffs and no events';
  end if;
  if v_events <> (select count(*) from public.spine_handoff_events
                   where chain_id = v_chain) then
    raise exception 'the read returned % events; the ledger holds % for this chain',
      v_events, (select count(*) from public.spine_handoff_events where chain_id = v_chain);
  end if;
  if exists (select 1 from jsonb_array_elements(v_doc->'events') e
              where e->>'at' is null) then
    raise exception 'an event came back without an `at`: the projection has lost the ledger timestamp';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_doc->'events') as t(v)
     where (select count(*) from jsonb_object_keys(t.v) k) <> 9
        or t.v ? 'chain_id') then
    raise exception 'an event does not have exactly the 9 projected keys: %',
      (v_doc->'events'->0)::text;
  end if;

  -- Seven events, and which seven. Asserted as a tally rather than positionally,
  -- because every row in this transaction shares now() and the projection orders
  -- by `at` then `id` -- so the sequence within the tie is decided by a random uuid.
  if v_events <> 7 then
    raise exception 'chain A produced % events, not the expected 7', v_events;
  end if;
  if (select count(*) filter (where e->>'action' = 'OPENED')     from jsonb_array_elements(v_doc->'events') e) <> 3
     or (select count(*) filter (where e->>'action' = 'ACCEPTED')  from jsonb_array_elements(v_doc->'events') e) <> 1
     or (select count(*) filter (where e->>'action' = 'COMPLETED') from jsonb_array_elements(v_doc->'events') e) <> 2
     or (select count(*) filter (where e->>'action' = 'DECLINED')  from jsonb_array_elements(v_doc->'events') e) <> 1 then
    raise exception 'the event tally is wrong: %', (v_doc->'events')::text;
  end if;
  if exists (select 1 from jsonb_array_elements(v_doc->'events') e
              where e->>'actor_email' <> 'spine-suite-finance@invalid.test') then
    raise exception 'an event on chain A names an actor the suite did not act as';
  end if;
  raise notice '2k ok: get_spine_chain returns chain/handoffs/events, 3 in seq order, 7 events each with an at';
end $step$;

-- 2l  A second chain, and REQUIREMENT 8. Chain B exists so that `seq` can be shown
--     to be per-chain rather than global -- its first handoff is seq 1 while chain
--     A already holds three -- and so that the two closing refusals have something
--     live to refuse.
--
--     The refusal is asserted on its message as well as its SQLSTATE, and it is the
--     only place in this file that does that. No SQLSTATE carries a count, and the
--     count is the part of this refusal that makes it useful: "answer them or
--     abandon the chain" is advice, "2 handoffs" is what tells a person how much
--     work that is. It is asserted twice -- once with two OPEN handoffs, once after
--     one of them has been ACCEPTED -- because the count is over
--     `status in ('OPEN', 'ACCEPTED')` and a count that only saw OPEN would let a
--     chain close underneath somebody who had already picked up the work.
do $step$
declare
  v_fin   uuid;
  v_gde   uuid;
  v_chain uuid;
  v_hb1   uuid;
  v_hb2   uuid;
  v_out   jsonb;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_gde from auth.users where email = 'spine-suite-guide@invalid.test';

  v_out := public.open_spine_chain_command(
    p_title        => 'spine suite chain B',
    p_subject_type => 'staff_profile',
    p_subject_id   => v_gde,
    p_origin_stage => 'AUDIT',
    p_title_ar     => '  chain B, second title  ',
    p_priority     => 'URGENT');
  v_chain := (v_out->>'id')::uuid;
  if v_out->>'priority' <> 'URGENT'
     or v_out->>'title_ar' <> 'chain B, second title'
     or v_out->>'current_stage' <> 'AUDIT' then
    raise exception 'chain B did not open as asked: %', v_out::text;
  end if;

  v_out := public.open_spine_handoff_command(
    p_chain_id     => v_chain,
    p_from_stage   => 'AUDIT',
    p_to_stage     => 'BI',
    p_intent       => 'PUBLISH',
    p_title        => 'suite hb1 publish',
    p_assigned_to  => v_gde);
  v_hb1 := (v_out->>'id')::uuid;
  if (v_out->>'seq')::integer <> 1 then
    raise exception 'the first handoff of chain B took seq % -- the allocator is not per-chain',
      v_out->>'seq';
  end if;
  if (v_out->>'assigned_to')::uuid is distinct from v_gde then
    raise exception 'hb1 was addressed to % rather than to the GUIDE',
      coalesce(v_out->>'assigned_to', 'NULL');
  end if;

  v_out := public.open_spine_handoff_command(
    p_chain_id   => v_chain,
    p_from_stage => 'AUDIT',
    p_to_stage   => 'APPROVAL',
    p_intent     => 'APPROVE',
    p_title      => 'suite hb2 approve',
    p_parent_id  => v_hb1);
  v_hb2 := (v_out->>'id')::uuid;
  if (v_out->>'seq')::integer <> 2
     or (v_out->>'parent_id')::uuid is distinct from v_hb1 then
    raise exception 'hb2 came back as seq % parent %', v_out->>'seq',
      coalesce(v_out->>'parent_id', 'NULL');
  end if;

  -- Two OPEN. The refusal must name both.
  perform pg_temp.spine_refuses_saying(
    format($q$select public.close_spine_chain_command(%L::uuid, 'CLOSED')$q$, v_chain),
    '22023', '2 handoffs on this chain are still open',
    'closing a chain with two OPEN handoffs');

  perform public.accept_spine_handoff_command(v_hb2, 'taking the approval');

  -- One OPEN, one ACCEPTED. Still two, because both are live.
  perform pg_temp.spine_refuses_saying(
    format($q$select public.close_spine_chain_command(%L::uuid, 'CLOSED')$q$, v_chain),
    '22023', '2 handoffs on this chain are still open',
    'closing a chain with one OPEN and one ACCEPTED handoff');

  -- The default argument is 'CLOSED', so the bare one-argument call is refused for
  -- the same reason -- worth proving, since that is the call a client makes.
  perform pg_temp.spine_refuses_saying(
    format($q$select public.close_spine_chain_command(%L::uuid)$q$, v_chain),
    '22023', '2 handoffs on this chain are still open',
    'closing a chain by the default status with live handoffs');

  if (select status from public.spine_chains where id = v_chain) <> 'OPEN' then
    raise exception 'a refused close changed the chain status anyway';
  end if;
  if pg_temp.spine_stage_of(v_chain) <> 'APPROVAL' then
    raise exception 'chain B sits at % rather than at its newest live handoff',
      pg_temp.spine_stage_of(v_chain);
  end if;
  raise notice '2l ok: chain B open with seq 1 and 2; CLOSED refused three times, naming the count';
end $step$;

-- 2m  REQUIREMENT 12, the two remaining reads. This is the one moment in the suite
--     where the whole board is in a known state: chain A is entirely terminal (two
--     DONE, one DECLINED) and chain B holds the only live work there is -- hb1 OPEN
--     and addressed to the GUIDE, hb2 ACCEPTED by this session.
--
--     Counts are asserted two ways on purpose. Facts about rows this suite created
--     are absolute -- chain A has three steps and none live, chain B has two of
--     each -- because the suite knows exactly what it wrote. Facts about the whole
--     agency are compared against an independently computed count instead, because
--     a suite that hard-codes "the inbox has two rows" is a suite that fails the
--     day somebody else's row exists. What is being proven there is that the read
--     model's own filter agrees with the filter written out longhand beside it.
--
--     Nothing here asserts an ordering. Every row in this transaction shares
--     now(), so `order by opened_at` inside the inbox and `order by opened_at desc`
--     inside the overview both resolve inside one enormous tie. The `limit` clamp
--     is asserted instead, which is deterministic: a length, not a sequence.
do $step$
declare
  v_fin    uuid;
  v_gde    uuid;
  v_a      uuid;
  v_b      uuid;
  v_hb1    uuid;
  v_hb2    uuid;
  v_inbox  jsonb;
  v_ov     jsonb;
  v_expect jsonb;
  v_keys   text[];
  v_row    jsonb;
  v_live   integer;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_gde from auth.users where email = 'spine-suite-guide@invalid.test';
  select id into v_a from public.spine_chains where title = 'spine suite chain A';
  select id into v_b from public.spine_chains where title = 'spine suite chain B';
  select id into v_hb1 from public.spine_handoffs where chain_id = v_b and seq = 1;
  select id into v_hb2 from public.spine_handoffs where chain_id = v_b and seq = 2;

  -- 12a  The inbox.
  v_inbox := public.get_spine_inbox();
  if jsonb_typeof(v_inbox) <> 'array' then
    raise exception 'get_spine_inbox returned a %', jsonb_typeof(v_inbox);
  end if;

  select count(*) into v_live from public.spine_handoffs h
   where h.status in ('OPEN', 'ACCEPTED')
     and public.row_in_staff_scope(h.agency_id, h.branch_id);
  -- least(..., 200) because the body's own `limit` is greatest(1, least(p_limit, 1000))
  -- over a default of 200. On a freshly replayed database v_live is 2; the clamp is
  -- written in anyway so that the assertion states the function's contract rather
  -- than an accident of how empty the table happens to be.
  if jsonb_array_length(v_inbox) <> least(v_live, 200) then
    raise exception 'the inbox holds % rows; % handoffs are live and in scope',
      jsonb_array_length(v_inbox), v_live;
  end if;
  if exists (select 1 from jsonb_array_elements(v_inbox) e
              where e->>'status' not in ('OPEN', 'ACCEPTED')) then
    raise exception 'the inbox contains a handoff that is not live';
  end if;
  if exists (select 1 from jsonb_array_elements(v_inbox) e
              where (e->>'chain_id')::uuid = v_a) then
    raise exception 'the inbox still shows chain A, whose every handoff is terminal';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_inbox) as t(v)
     where (select count(*) from jsonb_object_keys(t.v) k) <> 29
        or t.v ? 'agency_id' or t.v ? 'branch_id') then
    raise exception 'an inbox row does not have exactly the 29 projected keys: %',
      (v_inbox->0)::text;
  end if;

  -- `mine` is the one computed column in the projection, and it is computed from
  -- session facts a browser does not hold. hb2 was accepted by this session, so it
  -- is mine; hb1 is addressed to the GUIDE by uid, so it is not.
  select e into v_row from jsonb_array_elements(v_inbox) e
   where (e->>'id')::uuid = v_hb2;
  if v_row is null then
    raise exception 'the handoff this session accepted is not in its own inbox';
  end if;
  if (v_row->>'mine')::boolean is not true then
    raise exception 'the accepted handoff came back with mine = %',
      coalesce(v_row->>'mine', 'NULL');
  end if;
  if v_row->>'chain_title' <> 'spine suite chain B'
     or v_row->>'chain_status' <> 'OPEN'
     or v_row->>'chain_priority' <> 'URGENT'
     or v_row->>'chain_stage' <> 'APPROVAL'
     or v_row->>'chain_origin' <> 'AUDIT' then
    raise exception 'the inbox row does not carry its chain correctly: %', v_row::text;
  end if;

  select e into v_row from jsonb_array_elements(v_inbox) e
   where (e->>'id')::uuid = v_hb1;
  if v_row is null then
    raise exception 'the handoff addressed to the GUIDE is missing from the inbox';
  end if;
  if (v_row->>'mine')::boolean is not false then
    raise exception 'a handoff addressed to somebody else came back with mine = %',
      coalesce(v_row->>'mine', 'NULL');
  end if;

  if jsonb_array_length(public.get_spine_inbox(0)) <> 1 then
    raise exception 'p_limit => 0 should clamp to one row, not %',
      jsonb_array_length(public.get_spine_inbox(0));
  end if;

  -- 12c  The overview.
  v_ov := public.get_spine_overview();
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_ov) k;
  if v_keys is distinct from array['byStage', 'byStatus', 'chains', 'oldestOpenAt'] then
    raise exception 'get_spine_overview returned keys %',
      coalesce(v_keys::text, 'NULL');
  end if;
  if jsonb_typeof(v_ov->'byStage') <> 'object'
     or jsonb_typeof(v_ov->'byStatus') <> 'object'
     or jsonb_typeof(v_ov->'chains') <> 'array' then
    raise exception 'get_spine_overview returned types % / % / %',
      jsonb_typeof(v_ov->'byStage'), jsonb_typeof(v_ov->'byStatus'),
      jsonb_typeof(v_ov->'chains');
  end if;
  if v_ov->>'oldestOpenAt' is null then
    raise exception 'two handoffs are live and oldestOpenAt came back null';
  end if;

  -- byStage counts live work by where it is addressed, so chain A -- all terminal --
  -- must have left it entirely, and the two live rows must be the two keys.
  select coalesce(jsonb_object_agg(t.to_stage, t.n), '{}'::jsonb) into v_expect
    from (
      select h.to_stage, count(*) as n from public.spine_handoffs h
       where h.status in ('OPEN', 'ACCEPTED')
         and public.row_in_staff_scope(h.agency_id, h.branch_id)
       group by h.to_stage) t;
  if v_ov->'byStage' <> v_expect then
    raise exception 'byStage is % where the live rows say %',
      (v_ov->'byStage')::text, v_expect::text;
  end if;
  if coalesce((v_ov->'byStage'->>'BI')::integer, 0) < 1
     or coalesce((v_ov->'byStage'->>'APPROVAL')::integer, 0) < 1 then
    raise exception 'byStage does not count the two live handoffs: %',
      (v_ov->'byStage')::text;
  end if;
  if v_ov->'byStage' ? 'OPERATIONS' or v_ov->'byStage' ? 'ACCOUNTING' then
    raise exception 'byStage still counts chain A''s terminal handoffs: %',
      (v_ov->'byStage')::text;
  end if;

  -- byStatus counts every handoff in scope, terminal ones included. All five of the
  -- suite's own rows must appear somewhere in it, which is what the sum checks.
  select coalesce(jsonb_object_agg(t.status, t.n), '{}'::jsonb) into v_expect
    from (
      select h.status, count(*) as n from public.spine_handoffs h
       where public.row_in_staff_scope(h.agency_id, h.branch_id)
       group by h.status) t;
  if v_ov->'byStatus' <> v_expect then
    raise exception 'byStatus is % where the table says %',
      (v_ov->'byStatus')::text, v_expect::text;
  end if;
  if coalesce((v_ov->'byStatus'->>'DONE')::integer, 0) < 2
     or coalesce((v_ov->'byStatus'->>'DECLINED')::integer, 0) < 1
     or coalesce((v_ov->'byStatus'->>'ACCEPTED')::integer, 0) < 1
     or coalesce((v_ov->'byStatus'->>'OPEN')::integer, 0) < 1 then
    raise exception 'byStatus does not account for the five handoffs the suite wrote: %',
      (v_ov->'byStatus')::text;
  end if;
  if (select sum(v::integer) from jsonb_each_text(v_ov->'byStatus') as x(k, v))
       <> (select count(*) from public.spine_handoffs h
            where public.row_in_staff_scope(h.agency_id, h.branch_id)) then
    raise exception 'byStatus does not sum to the number of handoffs in scope';
  end if;

  -- chains carries a steps/live pair per chain, and those are absolute: the suite
  -- wrote every handoff on both of them.
  select e into v_row from jsonb_array_elements(v_ov->'chains') e
   where (e->>'id')::uuid = v_a;
  if v_row is null then
    raise exception 'chain A is missing from the overview';
  end if;
  if (v_row->>'steps')::integer <> 3 or (v_row->>'live')::integer <> 0
     or v_row->>'current_stage' <> 'DMS' or v_row->>'status' <> 'OPEN'
     or v_row->>'closed_at' is not null then
    raise exception 'the overview describes chain A as %', v_row::text;
  end if;

  select e into v_row from jsonb_array_elements(v_ov->'chains') e
   where (e->>'id')::uuid = v_b;
  if v_row is null then
    raise exception 'chain B is missing from the overview';
  end if;
  if (v_row->>'steps')::integer <> 2 or (v_row->>'live')::integer <> 2
     or v_row->>'current_stage' <> 'APPROVAL' or v_row->>'priority' <> 'URGENT' then
    raise exception 'the overview describes chain B as %', v_row::text;
  end if;
  if v_row ? 'agency_id' or v_row ? 'branch_id' then
    raise exception 'the overview returns tenancy columns to its caller';
  end if;

  if jsonb_array_length(public.get_spine_overview(0)->'chains') <> 1 then
    raise exception 'p_limit => 0 should clamp the chain list to one row, not %',
      jsonb_array_length(public.get_spine_overview(0)->'chains');
  end if;
  raise notice '2m ok: inbox agrees with the live set and computes mine; overview counts stages, statuses and chains';
end $step$;

-- 2n  REQUIREMENT 9. ABANDONED is the way out of a chain that still has live work,
--     and it is not a softer CLOSED: it answers the handoffs on the caller's behalf
--     by superseding them, writes one event for each, and leaves the ledger saying
--     they were asked and never answered.
--
--     This also lands the third arm of the derived-stage rule. Chain B's two
--     handoffs both become SUPERSEDED, so there is no live handoff and no DONE
--     handoff to point at, and `coalesce` falls through to `origin_stage`. The other
--     two arms were taken in 2d/2e/2h (newest live) and 2i (newest DONE), so after
--     this step every branch of private.spine_sync_chain_stage has been exercised.
do $step$
declare
  v_fin   uuid;
  v_b     uuid;
  v_hb1   uuid;
  v_hb2   uuid;
  v_out   jsonb;
  v_chain public.spine_chains;
  v_n     integer;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_b from public.spine_chains where title = 'spine suite chain B';
  select id into v_hb1 from public.spine_handoffs where chain_id = v_b and seq = 1;
  select id into v_hb2 from public.spine_handoffs where chain_id = v_b and seq = 2;

  v_out := public.close_spine_chain_command(
    v_b, 'ABANDONED', '  chain B abandoned by the suite  ');
  if v_out->>'status' <> 'ABANDONED' then
    raise exception 'abandoning chain B returned status %', v_out->>'status';
  end if;
  if v_out->>'closed_note' <> 'chain B abandoned by the suite' then
    raise exception 'the closing note came back as %', quote_literal(v_out->>'closed_note');
  end if;
  if (v_out->>'closed_by')::uuid is distinct from v_fin or v_out->>'closed_at' is null then
    raise exception 'the close did not record who and when: closed_by %, closed_at %',
      coalesce(v_out->>'closed_by', 'NULL'), coalesce(v_out->>'closed_at', 'NULL');
  end if;

  select * into v_chain from public.spine_chains where id = v_b;
  if v_chain.status <> 'ABANDONED' then
    raise exception 'the returned document says ABANDONED and the table says %',
      v_chain.status;
  end if;
  if v_chain.current_stage <> v_chain.origin_stage or v_chain.current_stage <> 'AUDIT' then
    raise exception 'with nothing live and nothing done, the stage should fall back to origin %; it is %',
      v_chain.origin_stage, v_chain.current_stage;
  end if;

  if exists (select 1 from public.spine_handoffs
              where chain_id = v_b and status in ('OPEN', 'ACCEPTED')) then
    raise exception 'abandoning the chain left live handoffs on it';
  end if;
  select count(*) into v_n from public.spine_handoffs
   where chain_id = v_b and status = 'SUPERSEDED'
     and decided_note = 'The chain was abandoned'
     and decided_by = v_fin and decided_at is not null;
  if v_n <> 2 then
    raise exception 'only % of the 2 remaining handoffs were superseded with a reason', v_n;
  end if;

  -- One event per superseded handoff, and exactly one: the loop writes inside the
  -- same statement that does the update, so a second event would mean it ran twice.
  select count(*) into v_n from public.spine_handoff_events
   where chain_id = v_b and action = 'SUPERSEDED'
     and handoff_id in (v_hb1, v_hb2)
     and from_status is null and to_status = 'SUPERSEDED'
     and detail->>'reason' = 'chain abandoned';
  if v_n <> 2 then
    raise exception 'the ledger holds % SUPERSEDED events for the two handoffs, not 2', v_n;
  end if;
  if exists (
    select 1 from (
      select handoff_id, count(*) as c from public.spine_handoff_events
       where chain_id = v_b and action = 'SUPERSEDED' group by handoff_id) t
     where t.c <> 1) then
    raise exception 'a handoff was superseded more than once';
  end if;
  raise notice '2n ok: ABANDONED supersedes the live handoffs, logs one event each, and drops the chain back to its origin stage';
end $step$;

-- 2o  The other half of requirement 8: the CLOSED that 2l could not have. Nothing on
--     chain A is live any more, so the call that was refused three times now works,
--     which is what makes those refusals a rule rather than an outage.
--
--     Then the two consequences of a closed chain. Both `open_spine_handoff_command`
--     and `close_spine_chain_command` pass p_require_open => true to
--     private.spine_guard_chain, so both refuse with 22023 -- while
--     get_spine_chain, which passes false, still reads it. A closed chain is
--     history; it is not a hidden row.
do $step$
declare
  v_fin  uuid;
  v_a    uuid;
  v_out  jsonb;
  v_ov   jsonb;
  v_row  jsonb;
  v_live integer;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_a from public.spine_chains where title = 'spine suite chain A';

  v_out := public.close_spine_chain_command(v_a, 'CLOSED', 'chain A closed by the suite');
  if v_out->>'status' <> 'CLOSED' then
    raise exception 'closing a chain with nothing live returned status %', v_out->>'status';
  end if;
  if v_out->>'closed_at' is null or (v_out->>'closed_by')::uuid is distinct from v_fin then
    raise exception 'the close of chain A recorded closed_by %, closed_at %',
      coalesce(v_out->>'closed_by', 'NULL'), coalesce(v_out->>'closed_at', 'NULL');
  end if;
  -- Closing is not a stage event. The chain stays where its work left it.
  if pg_temp.spine_stage_of(v_a) <> 'DMS' then
    raise exception 'closing chain A moved it to %', pg_temp.spine_stage_of(v_a);
  end if;

  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'DMS', 'BI', 'REVIEW', 'after the close')$q$, v_a),
    '22023', 'opening a handoff on a closed chain');
  perform pg_temp.spine_refuses(
    format($q$select public.close_spine_chain_command(%L::uuid, 'CLOSED', 'again')$q$, v_a),
    '22023', 'closing a chain that is already closed');
  if public.get_spine_chain(v_a)->'chain'->>'status' <> 'CLOSED' then
    raise exception 'a closed chain no longer reads back as CLOSED';
  end if;

  -- The overview still lists it. Section I.3's comment calls `chains` "the chains
  -- that are still open" and the query it describes has no status filter, so this
  -- asserts the query. If the comment is ever made true, this is the assertion that
  -- will say so.
  v_ov := public.get_spine_overview();
  select e into v_row from jsonb_array_elements(v_ov->'chains') e
   where (e->>'id')::uuid = v_a;
  if v_row is null then
    raise exception 'the overview dropped chain A once it closed; the query has no status filter, so either the query changed or the count is wrong';
  end if;
  if v_row->>'status' <> 'CLOSED' or (v_row->>'live')::integer <> 0
     or (v_row->>'steps')::integer <> 3 or v_row->>'closed_at' is null then
    raise exception 'the overview describes the closed chain A as %', v_row::text;
  end if;

  -- Every handoff the suite wrote is now terminal. On the replayed database that
  -- gate 5 provides these tables hold nothing else, so the live-work views must be
  -- empty -- which is also the only way to see that they return [] and a JSON null
  -- rather than SQL NULL. Guarded on the count so that a database with other rows
  -- in it cannot turn a true statement into a failure.
  select count(*) into v_live from public.spine_handoffs h
   where h.status in ('OPEN', 'ACCEPTED')
     and public.row_in_staff_scope(h.agency_id, h.branch_id);
  if v_live = 0 then
    if public.get_spine_inbox() <> '[]'::jsonb then
      raise exception 'nothing is live and the inbox returned %',
        public.get_spine_inbox()::text;
    end if;
    if v_ov->'byStage' <> '{}'::jsonb then
      raise exception 'nothing is live and byStage returned %', (v_ov->'byStage')::text;
    end if;
    if v_ov->>'oldestOpenAt' is not null or not (v_ov ? 'oldestOpenAt') then
      raise exception 'with nothing live, oldestOpenAt should be present and null; it is %',
        coalesce((v_ov->'oldestOpenAt')::text, 'absent');
    end if;
    if v_ov->'byStatus' ? 'OPEN' or v_ov->'byStatus' ? 'ACCEPTED' then
      raise exception 'byStatus still counts live handoffs: %', (v_ov->'byStatus')::text;
    end if;
  end if;
  if coalesce((v_ov->'byStatus'->>'SUPERSEDED')::integer, 0) < 2 then
    raise exception 'byStatus does not count the two superseded handoffs: %',
      (v_ov->'byStatus')::text;
  end if;
  raise notice '2o ok: CLOSED is allowed once nothing is live, a closed chain refuses further work but still reads, and the live views empty out';
end $step$;

-- 2p  REQUIREMENT 10. The ledger is append-only, and this is the second of the two
--     places where the suite writes to a spine table directly. It has to: there is no
--     wrapper for editing history, which is the point, so the only way to prove the
--     refusal is to attempt the write the way a compromised definer body or a
--     migration typed into a console would.
--
--     Three probes, not two. The UPDATE that changes a value and the UPDATE that
--     changes nothing (`set detail = detail`) both raise, because a BEFORE UPDATE
--     trigger fires on the operation rather than on a difference -- so the rule is
--     append-only and not merely "detail is immutable". Then the DELETE.
--
--     And then the complement, which is what makes the DELETE refusal a rule instead
--     of a wall: deleting the chain cascades to its handoffs and its events, the
--     trigger sees a parent that has gone, and the events leave with their subject.
--     Without this half, a trigger that simply refused every DELETE would pass.
do $step$
declare
  v_fin   uuid;
  v_a     uuid;
  v_ev    uuid;
  v_own    integer;
  v_before integer;
  v_after  integer;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_a from public.spine_chains where title = 'spine suite chain A';
  select id into v_ev from public.spine_handoff_events
   where chain_id = v_a and action = 'OPENED' limit 1;
  if v_ev is null then
    raise exception 'the suite has no event on chain A to attempt to rewrite';
  end if;
  select count(*) into v_before from public.spine_handoff_events;
  select count(*) into v_own from public.spine_handoff_events where chain_id = v_a;
  if v_own <> 7 then
    raise exception 'chain A holds % events where 2k counted 7; closing it wrote history it should not have', v_own;
  end if;

  perform pg_temp.spine_refuses(
    format($q$update public.spine_handoff_events set detail = '{"tampered":true}'::jsonb where id = %L::uuid$q$, v_ev),
    '42501', 'rewriting an event''s detail');
  perform pg_temp.spine_refuses(
    format($q$update public.spine_handoff_events set detail = detail where id = %L::uuid$q$, v_ev),
    '42501', 'an update that changes nothing at all');
  perform pg_temp.spine_refuses(
    format($q$update public.spine_handoff_events set at = now(), actor_email = 'someone@else.test' where id = %L::uuid$q$, v_ev),
    '42501', 'restamping an event');
  perform pg_temp.spine_refuses(
    format($q$delete from public.spine_handoff_events where id = %L::uuid$q$, v_ev),
    '42501', 'deleting an event whose handoff is still there');

  select count(*) into v_after from public.spine_handoff_events;
  if v_after <> v_before then
    raise exception 'the ledger went from % rows to % across four refused statements',
      v_before, v_after;
  end if;
  if exists (select 1 from public.spine_handoff_events
              where id = v_ev
                and (detail ? 'tampered' or actor_email = 'someone@else.test')) then
    raise exception 'a refused update still landed on the event row';
  end if;

  -- The complement. Chain A is closed and finished with, so it can be the one that
  -- goes. Nothing in this suite reads it after this point, and the whole transaction
  -- rolls back regardless.
  delete from public.spine_chains where id = v_a;
  if exists (select 1 from public.spine_handoffs where chain_id = v_a) then
    raise exception 'deleting the chain left its handoffs behind';
  end if;
  if exists (select 1 from public.spine_handoff_events where chain_id = v_a) then
    raise exception 'deleting the chain left its events behind: the ledger refused a cascade it should allow';
  end if;
  select count(*) into v_after from public.spine_handoff_events;
  if v_after <> v_before - v_own then
    raise exception 'the cascade removed % events; chain A had %',
      v_before - v_after, v_own;
  end if;
  raise notice '2p ok: three updates and a delete refused with 42501, and the events still leave with their chain';
end $step$;

-- 2q  REQUIREMENT 11. A bad stage name, a bad subject type and a bad intent are each
--     refused. All three are CHECK constraints, so all three are 23514 -- and two of
--     them are CHECKs over a predicate function rather than over a literal list, which
--     is why `private.spine_stage_ok` and `private.spine_subject_target` had to be
--     immutable for the table to accept them at all (Part 1, 1p).
--
--     The lower-case probes are here because the vocabulary is not folded anywhere:
--     'bi' is not 'BI' and 'review' is not 'REVIEW'. A client that sends what a URL
--     gave it gets a refusal, not a silently mis-stamped row.
--
--     Each probe asserts the SQLSTATE it expects, so a probe that fails for a reason
--     the suite did not intend -- a missing permission, a null uuid, a typo in the
--     probe itself -- fails the suite rather than passing it. The refusal helper
--     re-raises when the statement succeeds, which is the case that matters most.
do $step$
declare
  v_fin   uuid;
  v_c     uuid;
  v_ghost uuid := '00000000-0000-0000-0000-0000000000ff';
  v_out   jsonb;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  -- The two 23503 probes need a subject that provably is not there, so this checks
  -- rather than assumes. A fixed uuid keeps the probe text stable; the precondition
  -- keeps it honest.
  if exists (select 1 from public.staff_profiles where user_id = v_ghost) then
    raise exception 'the uuid the suite uses as a missing subject has a staff profile';
  end if;

  -- Chain-level. Each of these is a whole call that must not produce a chain.
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_chain_command('bad origin', 'staff_profile', %L::uuid, 'WAREHOUSE')$q$, v_fin),
    '23514', 'a chain whose origin stage is not one of the twelve');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_chain_command('lower origin', 'staff_profile', %L::uuid, 'bi')$q$, v_fin),
    '23514', 'a chain whose origin stage is the right word in the wrong case');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_chain_command('bad subject', 'not_a_subject', %L::uuid, 'BI')$q$, v_fin),
    '23514', 'a chain about a subject type the schema does not know');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_chain_command('STAFF_PROFILE case', 'STAFF_PROFILE', %L::uuid, 'BI')$q$, v_fin),
    '23514', 'a subject type in the wrong case');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_chain_command('   ', 'staff_profile', %L::uuid, 'BI')$q$, v_fin),
    '23514', 'a chain whose title is only whitespace');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_chain_command('bad priority', 'staff_profile', %L::uuid, 'BI', null, 'CRITICAL')$q$, v_fin),
    '23514', 'a chain at a priority that is not one of the four');
  -- Well-typed subject, no such row. This one is the AFTER trigger rather than a
  -- CHECK, so it answers with 23503 -- and it is the reason the trigger exists: the
  -- CHECK can only ask whether the type is known, never whether the row is there.
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_chain_command('missing subject', 'staff_profile', %L::uuid, 'BI')$q$, v_ghost),
    '23503', 'a chain about a staff profile that does not exist');

  if exists (select 1 from public.spine_chains
              where title in ('bad origin', 'lower origin', 'bad subject',
                              'STAFF_PROFILE case', 'bad priority', 'missing subject', '')) then
    raise exception 'one of the refused chains was written anyway';
  end if;

  -- A chain that is allowed, to host the handoff probes.
  v_out := public.open_spine_chain_command(
    'spine suite chain C', 'staff_profile', v_fin, 'BI');
  v_c := (v_out->>'id')::uuid;

  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'WAREHOUSE', 'MODELING', 'REVIEW', 'bad from')$q$, v_c),
    '23514', 'a handoff from a stage that does not exist');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'modeling', 'REVIEW', 'lower to')$q$, v_c),
    '23514', 'a handoff to the right stage in the wrong case');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'MODELING', 'REVIEWS', 'bad intent')$q$, v_c),
    '23514', 'a handoff whose intent is not one of the ten');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'MODELING', 'review', 'lower intent')$q$, v_c),
    '23514', 'an intent in the wrong case');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'BI', 'REVIEW', 'crosses nothing')$q$, v_c),
    '23514', 'a handoff from a stage to itself');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'MODELING', 'REVIEW', 'bad role', null, '', 'MANAGER')$q$, v_c),
    '23514', 'a handoff addressed to a role that is not one of the seven');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'MODELING', 'REVIEW', 'bad subject', null, '', null, null, null, null, '{}'::jsonb, 'not_a_subject', %L::uuid)$q$, v_c, v_fin),
    '23514', 'a handoff narrowed to a subject type the schema does not know');
  perform pg_temp.spine_refuses(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'MODELING', 'REVIEW', 'missing subject', null, '', null, null, null, null, '{}'::jsonb, 'staff_profile', %L::uuid)$q$, v_c, v_ghost),
    '23503', 'a handoff about a staff profile that does not exist');

  if exists (select 1 from public.spine_handoffs where chain_id = v_c) then
    raise exception 'a refused handoff was written to chain C anyway';
  end if;
  -- seq is allocated from max(seq) inside the same statement that inserts, so eight
  -- rolled-back inserts must not have consumed any numbers. The next real handoff
  -- has to be 1.
  raise notice '2q ok: eight bad handoffs and seven bad chains refused, each with the SQLSTATE its own constraint raises';
end $step$;

-- 2r  The closing vocabulary, and the one place in this schema that does fold case.
--
--     private.spine_close_chain reads `upper(btrim(coalesce(p_status, 'CLOSED')))`, so
--     'closed', ' abandoned ' and null all work while every other word in the spine is
--     exact. That is worth asserting in both directions: the fold on the way in, and
--     the fold showing up in the refusal message on the way out, where ' paused '
--     comes back as "not PAUSED".
--
--     The payload coercion belongs here for the same reason -- it is the other place a
--     wrapper quietly repairs its input instead of refusing it. There is a CHECK
--     requiring `jsonb_typeof(payload) = 'object'`, and the body makes it unreachable
--     by substituting '{}' for anything else, so an array and a null both arrive as an
--     empty object rather than as 23514.
do $step$
declare
  v_fin  uuid;
  v_c    uuid;
  v_d    uuid;
  v_e    uuid;
  v_h1   uuid;
  v_h2   uuid;
  v_he   uuid;
  v_out  jsonb;
begin
  v_fin := pg_temp.spine_become('spine-suite-finance@invalid.test');
  select id into v_c from public.spine_chains where title = 'spine suite chain C';

  -- seq restarts at 1 even though 2q attempted eight inserts on this chain: the
  -- allocation reads max(seq) in the same statement that writes, and a rolled-back
  -- statement leaves nothing to read.
  v_out := public.open_spine_handoff_command(
    v_c, 'BI', 'MODELING', 'REVIEW', 'payload as an array',
    null, '', null, null, null, null, '[1, 2]'::jsonb);
  v_h1 := (v_out->>'id')::uuid;
  if (v_out->>'seq')::integer <> 1 then
    raise exception 'chain C''s first handoff took seq % after eight refused inserts',
      v_out->>'seq';
  end if;
  if v_out->'payload' <> '{}'::jsonb then
    raise exception 'an array payload was stored as % instead of being replaced with an empty object',
      (v_out->'payload')::text;
  end if;

  v_out := public.open_spine_handoff_command(
    v_c, 'BI', 'MODELING', 'INFORM', 'payload as null',
    null, '', null, null, null, null, null);
  v_h2 := (v_out->>'id')::uuid;
  if v_out->'payload' <> '{}'::jsonb or jsonb_typeof(v_out->'payload') <> 'object' then
    raise exception 'a null payload was stored as %', coalesce((v_out->'payload')::text, 'NULL');
  end if;

  -- The word check runs before the live-handoff count, so a bad word on a chain with
  -- live work must answer about the word. Asserting the message is what separates the
  -- two refusals, since both are 22023.
  perform pg_temp.spine_refuses_saying(
    format($q$select public.close_spine_chain_command(%L::uuid, ' paused ')$q$, v_c),
    '22023', 'not PAUSED', 'closing a chain as a word that is not one of the two');
  perform pg_temp.spine_refuses_saying(
    format($q$select public.close_spine_chain_command(%L::uuid, 'CLOSED')$q$, v_c),
    '22023', '2 handoffs on this chain are still open',
    'closing chain C while both of its handoffs are open');

  perform public.complete_spine_handoff_command(v_h1, 'first done');
  perform public.complete_spine_handoff_command(v_h2, 'second done');
  if pg_temp.spine_status_of(v_h1) <> 'DONE' or pg_temp.spine_status_of(v_h2) <> 'DONE' then
    raise exception 'chain C''s handoffs are % and %',
      pg_temp.spine_status_of(v_h1), pg_temp.spine_status_of(v_h2);
  end if;

  -- The fold on the way in.
  v_out := public.close_spine_chain_command(v_c, 'closed', 'lower case close');
  if v_out->>'status' <> 'CLOSED' then
    raise exception 'closing with ''closed'' produced status %', v_out->>'status';
  end if;

  -- Null status falls back to CLOSED, and a null note to the empty string the column
  -- requires. Chain D exists only to carry that pair, so it has no handoffs at all --
  -- which is also the empty case for the live count.
  v_out := public.open_spine_chain_command('spine suite chain D', 'staff_profile', v_fin, 'PLANNING');
  v_d := (v_out->>'id')::uuid;
  v_out := public.close_spine_chain_command(v_d, null, null);
  if v_out->>'status' <> 'CLOSED' or v_out->>'closed_note' <> '' then
    raise exception 'a null status and note closed chain D as % with note %',
      v_out->>'status', coalesce(quote_literal(v_out->>'closed_note'), 'NULL');
  end if;

  -- And the fold on the abandon side, which also supersedes a live handoff a second
  -- time -- this time reached through a lower-case word.
  v_out := public.open_spine_chain_command('spine suite chain E', 'staff_profile', v_fin, 'EXECUTION');
  v_e := (v_out->>'id')::uuid;
  v_out := public.open_spine_handoff_command(v_e, 'EXECUTION', 'AUDIT', 'CERTIFY', 'to be superseded');
  v_he := (v_out->>'id')::uuid;
  v_out := public.close_spine_chain_command(v_e, '  abandoned  ', 'lower case abandon');
  if v_out->>'status' <> 'ABANDONED' then
    raise exception 'closing with ''  abandoned  '' produced status %', v_out->>'status';
  end if;
  if pg_temp.spine_status_of(v_he) <> 'SUPERSEDED' then
    raise exception 'the lower-case abandon left its handoff at %',
      pg_temp.spine_status_of(v_he);
  end if;
  if pg_temp.spine_events_on(v_e, 'SUPERSEDED') <> 1 then
    raise exception 'the lower-case abandon wrote % SUPERSEDED events',
      pg_temp.spine_events_on(v_e, 'SUPERSEDED');
  end if;
  if pg_temp.spine_stage_of(v_e) <> 'EXECUTION' then
    raise exception 'chain E should have fallen back to its origin stage; it is at %',
      pg_temp.spine_stage_of(v_e);
  end if;
  raise notice '2r ok: closed/abandoned fold case and default from null, the refusal message uppercases, and non-object payloads become empty objects';
end $step$;

-- 2s  Every wrapper needs a permission, and this is the step that proves it rather
--     than assuming it from Part 1's count of RBAC rows.
--
--     The method matters. A superuser connection cannot be made to fail a policy, so
--     the refusals here are not policy refusals -- they are the explicit
--     has_permission() checks inside the definer bodies, which consult seeded rows and
--     therefore answer the same way for any connection. The suite becomes the GUIDE,
--     shows that the GUIDE can read a chain (so its scope is provably in range),
--     deletes the eight rows Section G seeded for GUIDE, and then asks the same
--     session for the same rows again. Nothing about visibility changes; only the
--     matrix does.
--
--     Each probe asserts the message as well as the SQLSTATE, because
--     private.spine_guard_chain and private.spine_guard_handoff raise 42501 twice for
--     different reasons -- once for the permission and once for a row that is not
--     reachable. A probe that accepted any 42501 would pass while proving nothing
--     about which rule fired.
do $step$
declare
  v_gde uuid;
  v_c   uuid;
  v_n   integer;
begin
  v_gde := pg_temp.spine_become('spine-suite-guide@invalid.test');
  select id into v_c from public.spine_chains where title = 'spine suite chain C';
  if public.staff_role() <> 'GUIDE' then
    raise exception 'the second session is % rather than GUIDE', public.staff_role();
  end if;

  -- In range and permitted: the baseline the refusals are measured against.
  if public.get_spine_chain(v_c)->'chain'->>'status' <> 'CLOSED' then
    raise exception 'the GUIDE cannot read chain C, so a later 42501 would prove nothing';
  end if;
  if jsonb_typeof(public.get_spine_overview()->'chains') <> 'array' then
    raise exception 'the GUIDE cannot read the overview';
  end if;

  -- The guard's other 42501: a uuid that is not a chain here. Same code, different
  -- rule, and this is the nearest the suite can come to the cross-agency case
  -- without asserting anything about row visibility.
  perform pg_temp.spine_refuses_saying(
    $q$select public.get_spine_chain('00000000-0000-0000-0000-0000000000fe'::uuid)$q$,
    '42501', 'is available here', 'reading a chain that is not there');

  delete from public.staff_permissions
   where role = 'GUIDE'
     and resource in ('spine_chains', 'spine_handoffs', 'spine_handoff_events');
  get diagnostics v_n = row_count;
  if v_n <> 8 then
    raise exception 'removing the GUIDE''s spine permissions deleted % rows, not the 8 Section G seeds', v_n;
  end if;
  if public.has_permission('spine_chains', 'read')
     or public.has_permission('spine_handoffs', 'update') then
    raise exception 'has_permission still answers yes for a role with no rows left';
  end if;

  perform pg_temp.spine_refuses_saying(
    format($q$select public.open_spine_chain_command('unpermitted chain', 'staff_profile', %L::uuid, 'BI')$q$, v_gde),
    '42501', 'Your role cannot open a spine chain', 'opening a chain without the permission');
  perform pg_temp.spine_refuses_saying(
    format($q$select public.open_spine_handoff_command(%L::uuid, 'BI', 'MODELING', 'REVIEW', 'unpermitted handoff')$q$, v_c),
    '42501', 'Your role cannot read a spine chain', 'opening a handoff without the permission');
  perform pg_temp.spine_refuses_saying(
    $q$select public.accept_spine_handoff_command('00000000-0000-0000-0000-0000000000fe'::uuid)$q$,
    '42501', 'Your role cannot update a handoff', 'accepting without the permission');
  perform pg_temp.spine_refuses_saying(
    $q$select public.complete_spine_handoff_command('00000000-0000-0000-0000-0000000000fe'::uuid)$q$,
    '42501', 'Your role cannot update a handoff', 'completing without the permission');
  perform pg_temp.spine_refuses_saying(
    $q$select public.decline_spine_handoff_command('00000000-0000-0000-0000-0000000000fe'::uuid, 'a reason')$q$,
    '42501', 'Your role cannot update a handoff', 'declining without the permission');
  perform pg_temp.spine_refuses_saying(
    format($q$select public.close_spine_chain_command(%L::uuid)$q$, v_c),
    '42501', 'Your role cannot update a spine chain', 'closing without the permission');
  perform pg_temp.spine_refuses_saying(
    $q$select public.get_spine_inbox()$q$,
    '42501', 'Your role cannot read handoffs', 'reading the inbox without the permission');
  perform pg_temp.spine_refuses_saying(
    format($q$select public.get_spine_chain(%L::uuid)$q$, v_c),
    '42501', 'Your role cannot read a spine chain', 'reading one chain without the permission');
  perform pg_temp.spine_refuses_saying(
    $q$select public.get_spine_overview()$q$,
    '42501', 'Your role cannot read spine chains', 'reading the overview without the permission');

  -- The permission checks come before the row lookups, which is why three of those
  -- probes could pass a uuid that is not a handoff and still be answered about the
  -- permission. Order matters: a body that looked the row up first would tell an
  -- unauthorised caller whether the row exists.
  raise notice '2s ok: all nine wrappers refuse with 42501 once the role holds no spine permissions, each naming its own rule';
end $step$;

rollback;

-- ============================================================================
-- PART 3.  Residue.
--
-- Part 2 ran inside one transaction and rolled it back, so nothing it wrote should
-- survive. This part runs outside that transaction and reports it, because a suite
-- that leaves five chains, two auth.users rows and a hole in the permission matrix
-- behind is a suite that has quietly rewritten the database it was measuring -- and
-- the next suite in scripts/fresh-db-replay.sh would be measuring the wreckage.
--
-- The permission count is the one that would bite hardest: 2s deletes eight rows from
-- staff_permissions, and if that survived, every GUIDE in the agency would lose the
-- spine and no other gate would say why.
-- ============================================================================

select
  '3a_no_residue_from_part_2' as check_name,
  (
    (select count(*) from public.spine_chains where title like 'spine suite chain%') = 0
    and (select count(*) from public.spine_chains
          where title in ('bad origin', 'lower origin', 'bad subject', 'STAFF_PROFILE case',
                          'bad priority', 'missing subject', 'unpermitted chain')) = 0
    and (select count(*) from auth.users
          where email in ('spine-suite-finance@invalid.test',
                          'spine-suite-guide@invalid.test')) = 0
    and (select count(*) from public.staff_profiles
          where user_id in ('0f5e1c00-0000-4000-8000-000000000001'::uuid,
                            '0f5e1c00-0000-4000-8000-000000000002'::uuid)) = 0
    and (select count(*) from public.staff_permissions
          where resource in ('spine_chains', 'spine_handoffs', 'spine_handoff_events')) = 48
    and (select count(*) from public.staff_permissions
          where role = 'GUIDE'
            and resource in ('spine_chains', 'spine_handoffs', 'spine_handoff_events')) = 8
    and (select count(*) from public.spine_handoff_events e
          where not exists (select 1 from public.spine_chains c where c.id = e.chain_id)) = 0
    and auth.uid() is distinct from '0f5e1c00-0000-4000-8000-000000000001'::uuid
    and auth.uid() is distinct from '0f5e1c00-0000-4000-8000-000000000002'::uuid
  ) as pass,
  format('chains %s, users %s, profiles %s, spine permission rows %s (GUIDE %s), orphan events %s',
    (select count(*) from public.spine_chains where title like 'spine suite chain%'),
    (select count(*) from auth.users
      where email in ('spine-suite-finance@invalid.test', 'spine-suite-guide@invalid.test')),
    (select count(*) from public.staff_profiles
      where user_id in ('0f5e1c00-0000-4000-8000-000000000001'::uuid,
                        '0f5e1c00-0000-4000-8000-000000000002'::uuid)),
    (select count(*) from public.staff_permissions
      where resource in ('spine_chains', 'spine_handoffs', 'spine_handoff_events')),
    (select count(*) from public.staff_permissions
      where role = 'GUIDE'
        and resource in ('spine_chains', 'spine_handoffs', 'spine_handoff_events')),
    (select count(*) from public.spine_handoff_events e
      where not exists (select 1 from public.spine_chains c where c.id = e.chain_id))
  ) as detail;
