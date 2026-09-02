-- The modelling engine: the vertical slice, asked to prove itself.
--
-- 20260901180000_modeling_engine_vertical_slice.sql installs a formula engine whose
-- security boundary is not a string. Nothing in modeling_rows.formula is ever handed to
-- the server to run: the expression language is evaluated in the browser, and what the
-- database keeps is text it only ever pattern-matches. So this suite is not about an
-- injection surface. It is about the four things that are load-bearing instead --
-- a namespace two tables share, a horizon a series must fit inside, a scenario chain
-- that must not close on itself, and a published model that must stop accepting edits.
--
-- Three parts, split by what each one is able to prove.
--
-- Part 1 reads the catalog. Every check evaluates on any database carrying the schema,
-- writes nothing and needs no session, so it runs in CI against a freshly replayed
-- migration set. Section M of the migration already asserts four of these -- the guards
-- exist, the ledger has no write policy, RLS is on, the private definers are
-- unreachable -- and that is not duplication. Section M ran once, on the machine that
-- installed it. This runs against the database in front of you, which is the only place
-- a later migration's `create policy ... for all` can be caught.
--
-- Part 2 drives the lifecycle inside `begin ... rollback` with disposable auth.users
-- rows, because separation of duties cannot be tested by one account: FINANCE holds all
-- four verbs and OPERATIONS_MANAGER holds three, and the missing fourth is the whole
-- claim of section J. It never asserts anything about row visibility -- the
-- fresh-database harness runs as superuser, row security is bypassed there, and a
-- visibility assertion would pass for the wrong reason.
--
-- Part 3 checks that nothing survived.
--
-- Refusals are matched on SQLSTATE, never on message text: a message can be reworded and
-- a test that reads it then fails for the wrong reason. 22023 is "this definition is
-- incoherent", 42501 is "you are not the one who may do this", 23503 is "something still
-- refers to that", 23505 is "that name is taken" and 23514 is "the row itself is
-- illegal" -- and the differences between them are the design.
--
-- One refusal helper, where the BI suite needed two. private.bi_run_query catches `when
-- others` so that a refused query is still audited, which means its refusals have to be
-- read off a returned {ok:false, error_code} payload. No modeling_* command does that.
-- Every one raises, so pg_temp.mdl_refuses covers the whole file.
--
-- Every check emits `check_name, pass`. run-sql-gate.mjs fails the process on a false or
-- NULL pass, and fails a suite that asserted nothing at all. Part 2 reports by raising
-- instead: an exception under ON_ERROR_STOP=1 fails the gate just as hard, and inside a
-- PL/pgSQL block it can say which step broke.

-- ============================================================================
-- Part 1 -- the catalog. No writes, no session, no fixtures.
-- ============================================================================

-- 1a. The six tables exist and row security is on.
--
--     Five carry the definition; the sixth is the certificate ledger, which carries no
--     definition at all and still has RLS enabled, because its read policy is the only
--     thing that keeps one agency's grades from being readable by another's.
select
  'modeling_tables_present_and_rls_enabled' as check_name,
  count(*) filter (where c.relrowsecurity) = 6 as pass,
  string_agg(
    e.t || case when c.oid is null then ' MISSING'
                when not c.relrowsecurity then ' RLS-OFF'
                else ' ok' end, ', ' order by e.t) as detail
from (values
  ('modeling_models'), ('modeling_assumptions'), ('modeling_rows'),
  ('modeling_scenarios'), ('modeling_overrides'), ('modeling_certificates')
) as e(t)
left join pg_class c
  on c.oid = to_regclass('public.' || e.t)
 and c.relnamespace = 'public'::regnamespace;

-- 1b. anon holds no privilege on any of the six.
--
--     The missing-table case folds to NULL rather than to true. has_table_privilege
--     raises on a relation that does not exist, and a check that swallowed that would
--     report a deleted table as secure -- which is the one wrong answer this check must
--     never give. NULL fails the gate, which is correct: a table that is gone is not a
--     table that is safe.
select
  'modeling_anon_holds_no_table_privilege' as check_name,
  bool_and(not coalesce(g.granted, true)) and count(*) = 24 as pass,
  coalesce(string_agg(g.t || '.' || g.priv, ', ' order by g.t, g.priv)
           filter (where g.granted is not false), 'none') as detail
from (
  select e.t, v.priv,
         case when to_regclass('public.' || e.t) is null then null
              else has_table_privilege('anon', 'public.' || e.t, v.priv) end as granted
  from (values
    ('modeling_models'), ('modeling_assumptions'), ('modeling_rows'),
    ('modeling_scenarios'), ('modeling_overrides'), ('modeling_certificates')
  ) as e(t)
  cross join (values ('select'), ('insert'), ('update'), ('delete')) as v(priv)
) g;

-- 1c. The five definition tables carry exactly four scoped policies each.
--
--     Four verbs, named, each one consulting row_in_staff_scope. The count is the check
--     that matters: a later migration adding a fifth policy `for all` would leave all
--     four of these in place and still open the table, and only the count sees it.
select
  'modeling_definition_tables_have_four_scoped_policies' as check_name,
  count(*) = 5 and bool_and(p.n = 4 and p.scoped = 4 and p.blanket = 0) as pass,
  string_agg(p.tablename || '=' || p.n || '/' || p.scoped ||
             case when p.blanket > 0 then ' BLANKET' else '' end,
             ', ' order by p.tablename) as detail
from (
  select pol.tablename,
         count(*) as n,
         count(*) filter (
           where coalesce(pol.qual, '') like '%row_in_staff_scope%'
              or coalesce(pol.with_check, '') like '%row_in_staff_scope%') as scoped,
         count(*) filter (where pol.cmd = 'ALL') as blanket
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename in ('modeling_models', 'modeling_assumptions', 'modeling_rows',
                          'modeling_scenarios', 'modeling_overrides')
  group by pol.tablename
) p;

-- 1d. Every UPDATE policy carries WITH CHECK.
--
--     USING alone decides which rows you may reach. Without WITH CHECK an update may
--     reach a row in your scope and leave it in somebody else's, which is not a leak on
--     the way in -- it is a write out of the tenant.
select
  'modeling_update_policies_carry_with_check' as check_name,
  count(*) = 5 and count(*) filter (where pol.with_check is not null) = 5 as pass,
  coalesce(string_agg(pol.tablename || '.' || pol.policyname, ', ' order by pol.tablename)
           filter (where pol.with_check is null), 'all five carry it') as detail
from pg_policies pol
where pol.schemaname = 'public'
  and pol.cmd = 'UPDATE'
  and pol.tablename in ('modeling_models', 'modeling_assumptions', 'modeling_rows',
                        'modeling_scenarios', 'modeling_overrides');

-- 1e. The certificate ledger is append-only, twice over.
--
--     Once in the policies -- nothing but SELECT exists -- and once in the grants, which
--     is the half that actually holds. A ledger with no INSERT policy and an INSERT
--     privilege is not append-only, it is unwritable through PostgREST and writable by
--     anyone who finds the right function; the reverse pair is the real design, so both
--     halves are asserted here rather than one standing in for the other.
select
  'modeling_ledger_is_append_only' as check_name,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'modeling_certificates') = 1
  and (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'modeling_certificates'
          and cmd <> 'SELECT') = 0
  and has_table_privilege('authenticated', 'public.modeling_certificates', 'select')
  and not has_table_privilege('authenticated', 'public.modeling_certificates', 'insert')
  and not has_table_privilege('authenticated', 'public.modeling_certificates', 'update')
  and not has_table_privilege('authenticated', 'public.modeling_certificates', 'delete')
    as pass,
  (select coalesce(string_agg(policyname || ':' || cmd, ', ' order by policyname),
                   'no policy at all')
     from pg_policies
    where schemaname = 'public' and tablename = 'modeling_certificates') as detail;

-- 1f. Reading a grade requires being allowed to open the model it grades.
--
--     The ledger's one policy is written against has_permission('modeling_models','read')
--     and not against a permission of its own, deliberately: a role that cannot open the
--     model must not be able to read that it failed certification. That is a sentence in
--     a comment in the migration; here it is a string in a catalog.
select
  'modeling_ledger_read_is_gated_by_model_read' as check_name,
  count(*) = 1 as pass,
  coalesce(max(left(pol.qual, 200)), 'no SELECT policy on the ledger') as detail
from pg_policies pol
where pol.schemaname = 'public'
  and pol.tablename = 'modeling_certificates'
  and pol.cmd = 'SELECT'
  and pol.qual like '%modeling_models%'
  and pol.qual like '%row_in_staff_scope%';

-- 1g. The five guards exist, are attached to the right table, and are enabled.
--
--     tgenabled is the column that makes this worth writing. `alter table ... disable
--     trigger` leaves the trigger in the catalog, so a check that only looked for the
--     name would pass on a database where the namespace guard had been switched off --
--     and every check in Part 2 that proves a refusal would then be proving it against
--     a guard nobody can rely on.
select
  'modeling_guard_triggers_are_attached_and_enabled' as check_name,
  count(*) filter (where t.oid is not null and t.tgenabled = 'O') = 5 as pass,
  string_agg(
    e.trg || case when t.oid is null then ' MISSING'
                  when t.tgenabled <> 'O' then ' DISABLED(' || t.tgenabled || ')'
                  else ' ok' end, ', ' order by e.trg) as detail
from (values
  ('modeling_rows',        'trg_modeling_rows_namespace'),
  ('modeling_assumptions', 'trg_modeling_assumptions_namespace'),
  ('modeling_rows',        'trg_modeling_rows_series'),
  ('modeling_models',      'trg_modeling_models_horizon'),
  ('modeling_scenarios',   'trg_modeling_scenarios_chain')
) as e(tbl, trg)
left join pg_trigger t
  on t.tgname = e.trg
 and t.tgrelid = to_regclass('public.' || e.tbl)
 and not t.tgisinternal;

-- 1h. Scope is stamped on all six; updated_at is maintained on the five that update.
--
--     The ledger is the interesting half. It gets trg_stamp_staff_scope, because a
--     certificate belongs to an agency like everything else, and it deliberately gets no
--     updated_at trigger, because it has no updated_at column: nothing updates a
--     certificate. A trigger there would be a promise the table cannot keep.
select
  'modeling_stamp_and_updated_at_triggers_are_exact' as check_name,
  count(*) filter (where e.stamped) = 6
  and count(*) filter (where e.touched) = 5
  and count(*) filter (where e.touched and e.t = 'modeling_certificates') = 0 as pass,
  string_agg(e.t ||
    case when not e.stamped then ' NO-STAMP' else '' end ||
    case when e.touched then '' when e.t = 'modeling_certificates' then ' (no updated_at, by design)'
         else ' NO-UPDATED-AT' end, ', ' order by e.t) as detail
from (
  select v.t,
         exists (select 1 from pg_trigger g
                  where g.tgrelid = to_regclass('public.' || v.t)
                    and g.tgname = 'trg_stamp_staff_scope' and not g.tgisinternal) as stamped,
         exists (select 1 from pg_trigger g
                  where g.tgrelid = to_regclass('public.' || v.t)
                    and g.tgname = 'trg_' || v.t || '_updated_at' and not g.tgisinternal) as touched
  from (values
    ('modeling_models'), ('modeling_assumptions'), ('modeling_rows'),
    ('modeling_scenarios'), ('modeling_overrides'), ('modeling_certificates')
  ) as v(t)
) e;

-- 1i. The public surface is exactly the seventeen, and it is granted to authenticated
--     and not to anon.
--
--     Three read models and fourteen commands. "Exactly" is the load-bearing word: a
--     private body promoted to public by a later migration, or a wrapper left behind
--     after its signature changed, is a definer function nobody is testing.
select
  'modeling_public_surface_is_exactly_the_seventeen' as check_name,
  count(*) filter (where e.exists_now and e.auth_ok and not e.anon_ok) = 17
  and (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (p.proname like '%modeling%' or p.proname like 'modeling%')) = 17 as pass,
  coalesce(string_agg(e.sig ||
    case when not e.exists_now then ' MISSING'
         when not e.auth_ok then ' NOT-GRANTED'
         else ' ANON-CAN-EXECUTE' end, ', ' order by e.sig)
    filter (where not (e.exists_now and e.auth_ok and not e.anon_ok)),
    'all seventeen present, authenticated only') as detail
from (
  select v.sig,
         to_regprocedure(v.sig) is not null as exists_now,
         -- has_function_privilege raises on a signature that does not resolve, so the
         -- existence test has to happen inside the expression rather than beside it.
         coalesce(case when to_regprocedure(v.sig) is null then null
                       else has_function_privilege('authenticated', v.sig, 'execute') end,
                  false) as auth_ok,
         coalesce(case when to_regprocedure(v.sig) is null then null
                       else has_function_privilege('anon', v.sig, 'execute') end,
                  true) as anon_ok
  from (values
    ('public.get_modeling_spec(uuid)'),
    ('public.get_modeling_overview()'),
    ('public.get_modeling_certificates(uuid, integer)'),
    ('public.create_modeling_model_command(text, text, text[], text, text)'),
    ('public.update_modeling_model_command(uuid, text, text[], text, text)'),
    ('public.publish_modeling_model_command(uuid, text)'),
    ('public.revise_modeling_model_command(uuid)'),
    ('public.archive_modeling_model_command(uuid, boolean)'),
    ('public.upsert_modeling_assumption_command(uuid, text, text, text, double precision, double precision, double precision, text, text, integer)'),
    ('public.delete_modeling_assumption_command(uuid, text)'),
    ('public.upsert_modeling_row_command(uuid, text, text, text, text, double precision[], text, text, integer)'),
    ('public.delete_modeling_row_command(uuid, text)'),
    ('public.upsert_modeling_scenario_command(uuid, text, text, text, text, text, integer)'),
    ('public.delete_modeling_scenario_command(uuid, text)'),
    ('public.set_modeling_override_command(uuid, text, text, double precision, text)'),
    ('public.clear_modeling_override_command(uuid, text, text)'),
    ('public.record_modeling_certificate_command(uuid, text, text, text, integer, text, text, text, integer, integer, integer, integer, jsonb, text[])')
  ) as v(sig)
) e;

-- 1j. All seventeen are SECURITY DEFINER with a pinned search_path.
--
--     A definer body without a pinned search_path is the classic Postgres escalation: the
--     caller controls search_path, so the caller chooses which `modeling_models` the
--     function reads. The pin is what makes the definer bit safe, so the two are checked
--     as one condition rather than two.
select
  'modeling_bodies_are_definer_with_pinned_search_path' as check_name,
  count(*) = 17
  and count(*) filter (where p.prosecdef) = 17
  and count(*) filter (
        where exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                       where cfg like 'search\_path=%')) = 17 as pass,
  coalesce(string_agg(p.proname ||
    case when not p.prosecdef then ' NOT-DEFINER' else ' NO-PIN' end, ', ' order by p.proname)
    filter (where not p.prosecdef
               or not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                               where cfg like 'search\_path=%')),
    'seventeen definer bodies, all pinned') as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like '%modeling%' or p.proname like 'modeling%');

-- 1k. No private modelling body is reachable by a logged-in user.
--
--     This is section M's assertion, re-asked here for the reason the whole suite exists:
--     section M ran on the machine that installed the migration, and the hole it guards
--     against is opened by the migration that comes after.
select
  'modeling_private_bodies_are_unreachable' as check_name,
  count(*) = 0 as pass,
  coalesce(string_agg(p.proname, ', ' order by p.proname), 'none reachable') as detail
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
  and p.proname like 'modeling%'
  and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute');

-- 1l. The three CHECK predicates stay executable, and that is not a softening.
--
--     A CHECK expression is evaluated as the user doing the INSERT. Revoke EXECUTE on
--     modeling_key_ok and every direct insert into these tables fails with "permission
--     denied for function modeling_key_ok" -- a privilege error about a perfectly valid
--     row, and one that would not show up in testing, because inserts through the
--     commands keep working: a definer body runs as the owner. So this check asserts the
--     grant is *present*, which is the opposite of every other ACL check in this file,
--     and it is asserted here so that a later blanket `revoke all on all functions in
--     schema private` is caught by a failing gate rather than by a support ticket.
select
  'modeling_check_predicates_stay_executable' as check_name,
  bool_and(e.ok) and count(*) = 3 as pass,
  coalesce(string_agg(e.sig, ', ' order by e.sig) filter (where not e.ok),
           'all three reachable, none of them definer') as detail
from (
  select v.sig,
         coalesce(case when to_regprocedure(v.sig) is null then null
                       else has_function_privilege('authenticated', v.sig, 'execute')
                        and not (select p.prosecdef from pg_proc p
                                  where p.oid = to_regprocedure(v.sig)) end, false) as ok
  from (values
    ('private.modeling_key_ok(text)'),
    ('private.modeling_finite(double precision)'),
    ('private.modeling_finite_series(double precision[])')
  ) as v(sig)
) e;

-- 1m. Every named constraint is present, and is still the kind of constraint it was.
--
--     The kind is the half worth asserting. A UNIQUE rebuilt as a plain index keeps its
--     name and stops enforcing anything, and a CHECK dropped and re-added as NOT VALID
--     stops applying to the rows already there. Thirty-nine rows of inventory is dull to
--     read and is the only thing that catches either.
select
  'modeling_named_constraints_present_with_the_right_kind' as check_name,
  count(*) filter (where c.conname is not null and c.convalidated) = 39 as pass,
  coalesce(string_agg(e.name ||
    case when c.conname is null then ' MISSING' else ' NOT-VALID' end, ', ' order by e.name)
    filter (where c.conname is null or not c.convalidated),
    'thirty-nine constraints, all valid') as detail
from (values
  ('modeling_models', 'modeling_models_key_unique', 'u'),
  ('modeling_models', 'modeling_models_key_shape', 'c'),
  ('modeling_models', 'modeling_models_status_check', 'c'),
  ('modeling_models', 'modeling_models_periods_check', 'c'),
  ('modeling_models', 'modeling_models_periods_named', 'c'),
  ('modeling_models', 'modeling_models_published_stamp', 'c'),
  ('modeling_assumptions', 'modeling_assumptions_unique', 'u'),
  ('modeling_assumptions', 'modeling_assumptions_key_shape', 'c'),
  ('modeling_assumptions', 'modeling_assumptions_label_present', 'c'),
  ('modeling_assumptions', 'modeling_assumptions_unit_check', 'c'),
  ('modeling_assumptions', 'modeling_assumptions_range_order', 'c'),
  ('modeling_assumptions', 'modeling_assumptions_finite', 'c'),
  ('modeling_rows', 'modeling_rows_unique', 'u'),
  ('modeling_rows', 'modeling_rows_key_shape', 'c'),
  ('modeling_rows', 'modeling_rows_label_present', 'c'),
  ('modeling_rows', 'modeling_rows_unit_check', 'c'),
  ('modeling_rows', 'modeling_rows_told_or_computed', 'c'),
  ('modeling_rows', 'modeling_rows_formula_not_blank', 'c'),
  ('modeling_rows', 'modeling_rows_given_finite', 'c'),
  ('modeling_rows', 'modeling_rows_given_bounded', 'c'),
  ('modeling_rows', 'modeling_rows_formula_bounded', 'c'),
  ('modeling_scenarios', 'modeling_scenarios_unique', 'u'),
  ('modeling_scenarios', 'modeling_scenarios_key_shape', 'c'),
  ('modeling_scenarios', 'modeling_scenarios_name_present', 'c'),
  ('modeling_scenarios', 'modeling_scenarios_base_shape', 'c'),
  ('modeling_scenarios', 'modeling_scenarios_base_not_self', 'c'),
  ('modeling_scenarios', 'modeling_scenarios_base_fk', 'f'),
  ('modeling_overrides', 'modeling_overrides_unique', 'u'),
  ('modeling_overrides', 'modeling_overrides_finite', 'c'),
  ('modeling_overrides', 'modeling_overrides_scenario_fk', 'f'),
  ('modeling_overrides', 'modeling_overrides_assumption_fk', 'f'),
  ('modeling_certificates', 'modeling_certificates_grade_check', 'c'),
  ('modeling_certificates', 'modeling_certificates_target_kind_check', 'c'),
  ('modeling_certificates', 'modeling_certificates_period_check', 'c'),
  ('modeling_certificates', 'modeling_certificates_counts_check', 'c'),
  ('modeling_certificates', 'modeling_certificates_checks_shape', 'c'),
  ('modeling_certificates', 'modeling_certificates_counts_total', 'c'),
  ('modeling_certificates', 'modeling_certificates_grade_derived', 'c'),
  ('modeling_certificates', 'modeling_certificates_hash_shape', 'c')
) as e(tbl, name, kind)
left join pg_constraint c
  on c.conname = e.name
 and c.conrelid = to_regclass('public.' || e.tbl)
 and c.contype = e.kind;

-- 1n. The named indexes are present.
--
--     Read access to a model reads every row and every override belonging to it, and the
--     ledger is queried by (model_id, results_hash) to answer "is this certificate still
--     about the model in front of me". None of these is a nicety; a sequential scan on
--     modeling_overrides is a scenario switch that takes a second.
select
  'modeling_named_indexes_present' as check_name,
  count(*) filter (where i.indexname is not null) = 8 as pass,
  coalesce(string_agg(e.name, ', ' order by e.name) filter (where i.indexname is null),
           'all eight present') as detail
from (values
  ('idx_modeling_assumptions_model'),
  ('idx_modeling_rows_model'),
  ('idx_modeling_scenarios_model'),
  ('idx_modeling_scenarios_base'),
  ('idx_modeling_overrides_scenario'),
  ('idx_modeling_overrides_assumption'),
  ('idx_modeling_certificates_model'),
  ('idx_modeling_certificates_hash')
) as e(name)
left join pg_indexes i
  on i.schemaname = 'public' and i.indexname = e.name;

-- 1o. The RBAC matrix is exact.
--
--     Twenty rows for FINANCE, fifteen for OPERATIONS_MANAGER, and nothing at all for the
--     four customer-facing roles. The last clause is the one that decays: a later seed
--     that hands AGENT a read on modeling_models to unblock a screen would satisfy every
--     other check in this file, and this is where it fails.
select
  'modeling_rbac_matrix_is_exact' as check_name,
  (select count(*) from public.staff_permissions
    where resource like 'modeling\_%' and role = 'FINANCE') = 20
  and (select count(*) from public.staff_permissions
        where resource like 'modeling\_%' and role = 'OPERATIONS_MANAGER') = 15
  and (select count(*) from public.staff_permissions
        where resource like 'modeling\_%' and role = 'OPERATIONS_MANAGER'
          and action = 'delete') = 0
  and (select count(*) from public.staff_permissions
        where resource like 'modeling\_%'
          and role in ('CRM', 'AGENT', 'VISA_AGENT', 'GUIDE')) = 0
  and (select count(*) from public.staff_permissions
        where resource like 'modeling\_%'
          and role not in ('FINANCE', 'OPERATIONS_MANAGER')) = 0 as pass,
  (select coalesce(string_agg(r.role || ':' || r.n::text, ', ' order by r.role), 'nothing seeded')
     from (select role, count(*) as n
             from public.staff_permissions
            where resource like 'modeling\_%'
            group by role) r) as detail;

-- 1p. The reserved-word list is exactly the nineteen the lexer claims.
--
--     Thirteen function names, three series forms that take a key rather than a value,
--     and the three word operators. A row keyed `min` passes the character-class half of
--     isValidKey and is still unreferenceable, because `min + 1` lexes as a call to min
--     with no arguments -- so a key no formula can name is refused where it is written
--     rather than discovered later as a parse error in somebody else's row.
--
--     Asserted by calling the predicate rather than by reading its source, because the
--     source is a text array inside a function body and a check that grepped it would
--     pass on a list that had been reordered into nonsense.
select
  'modeling_reserved_words_are_the_nineteen' as check_name,
  count(*) filter (where not private.modeling_key_ok(w.word)) = 19
  and count(*) filter (where not private.modeling_key_ok(upper(w.word))) = 19 as pass,
  coalesce(string_agg(w.word, ', ' order by w.word)
           filter (where private.modeling_key_ok(w.word)
                      or private.modeling_key_ok(upper(w.word))),
           'nineteen words refused, in either case') as detail
from (values
  ('min'), ('max'), ('avg'), ('abs'), ('floor'), ('ceil'), ('sqrt'), ('round'), ('pow'),
  ('clamp'), ('if'), ('growth'), ('pmt'), ('prior'), ('sum'), ('npv'), ('and'), ('or'), ('not')
) as w(word);

-- 1q. The key and finiteness predicates answer correctly at their edges.
--
--     Six of these are the shape rule and three are IEEE-754. The NaN case is the one
--     that would have been written wrong: IEEE says NaN = NaN is false, so `x = x` is the
--     classic NaN test, but PostgreSQL deliberately breaks that so float8 can be sorted
--     and indexed -- which means `value = value` would have let every NaN through the
--     constraint. Comparing against the literal is what works, and it is worth a check
--     that would fail if somebody ever "simplified" it back.
select
  'modeling_predicates_answer_at_their_edges' as check_name,
  private.modeling_key_ok('revenue')
  and private.modeling_key_ok('_private')
  and private.modeling_key_ok('Revenue2')
  and not private.modeling_key_ok('2revenue')
  and not private.modeling_key_ok('gross margin')
  and not private.modeling_key_ok('')
  and not private.modeling_key_ok(repeat('a', 61))
  and private.modeling_key_ok(repeat('a', 60))
  -- Not `is null`: the predicate is not STRICT, and `p_key is not null` is the first
  -- conjunct, so a null key is refused rather than returning unknown. A CHECK would have
  -- passed a null either way, which is what the column's NOT NULL is for; this asserts
  -- the predicate itself does not need help.
  and not private.modeling_key_ok(null)
  and private.modeling_finite(0.0)
  and private.modeling_finite(-1e300)
  and private.modeling_finite(null)
  and not private.modeling_finite('NaN'::double precision)
  and not private.modeling_finite('Infinity'::double precision)
  and not private.modeling_finite('-Infinity'::double precision)
  and private.modeling_finite_series(array[1.0, 2.0, 3.0]::double precision[])
  and private.modeling_finite_series('{}'::double precision[])
  and private.modeling_finite_series(null)
  and not private.modeling_finite_series(
        array[1.0::double precision, 'NaN'::double precision])
  and not private.modeling_finite_series(
        array[1.0::double precision, null::double precision]) as pass,
  'key shape, length, null, NaN, both infinities, and a null inside a series' as detail;

-- 1r. The ledger's columns are exactly the documented nineteen.
--
--     Written as an exact set rather than as three absences. The three absences are the
--     design claim -- no certified_at, no certified_by, no updated_at, because "the row
--     *is* the issuing" -- but a check that only looked for those three would pass a
--     ledger that had quietly grown a `revoked` flag, and a revocable certificate is a
--     different object with the same name. So the set is closed: nineteen names, no more.
with want(col) as (
  values ('id'), ('agency_id'), ('branch_id'), ('model_id'), ('scenario_key'),
         ('target_key'), ('target_kind'), ('target_period'), ('grade'),
         ('results_hash'), ('full_hash'), ('passed'), ('warned'), ('failed'),
         ('unmeasured'), ('checks'), ('limitations'), ('created_at'), ('created_by')
), have as (
  select a.attname as col
    from pg_attribute a
   where a.attrelid = to_regclass('public.modeling_certificates')
     and a.attnum > 0
     and not a.attisdropped
)
select
  'modeling_certificate_columns_are_the_documented_shape' as check_name,
  to_regclass('public.modeling_certificates') is not null
  and not exists (select 1 from want except select col from have)
  and not exists (select col from have except select col from want) as pass,
  coalesce(
    nullif(
      concat_ws('; ',
        nullif((select string_agg(w.col, ', ' order by w.col)
                  from (select col from want except select col from have) w), ''),
        nullif((select string_agg('unexpected ' || h.col, ', ' order by h.col)
                  from (select col from have except select col from want) h), '')),
      ''),
    (select 'the nineteen, and nothing else: ' || count(*)::text from have)) as detail;

-- 1s. Section A's repair of 20260822000014 held.
--
--     This is the half of item 10 that is not about adding anything: four tables that
--     existed, were counted as a feature, and could be rewritten by anyone who could read
--     them. The repair gave them a branch, a NOT NULL agency, four verb-specific policies
--     and the house stamp trigger. Asserted here and not only in the migration because
--     `create policy ... for all` is one line in some later file, and the blanket policy
--     this replaced is exactly the kind of thing that grows back.
--
--     Note what is *not* asserted: that public.staff_permissions seeds an `fpa_models`
--     resource. It does not, and that is a live consequence of the repair rather than a
--     defect in it -- with no seed, has_permission answers false for every role except
--     ADMIN, which short-circuits. Four tables no non-admin can read is the correct
--     resting state for four tables nothing reads. Section A says the decision to drop
--     them has a person's name on it; so does the decision to open them.
with t(name) as (
  values ('fpa_models'), ('fpa_formulas'), ('fpa_scenarios'), ('fpa_planning_cycles')
), shape as (
  select t.name,
         to_regclass('public.' || t.name) as rel,
         (select count(*) from pg_attribute a
           where a.attrelid = to_regclass('public.' || t.name)
             and a.attname = 'branch_id' and not a.attisdropped) as branch_col,
         (select count(*) from pg_attribute a
           where a.attrelid = to_regclass('public.' || t.name)
             and a.attname = 'agency_id' and a.attnotnull and not a.attisdropped) as agency_nn,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.name) as policies,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.name
             and p.policyname in ('staff_select', 'staff_insert', 'staff_update', 'staff_delete')
             and p.cmd <> 'ALL'
             -- coalesce on both halves, not just with_check: an INSERT policy has a null
             -- qual, and `null || text` is null, so a single coalesce would read
             -- staff_insert as unscoped and fail this check on a correct database.
             and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%row_in_staff_scope%') as scoped,
         (select count(*) from pg_trigger g
           where g.tgrelid = to_regclass('public.' || t.name)
             and g.tgname = 'trg_stamp_staff_scope' and g.tgenabled = 'O') as stamp,
         -- A missing table folds to "anon holds everything", so absence fails the check
         -- rather than passing it by having nothing to object to.
         (select count(*) from (values ('select'), ('insert'), ('update'), ('delete')) v(priv)
           where case when to_regclass('public.' || t.name) is null then true
                      else has_table_privilege('anon', 'public.' || t.name, v.priv) end) as anon_priv,
         coalesce((select c.relrowsecurity from pg_class c
                    where c.oid = to_regclass('public.' || t.name)), false) as rls
    from t
)
select
  'modeling_fpa_tables_are_repaired' as check_name,
  count(*) = 4
  and count(*) filter (where rel is not null) = 4
  and count(*) filter (where branch_col = 1) = 4
  and count(*) filter (where agency_nn = 1) = 4
  and count(*) filter (where policies = 4 and scoped = 4) = 4
  and count(*) filter (where stamp = 1) = 4
  and count(*) filter (where anon_priv = 0) = 4
  and count(*) filter (where rls) = 4 as pass,
  coalesce(
    string_agg(
      name || ' (' || concat_ws(' ',
        case when rel is null then 'absent' end,
        case when branch_col <> 1 then 'no branch_id' end,
        case when agency_nn <> 1 then 'agency_id nullable' end,
        case when policies <> 4 then 'policies=' || policies::text end,
        case when scoped <> 4 then 'scoped=' || scoped::text end,
        case when stamp <> 1 then 'no stamp trigger' end,
        case when anon_priv <> 0 then 'anon holds ' || anon_priv::text end,
        case when not rls then 'rls off' end) || ')',
      ', ' order by name)
      filter (where rel is null or branch_col <> 1 or agency_nn <> 1 or policies <> 4
                 or scoped <> 4 or stamp <> 1 or anon_priv <> 0 or not rls),
    'four tables, four scoped policies each, anon holds nothing') as detail;

-- 1t. The shared updated_at trigger function is still the hardened one.
--
--     20260822000014 redefined public.update_updated_at_column with no pinned
--     search_path -- and that function is attached to dozens of tables across the
--     platform, so the blast radius of that one unqualified CREATE OR REPLACE is the
--     whole schema, not the four tables the migration was about. Section A.3 re-asserted
--     the hardened definition. This check is here so the next replay that reorders
--     migrations is caught by a gate rather than by a search_path-dependent now().
--
--     PUBLIC is tested through the ACL rather than through has_function_privilege,
--     because there is no role named "public" to ask about and asking raises. The null
--     test is the load-bearing half: a null proacl means the default ACL, and the default
--     for a function is EXECUTE to PUBLIC. aclexplode(null) yields no rows, so a bare
--     `not exists` would read a wide-open function as a locked one.
select
  'modeling_updated_at_helper_is_hardened' as check_name,
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_updated_at_column'
      and p.pronargs = 0) = 1
  and (select exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                       where c like 'search\_path=%')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'update_updated_at_column'
          and p.pronargs = 0)
  and (select p.proacl is not null
          and not exists (select 1 from aclexplode(p.proacl) a
                           where a.grantee = 0 and a.privilege_type = 'EXECUTE')
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'update_updated_at_column'
          and p.pronargs = 0)
  and (select case when to_regprocedure('public.update_updated_at_column()') is null then false
                   else not has_function_privilege(
                          'anon', 'public.update_updated_at_column()', 'execute') end) as pass,
  (select coalesce(array_to_string(p.proconfig, ', '), 'no proconfig at all')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_updated_at_column'
      and p.pronargs = 0) as detail;

-- ===========================================================================
-- PART 2.  The lifecycle.
--
--   Part 1 read the catalog. This drives the subsystem: it creates a model as
--   FINANCE, tells it what it believes, computes rows from those beliefs, builds
--   a scenario chain, publishes, certifies, revises, and takes the whole thing
--   apart again -- and at every step it also does the wrong thing on purpose and
--   insists on the SQLSTATE the header promised.
--
--   Everything happens inside one transaction that ends in rollback, so the suite
--   is runnable against a database with real data in it. The accounts it invents
--   are auth.users rows with fixed @invalid.test emails; Part 3 asserts that none
--   of them survived.
--
--   Two things this part deliberately does not assert.
--
--   Row visibility: the harness runs as the owner, so RLS is bypassed and every
--   select here would pass no matter what the policies said -- checks 1c and 1d
--   read the policies themselves for exactly that reason. What *is* asserted is
--   permission and scope, because the commands are SECURITY DEFINER and apply
--   both by hand, in code, where a wrong answer is a real refusal.
--
--   Which of two overlapping constraints fires: modeling_certificates has a
--   checks_shape test and a counts_total test that calls jsonb_array_length on the
--   same column, so a non-array `checks` fails one by returning false and the other
--   by raising 22023. Postgres does not document the order in which it evaluates a
--   table's CHECKs, so a probe asserting 23514 there would be asserting an
--   implementation detail. Check 1r reads that constraint's definition instead.
-- ===========================================================================

begin;

-- The one refusal helper.
--
-- No modeling_* command swallows its own error the way private.bi_run_query does,
-- so nothing here returns a refusal as a payload. Every one raises -- and matching
-- on SQLSTATE rather than on message text is what keeps this file from failing the
-- next time somebody improves the wording of an error.
create or replace function pg_temp.mdl_refuses(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
declare v_caught text;
begin
  begin execute p_sql; exception when others then v_caught := sqlstate; end;
  if v_caught is distinct from p_state then
    raise exception '% : expected SQLSTATE %, got %', p_what, p_state,
      coalesce(v_caught, 'no error at all');
  end if;
end $fn$;

-- Becoming somebody.
--
-- set_config with is_local = true means the simulated session dies with the
-- transaction, which is what Part 3's trailing column proves. The auth.uid() check
-- is not defensive padding: if request.jwt.claims is shaped wrongly, auth.uid()
-- returns null, has_permission() then answers for no role at all, and every
-- refusal below would pass for the wrong reason.
create or replace function pg_temp.mdl_become(p_email text)
returns uuid language plpgsql as $fn$
declare v_id uuid;
begin
  select id into v_id from auth.users where email = p_email;
  if v_id is null then raise exception 'no suite account %', p_email; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
  if auth.uid() <> v_id then
    raise exception 'the simulated session did not take: auth.uid() is %', auth.uid();
  end if;
  return v_id;
end $fn$;

-- ---------------------------------------------------------------------------
-- 2a. Three disposable accounts, because the separation section J claims cannot
--     be shown by one.
--
--     A FINANCE who holds all four verbs on all five definition tables; an
--     OPERATIONS_MANAGER who may build a model and revise it and may not delete
--     anything out of it; and an AGENT who holds nothing at all -- not a smaller
--     model, not a read-only one. That last row is the one worth having: the seed
--     grants AGENT nothing, and a gate that never asks an agent for anything would
--     pass just as happily if the seed had granted them everything.
--
--     ADMIN is absent on purpose. has_permission() short-circuits on ADMIN, so an
--     admin proves the short-circuit and nothing about this subsystem's grants.
--
--     The emails are fixed rather than random so Part 3 can assert none survived.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_agency  uuid;
  v_branch  uuid;
  v_finance uuid := gen_random_uuid();
  v_ops     uuid := gen_random_uuid();
  v_agent   uuid := gen_random_uuid();
begin
  select a.id, b.id into v_agency, v_branch
    from public.agencies a
    join public.branches b on b.agency_id = a.id and b.code = 'HQ'
   where a.code = 'DEFAULT' limit 1;
  if v_agency is null then
    raise exception '2a: no DEFAULT/HQ agency; 20260324000300 seeds it, so the schema is incomplete';
  end if;

  insert into auth.users(id, email) values (v_finance, 'modeling-suite-finance@invalid.test');
  insert into auth.users(id, email) values (v_ops,     'modeling-suite-ops@invalid.test');
  insert into auth.users(id, email) values (v_agent,   'modeling-suite-agent@invalid.test');
  insert into public.staff_profiles(user_id, role, agency_id, branch_uuid, branch_id, is_active)
  values (v_finance, 'FINANCE',            v_agency, v_branch, v_branch::text, true),
         (v_ops,     'OPERATIONS_MANAGER', v_agency, v_branch, v_branch::text, true),
         (v_agent,   'AGENT',              v_agency, v_branch, v_branch::text, true);
  raise notice '2a ok: three accounts exist in DEFAULT/HQ';
end $step$;

-- ---------------------------------------------------------------------------
-- 2b. The preconditions the rest of Part 2 depends on, asserted before anything
--     is driven.
--
--     Without this block, a missing seed row surfaces eight steps later as a
--     command that mysteriously refuses, and the failure names the command rather
--     than the grant. The two rows that matter most are the ones expecting false:
--     OPERATIONS_MANAGER on delete, which 2o turns into a demonstrated refusal, and
--     AGENT on read, which is what makes 2p's 42501 mean "the seed grants agents
--     nothing" rather than "the model happened to be out of scope".
-- ---------------------------------------------------------------------------
do $step$
declare
  r      record;
  v_have boolean;
begin
  for r in
    select * from (values
      ('modeling-suite-finance@invalid.test', 'FINANCE',            'modeling_models',      'create', true),
      ('modeling-suite-finance@invalid.test', 'FINANCE',            'modeling_models',      'update', true),
      ('modeling-suite-finance@invalid.test', 'FINANCE',            'modeling_rows',        'create', true),
      ('modeling-suite-finance@invalid.test', 'FINANCE',            'modeling_rows',        'delete', true),
      ('modeling-suite-finance@invalid.test', 'FINANCE',            'modeling_assumptions', 'delete', true),
      ('modeling-suite-finance@invalid.test', 'FINANCE',            'modeling_scenarios',   'delete', true),
      ('modeling-suite-finance@invalid.test', 'FINANCE',            'modeling_overrides',   'delete', true),
      ('modeling-suite-ops@invalid.test',     'OPERATIONS_MANAGER', 'modeling_models',      'create', true),
      ('modeling-suite-ops@invalid.test',     'OPERATIONS_MANAGER', 'modeling_rows',        'update', true),
      ('modeling-suite-ops@invalid.test',     'OPERATIONS_MANAGER', 'modeling_rows',        'delete', false),
      ('modeling-suite-ops@invalid.test',     'OPERATIONS_MANAGER', 'modeling_assumptions', 'delete', false),
      ('modeling-suite-ops@invalid.test',     'OPERATIONS_MANAGER', 'modeling_scenarios',   'delete', false),
      ('modeling-suite-agent@invalid.test',   'AGENT',              'modeling_models',      'read',   false),
      ('modeling-suite-agent@invalid.test',   'AGENT',              'modeling_models',      'create', false),
      ('modeling-suite-agent@invalid.test',   'AGENT',              'modeling_rows',        'read',   false)
    ) as t(email, role, resource, action, expected)
  loop
    perform pg_temp.mdl_become(r.email);
    if public.staff_role() <> r.role then
      raise exception '2b: % came back as % rather than %',
        r.email, coalesce(public.staff_role(), 'no role'), r.role;
    end if;
    v_have := public.has_permission(r.resource, r.action);
    if v_have is distinct from r.expected then
      raise exception '2b: % on %.% is % but the rest of Part 2 needs %',
        r.role, r.resource, r.action, v_have, r.expected;
    end if;
  end loop;
  raise notice '2b ok: fifteen preconditions hold, including the five that must be false';
end $step$;

-- ---------------------------------------------------------------------------
-- 2c. The model, refused five ways and then created.
--
--     The key is not refused for being upper case, and that is the point of the
--     argument passed here: modeling_create_model normalises with lower(btrim(...)),
--     so " Suite_Plan " and "suite_plan" are the same model and a client that sends
--     the label a person typed does not create a second one. What the shape CHECK
--     does refuse is a key that could not be a formula identifier -- one character,
--     or a leading digit -- because a model key ends up in filenames and URLs.
--
--     The period refusals are the ones a reader is likely to think are the client's
--     job. They are not: an unnamed period is a column header nobody can read, and
--     an empty horizon is a model with nothing to compute over, so both are refused
--     by the table and neither depends on the screen that sent them.
--
--     Every later step finds the model by key rather than carrying an id in a temp
--     table, because the key is unique per agency and a step that re-reads it is a
--     step that cannot be looking at a stale row.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_id      uuid;
  v_out     jsonb;
  v_periods text[] := array['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06',
                            '2026-07','2026-08','2026-09','2026-10','2026-11','2026-12'];
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');

  perform pg_temp.mdl_refuses(
    $q$select public.create_modeling_model_command('x', 'One letter', array['2026-01'])$q$,
    '23514', '2c: a one-character model key fails modeling_models_key_shape');
  perform pg_temp.mdl_refuses(
    $q$select public.create_modeling_model_command('9plan', 'Digit first', array['2026-01'])$q$,
    '23514', '2c: a leading digit fails modeling_models_key_shape');
  perform pg_temp.mdl_refuses(
    $q$select public.create_modeling_model_command('empty_horizon', 'No periods', array[]::text[])$q$,
    '23514', '2c: an empty horizon fails modeling_models_periods_check');
  perform pg_temp.mdl_refuses(
    $q$select public.create_modeling_model_command('blank_period', 'Blank', array['2026-01',''])$q$,
    '23514', '2c: an empty period name fails modeling_models_periods_named');
  perform pg_temp.mdl_refuses(
    $q$select public.create_modeling_model_command('null_period', 'Null', array['2026-01', null])$q$,
    '23514', '2c: a null period fails modeling_models_periods_named');

  v_out := public.create_modeling_model_command(
             p_key => ' Suite_Plan ', p_name => 'Suite plan', p_periods => v_periods,
             p_name_ar => 'خطة', p_description => 'Written by the modeling gate.');

  if (v_out->>'ok')::boolean is not true or (v_out->>'periods')::integer <> 12 then
    raise exception '2c: create returned %', v_out;
  end if;
  v_id := (v_out->>'id')::uuid;

  select m.id into v_id from public.modeling_models m where m.key = 'suite_plan';
  if v_id is null then
    raise exception '2c: " Suite_Plan " did not normalise to suite_plan';
  end if;
  if (select status from public.modeling_models where id = v_id) <> 'DRAFT'
     or (select version from public.modeling_models where id = v_id) <> 1 then
    raise exception '2c: a new model should be DRAFT at version 1';
  end if;
  raise notice '2c ok: five refusals, then suite_plan exists as DRAFT v1 over 12 periods';
end $step$;

-- ---------------------------------------------------------------------------
-- 2d. What the model believes.
--
--     Assumptions are the only numbers in a model that a person types on purpose,
--     which is why the table refuses six different kinds of nonsense about them and
--     the engine refuses none: optimize.ts orders a backwards low/high pair rather
--     than complaining, because an in-memory spec can be assembled by anything, and
--     a stored one comes through these commands. The refusals below are what makes
--     that tolerance a convenience rather than the thing holding the model together.
--
--     The reserved-word probe is the one worth reading twice. "min" is a function
--     the formula language owns, so an assumption called min would be shadowed by
--     its own grammar -- unreadable rather than merely ambiguous.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_out   jsonb;
  v_long  text := repeat('a', 61);
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_assumption_command(%L, 'min', 'Shadowed', 'COUNT', 1)$q$,
    v_model), '23514', '2d: a reserved word fails modeling_assumptions_key_shape');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_assumption_command(%L, %L, 'Too long', 'COUNT', 1)$q$,
    v_model, v_long), '23514', '2d: a 61-character key fails modeling_assumptions_key_shape');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_assumption_command(%L, 'blank', '   ', 'COUNT', 1)$q$,
    v_model), '23514', '2d: a blank label fails modeling_assumptions_label_present');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_assumption_command(%L, 'weird', 'Bad unit', 'FURLONGS', 1)$q$,
    v_model), '23514', '2d: an unknown unit fails modeling_assumptions_unit_check');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_assumption_command(%L, 'backwards', 'Backwards', 'COUNT',
        100, 900, 400)$q$,
    v_model), '23514', '2d: low above high fails modeling_assumptions_range_order');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_assumption_command(%L, 'unbounded', 'NaN', 'COUNT',
        'NaN'::double precision)$q$,
    v_model), '23514', '2d: a NaN value fails modeling_assumptions_finite');
  raise notice '2d ok (refusals): six ways to describe a belief the table will not store';
end $step$;

do $step$
declare
  v_model uuid;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  v_out := public.upsert_modeling_assumption_command(
             v_model, 'pilgrims', 'Pilgrims', 'COUNT', 1200, 900, 1600,
             'حجاج', 'The headline volume the plan turns on.', 10);
  if (v_out->>'created')::boolean is not true then
    raise exception '2d: the first write of pilgrims should report created:true, got %', v_out;
  end if;

  v_out := public.upsert_modeling_assumption_command(
             v_model, 'price', 'Package price', 'CURRENCY', 4800, 4200, 5200,
             null, '', 20);
  if (v_out->>'created')::boolean is not true then
    raise exception '2d: the first write of price should report created:true, got %', v_out;
  end if;

  -- The same key again is an edit, not a second assumption. A client that cannot
  -- tell those apart writes duplicates, so the payload says which one happened.
  v_out := public.upsert_modeling_assumption_command(
             v_model, 'pilgrims', 'Pilgrims (revised)', 'COUNT', 1300, 900, 1600);
  if (v_out->>'created')::boolean is not false then
    raise exception '2d: the second write of pilgrims should report created:false, got %', v_out;
  end if;
  if (select count(*) from public.modeling_assumptions where model_id = v_model) <> 2 then
    raise exception '2d: two upserts of one key left more than two assumptions';
  end if;
  if (select value from public.modeling_assumptions
       where model_id = v_model and key = 'pilgrims') <> 1300 then
    raise exception '2d: the re-upsert did not take';
  end if;
  -- Omitted low/high are null rather than zero, which is what a sweep reads as
  -- "this one has no range" instead of "this one is pinned at nothing".
  if (select low from public.modeling_assumptions
       where model_id = v_model and key = 'pilgrims') <> 900 then
    raise exception '2d: the re-upsert lost the range';
  end if;
  raise notice '2d ok (writes): two assumptions, the second write of a key an edit';
end $step$;

-- ---------------------------------------------------------------------------
-- 2e. Rows, and the seven ways one can be incoherent.
--
--     A row is either told or computed -- a series of numbers somebody entered, or
--     a formula over other keys -- and never both, because a row that is both is a
--     row where nobody can say which number is the answer. That rule is a CHECK, so
--     it holds against a hand-written UPDATE and not only against these commands.
--
--     Three of these probes are about *which* refusal arrives, and that is a fact
--     about Postgres rather than about this schema: BEFORE ROW triggers run before
--     CHECK constraints. So a series longer than the horizon reports the trigger's
--     22023 even though the row is also perfectly legal by every CHECK, and a key
--     already taken in the sibling table reports the trigger's 23505 -- while a
--     reserved word, which the trigger has no opinion about, falls through to the
--     CHECK and reports 23514. Only one of those two is reachable per row.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_wide  double precision[] := array[1,2,3,4,5,6,7,8,9,10,11,12,13];
  v_long  text := repeat('1+', 2000) || '1';   -- 4001 characters
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'silent', 'Neither', 'COUNT')$q$,
    v_model), '22023', '2e: a row that is neither told nor computed is refused by the command');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'both', 'Both', 'COUNT',
        'pilgrims', array[1,2,3]::double precision[])$q$,
    v_model), '23514', '2e: formula and given together fail modeling_rows_told_or_computed');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'overlong', 'Past the horizon', 'COUNT',
        null, %L::double precision[])$q$,
    v_model, v_wide), '22023', '2e: 13 values over a 12-period horizon fail modeling_guard_series');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'pilgrims', 'Taken', 'COUNT',
        null, array[1]::double precision[])$q$,
    v_model), '23505', '2e: a key held by an assumption fails modeling_guard_namespace');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'sum', 'Reserved', 'COUNT',
        null, array[1]::double precision[])$q$,
    v_model), '23514', '2e: a reserved word fails modeling_rows_key_shape, not the guard');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'notnumbers', 'NaN', 'COUNT',
        null, array[1,2,'NaN']::double precision[])$q$,
    v_model), '23514', '2e: a NaN in a series fails modeling_rows_given_finite');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'essay', 'Too long', 'COUNT', %L)$q$,
    v_model, v_long), '23514', '2e: a 4001-character formula fails modeling_rows_formula_bounded');
  raise notice '2e ok (refusals): seven incoherent rows, each refused by the layer that owns it';
end $step$;

do $step$
declare
  v_model uuid;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  v_out := public.upsert_modeling_row_command(
             v_model, 'demand', 'Departures', 'COUNT', null,
             array[80,90,110,140,180,60,40,55,95,120,150,170]::double precision[],
             'المغادرات', 'Told, not computed: last year read off the ledger.', 10);
  if (v_out->>'created')::boolean is not true or (v_out->>'computed')::boolean is not false then
    raise exception '2e: a told row should be created:true computed:false, got %', v_out;
  end if;

  v_out := public.upsert_modeling_row_command(
             v_model, 'revenue', 'Revenue', 'CURRENCY', 'pilgrims * price',
             null, null, 'Computed from both assumptions.', 20);
  if (v_out->>'computed')::boolean is not true then
    raise exception '2e: a row with a formula should be computed:true, got %', v_out;
  end if;

  v_out := public.upsert_modeling_row_command(
             v_model, 'margin', 'Gross margin', 'CURRENCY', 'revenue * 0.18',
             null, null, '', 30);
  if (v_out->>'created')::boolean is not true then
    raise exception '2e: margin should be created:true, got %', v_out;
  end if;

  v_out := public.upsert_modeling_row_command(
             v_model, 'revenue', 'Revenue', 'CURRENCY', 'pilgrims * price * 1.0',
             null, null, 'Edited.', 20);
  if (v_out->>'created')::boolean is not false or (v_out->>'computed')::boolean is not true then
    raise exception '2e: re-upserting revenue should be created:false computed:true, got %', v_out;
  end if;

  -- note is a real column with a default of '', not a nullable one. modelingStore.ts
  -- reads it with text() rather than maybeText(), so a null here would be a client
  -- error at parse time rather than a missing sentence on a screen.
  if (select count(*) from public.modeling_rows
       where model_id = v_model and note is null) > 0 then
    raise exception '2e: a row came back with a null note';
  end if;
  if (select note from public.modeling_rows where model_id = v_model and key = 'margin') <> '' then
    raise exception '2e: an omitted note should default to the empty string';
  end if;
  raise notice '2e ok (writes): one told row, two computed, and note round-trips';
end $step$;

-- ---------------------------------------------------------------------------
-- 2f. Shortening the horizon under a series that is already longer than it.
--
--     This is the guard that exists because the obvious version of the check is on
--     the wrong side. Refusing a long series against the horizon (2e) is easy; the
--     hard direction is somebody trimming a twelve-month model to six and silently
--     orphaning half of every told row. modeling_guard_horizon returns early when
--     the horizon grows, so lengthening is free and only the truncation is refused
--     -- and it names the longest offending row, because the person who has to fix
--     it needs to know which row rather than that some row exists.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_long  text[] := array['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06',
                          '2026-07','2026-08','2026-09','2026-10','2026-11','2026-12',
                          '2027-01','2027-02'];
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  perform pg_temp.mdl_refuses(format(
    $q$select public.update_modeling_model_command(%L, 'Suite plan',
        array['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'])$q$,
    v_model), '22023', '2f: trimming 12 periods to 6 under a 12-value series fails modeling_guard_horizon');

  -- Growing it is not a refusal, and the told row keeps the length it had: the
  -- engine pads a short series, so a fourteen-period model over twelve months of
  -- history is the ordinary case rather than an inconsistency.
  perform public.update_modeling_model_command(v_model, 'Suite plan', v_long);
  if cardinality((select periods from public.modeling_models where id = v_model)) <> 14 then
    raise exception '2f: the horizon did not grow to 14';
  end if;
  if cardinality((select given from public.modeling_rows
                   where model_id = v_model and key = 'demand')) <> 12 then
    raise exception '2f: growing the horizon should not have touched the series';
  end if;
  raise notice '2f ok: truncation refused, growth allowed, series untouched';
end $step$;

-- ---------------------------------------------------------------------------
-- 2g. Scenarios, and three shapes of inheritance that are not a tree.
--
--     A scenario inherits its parent's overrides and replaces the ones it names, so
--     the chain has to reach a root. Three ways it might not, and three different
--     answers, all of them correct:
--
--       a scenario based on itself     -> 23514, the chain guard, which sees the key
--                                        it started from on the first hop;
--       a scenario based on nothing    -> 23503, the composite FK at end of
--                                        statement, because the guard walks to a
--                                        missing row, gets null, and has nothing to
--                                        complain about -- the reference is the
--                                        problem, not the shape;
--       a ring closed after the fact   -> 23514, again the guard, on the UPDATE
--                                        that closes it rather than on either
--                                        insert that built it.
--
--     The third is why the guard fires on update and not only on insert: neither
--     half of a ring is illegal on its own.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  v_out := public.upsert_modeling_scenario_command(
             v_model, 'base', 'Base case', null, 'الأساس', 'The plan of record.', 10);
  if (v_out->>'created')::boolean is not true or v_out->>'base' is not null then
    raise exception '2g: a root scenario should report base:null, got %', v_out;
  end if;
  v_out := public.upsert_modeling_scenario_command(
             v_model, 'upside', 'Upside', 'base', null, 'Volume holds.', 20);
  if v_out->>'base' <> 'base' then
    raise exception '2g: upside should report base:base, got %', v_out;
  end if;

  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_scenario_command(%L, 'loop', 'Loop', 'loop')$q$,
    v_model), '23514', '2g: a scenario based on itself fails modeling_guard_chain');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_scenario_command(%L, 'orphan', 'Orphan', 'nosuch')$q$,
    v_model), '23503', '2g: a base that does not exist fails modeling_scenarios_base_fk');
  raise notice '2g ok (tree): two scenarios, self-reference 23514, missing base 23503';
end $step$;

do $step$
declare
  v_model uuid;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  -- Neither of these two is illegal. The ring only exists once ring_a points back.
  perform public.upsert_modeling_scenario_command(v_model, 'ring_a', 'Ring A', null);
  perform public.upsert_modeling_scenario_command(v_model, 'ring_b', 'Ring B', 'ring_a');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_scenario_command(%L, 'ring_a', 'Ring A', 'ring_b')$q$,
    v_model), '23514', '2g: closing a ring on update fails modeling_guard_chain');
  if (select base_key from public.modeling_scenarios
       where model_id = v_model and key = 'ring_a') is not null then
    raise exception '2g: the refused update still changed ring_a';
  end if;

  -- Taking the pair apart is itself an ordering assertion: ring_b names ring_a, so
  -- ring_a cannot go first. That refusal is an explicit raise rather than an FK
  -- violation, because "something still inherits from that" is a sentence a person
  -- can act on and "violates foreign key constraint" is not.
  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_scenario_command(%L, 'ring_a')$q$,
    v_model), '23503', '2g: deleting an inherited-from scenario is refused by modeling_delete_scenario');
  perform public.delete_modeling_scenario_command(v_model, 'ring_b');
  perform public.delete_modeling_scenario_command(v_model, 'ring_a');
  if (select count(*) from public.modeling_scenarios where model_id = v_model) <> 2 then
    raise exception '2g: the ring did not clean up; % scenarios left',
      (select count(*) from public.modeling_scenarios where model_id = v_model);
  end if;
  raise notice '2g ok (ring): closed ring 23514, and the pair only unwinds child first';
end $step$;

-- ---------------------------------------------------------------------------
-- 2h. The depth cap, on a model of its own.
--
--     modeling_guard_chain refuses a chain more than 64 levels deep, and that limit
--     is not there to stop a ring -- the seen-list already does that. It is there
--     because the walk is a loop of single-row lookups, so a chain built by a script
--     could make every scenario write quadratic. 64 is well past any inheritance a
--     person would author and cheap enough to walk on every insert.
--
--     v_depth counts hops, so s0 is a root at zero and s64 sits at 64: sixty-five
--     scenarios that are all legal, and s65 is the first refusal. Its own model,
--     because sixty-six scenarios in suite_plan would drown every count 2q reads.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_deep uuid;
  i      integer;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  v_deep := (public.create_modeling_model_command(
               'suite_deep', 'Depth probe', array['2026-01']) ->> 'id')::uuid;

  perform public.upsert_modeling_scenario_command(v_deep, 's0', 'Root', null);
  for i in 1..64 loop
    perform public.upsert_modeling_scenario_command(
      v_deep, 's' || i, 'Level ' || i, 's' || (i - 1));
  end loop;
  if (select count(*) from public.modeling_scenarios where model_id = v_deep) <> 65 then
    raise exception '2h: 65 scenarios should have been accepted, got %',
      (select count(*) from public.modeling_scenarios where model_id = v_deep);
  end if;

  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_scenario_command(%L, 's65', 'Level 65', 's64')$q$,
    v_deep), '23514', '2h: the 65th level of inheritance fails modeling_guard_chain');
  raise notice '2h ok: 64 levels deep is legal, 65 is not';
end $step$;

-- ---------------------------------------------------------------------------
-- 2i. Overrides: what one scenario says differently.
--
--     An override is a scenario naming an assumption and a number, and the pair of
--     composite foreign keys is what stops it being a scenario naming a belief the
--     model does not hold. Both refusals below are 23503 and both matter: an
--     override against a deleted scenario is a value nothing will ever read, and one
--     against a deleted assumption is a value the engine cannot attach to anything.
--
--     Two payload facts a client depends on. set reports created, so a screen can
--     tell "this scenario now differs here" from "this scenario differed already and
--     now differs by more". clear reports a row count rather than raising on a miss,
--     because clearing an override that was never there is the same end state, and a
--     command that raised would make an idempotent reset impossible to write.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  perform pg_temp.mdl_refuses(format(
    $q$select public.set_modeling_override_command(%L, 'nosuch', 'pilgrims', 1)$q$,
    v_model), '23503', '2i: an override on a missing scenario fails the composite FK');
  perform pg_temp.mdl_refuses(format(
    $q$select public.set_modeling_override_command(%L, 'upside', 'nosuch', 1)$q$,
    v_model), '23503', '2i: an override on a missing assumption fails the composite FK');
  perform pg_temp.mdl_refuses(format(
    $q$select public.set_modeling_override_command(%L, 'upside', 'pilgrims',
        'Infinity'::double precision)$q$,
    v_model), '23514', '2i: an infinite override fails modeling_overrides_finite');

  v_out := public.set_modeling_override_command(v_model, 'upside', 'pilgrims', 1600,
             'Volume holds through Ramadan.');
  if (v_out->>'created')::boolean is not true then
    raise exception '2i: the first override should report created:true, got %', v_out;
  end if;
  v_out := public.set_modeling_override_command(v_model, 'upside', 'pilgrims', 1700);
  if (v_out->>'created')::boolean is not false then
    raise exception '2i: overriding the same pair again should report created:false, got %', v_out;
  end if;
  v_out := public.set_modeling_override_command(v_model, 'upside', 'price', 5000);
  if (v_out->>'assumption') <> 'price' then
    raise exception '2i: the payload should name the assumption, got %', v_out;
  end if;
  raise notice '2i ok (writes): three refusals, two overrides on upside, one of them an edit';
end $step$;

do $step$
declare
  v_model uuid;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  v_out := public.clear_modeling_override_command(v_model, 'upside', 'price');
  if (v_out->>'deleted')::integer <> 1 then
    raise exception '2i: clearing a real override should report deleted:1, got %', v_out;
  end if;
  -- Again, and this time it is not there. No raise: the end state is what was asked
  -- for, and a screen that resets a scenario should not have to know which of its
  -- assumptions currently differ.
  v_out := public.clear_modeling_override_command(v_model, 'upside', 'price');
  if (v_out->>'deleted')::integer <> 0 then
    raise exception '2i: clearing nothing should report deleted:0 and not raise, got %', v_out;
  end if;
  if (select count(*) from public.modeling_overrides where model_id = v_model) <> 1 then
    raise exception '2i: upside should be left with exactly one override';
  end if;
  raise notice '2i ok (clear): deleted:1 then deleted:0, and clearing twice is not an error';
end $step$;

-- ---------------------------------------------------------------------------
-- 2j. Publishing refuses three ways, in a fixed order, on a model built to be
--     refused by each of them in turn.
--
--     The order is the assertion. modeling_publish_model checks the guard, then the
--     hash's shape, then that the model has any rows, then that it has at least two
--     scenarios -- so a bare model with a bad hash reports the hash and says nothing
--     about being empty. A client that fixed the complaints in the order they arrive
--     ends up with a model that publishes; a client told everything at once has to
--     decide what to show first, and would show whichever it happened to read.
--
--     Two scenarios rather than one, because a published plan with a single scenario
--     is a forecast presented as if it had no alternative. That is a claim about
--     what publishing means here, and it is enforced rather than documented.
--
--     The hash is not normalised anywhere: an upper-case hex string is refused, not
--     lowered. The hash comes from hash64 in the engine, which emits lower case, so
--     accepting either would mean two spellings of one model's identity.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_bare uuid;
  v_out  jsonb;
  v_hash text := '0123456789abcdef';
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  v_bare := (public.create_modeling_model_command(
               'suite_bare', 'Bare', array['2026-01','2026-02']) ->> 'id')::uuid;

  perform pg_temp.mdl_refuses(format(
    $q$select public.publish_modeling_model_command(%L, 'not-a-hash')$q$,
    v_bare), '22023', '2j: a malformed hash is refused before the model is examined at all');
  perform pg_temp.mdl_refuses(format(
    $q$select public.publish_modeling_model_command(%L, 'ABCDEF0123456789')$q$,
    v_bare), '22023', '2j: an upper-case hash is refused; hash64 emits lower case');
  perform pg_temp.mdl_refuses(format(
    $q$select public.publish_modeling_model_command(%L, %L)$q$,
    v_bare, v_hash), '22023', '2j: a model with no rows cannot be published');

  perform public.upsert_modeling_row_command(
    v_bare, 'only', 'The only row', 'COUNT', null, array[1,2]::double precision[]);
  perform public.upsert_modeling_scenario_command(v_bare, 'base', 'Base', null);
  perform pg_temp.mdl_refuses(format(
    $q$select public.publish_modeling_model_command(%L, %L)$q$,
    v_bare, v_hash), '22023', '2j: a model with one scenario cannot be published');

  perform public.upsert_modeling_scenario_command(v_bare, 'other', 'Other', 'base');
  v_out := public.publish_modeling_model_command(v_bare, v_hash);
  if (v_out->>'version')::integer <> 2 or v_out->>'publishedHash' <> v_hash then
    raise exception '2j: the minimal publishable model returned %', v_out;
  end if;
  raise notice '2j ok: hash, then rows, then scenarios -- and then it publishes at v2';
end $step$;

-- ---------------------------------------------------------------------------
-- 2k. Publishing the real model, and what a published model stops accepting.
--
--     Every editing command routes through modeling_guard with p_require_draft on,
--     so PUBLISHED is not a flag a screen is asked to respect -- it is four separate
--     refusals in the database, and the four probes below are four different commands
--     reporting the same 22023 for the same reason. That is the point: if the check
--     lived in the UI, each of these would be a place it could be forgotten.
--
--     Archiving is refused too, and that one is not the guard: modeling_set_archived
--     passes p_require_draft => false precisely so it can act on non-draft models,
--     then raises on its own for the published case. Archiving a published plan would
--     retire a document other records point at, so it has to be revised first.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_out   jsonb;
  v_hash  text := 'beefcafe12345678';
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  v_out := public.publish_modeling_model_command(v_model, v_hash);
  if (v_out->>'version')::integer <> 2 or v_out->>'publishedHash' <> v_hash then
    raise exception '2k: publish returned %', v_out;
  end if;
  if (select status from public.modeling_models where id = v_model) <> 'PUBLISHED'
     or (select published_at from public.modeling_models where id = v_model) is null then
    raise exception '2k: publishing left the model without a status or a timestamp';
  end if;

  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'late', 'Too late', 'COUNT', 'pilgrims')$q$,
    v_model), '22023', '2k: a published model refuses a new row');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_assumption_command(%L, 'late', 'Too late', 'COUNT', 1)$q$,
    v_model), '22023', '2k: a published model refuses a new assumption');
  perform pg_temp.mdl_refuses(format(
    $q$select public.set_modeling_override_command(%L, 'upside', 'price', 5100)$q$,
    v_model), '22023', '2k: a published model refuses a new override');
  perform pg_temp.mdl_refuses(format(
    $q$select public.update_modeling_model_command(%L, 'Renamed', array['2026-01'])$q$,
    v_model), '22023', '2k: a published model refuses being renamed');
  perform pg_temp.mdl_refuses(format(
    $q$select public.archive_modeling_model_command(%L, true)$q$,
    v_model), '22023', '2k: a published model refuses being archived, from set_archived itself');
  raise notice '2k ok: suite_plan is PUBLISHED at v2 and refuses five kinds of edit';
end $step$;

-- ---------------------------------------------------------------------------
-- 2l. The ledger, which is the only table here that is append-only.
--
--     A certificate says: at this hash, for this scenario and this number, the checks
--     came out this way. It is recorded rather than derived, and that is deliberate --
--     the grade CHECK is only a test of anything because the client is allowed to send
--     a grade that disagrees with its own counts and be refused. A command that
--     computed the grade itself would make the constraint trivially true.
--
--     stale is the field worth watching. The model's published hash is the identity of
--     what was published; a certificate carrying a different full hash is a statement
--     about a model that is no longer the published one, and it is recorded anyway
--     with stale:true rather than refused, because the honest record of a check run
--     against a since-changed model is that it happened and no longer applies.
--
--     Certifying works while PUBLISHED -- guard called with p_require_draft => false --
--     which is the whole point of a published hash existing.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model  uuid;
  v_out    jsonb;
  v_hash   text  := 'beefcafe12345678';
  v_checks jsonb := '[{"id":"a","state":"PASS"},{"id":"b","state":"PASS"},{"id":"c","state":"PASS"}]';
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  v_out := public.record_modeling_certificate_command(
             v_model, 'base', 'revenue', 'TOTAL', 0, 'CERTIFIED',
             'aaaabbbbccccdddd', v_hash, 3, 0, 0, 0, v_checks);
  if (v_out->>'grade') <> 'CERTIFIED' or (v_out->>'stale')::boolean is not false then
    raise exception '2l: a certificate at the published hash should not be stale, got %', v_out;
  end if;

  v_out := public.record_modeling_certificate_command(
             v_model, 'upside', 'margin', 'AT', 5, 'PROVISIONAL',
             'ddddccccbbbbaaaa', '1111222233334444', 1, 1, 0, 1, v_checks,
             array['Ran before the horizon was extended.']);
  if (v_out->>'stale')::boolean is not true then
    raise exception '2l: a certificate at another hash should be stale, got %', v_out;
  end if;

  perform pg_temp.mdl_refuses(format(
    $q$select public.record_modeling_certificate_command(%L, 'nosuch', 'revenue', 'TOTAL', 0,
        'CERTIFIED', 'aaaabbbbccccdddd', %L, 0, 0, 0, 0, '[]'::jsonb)$q$,
    v_model, v_hash), '22023', '2l: certifying a scenario the model does not have');
  perform pg_temp.mdl_refuses(format(
    $q$select public.record_modeling_certificate_command(%L, 'base', 'nosuch', 'TOTAL', 0,
        'CERTIFIED', 'aaaabbbbccccdddd', %L, 0, 0, 0, 0, '[]'::jsonb)$q$,
    v_model, v_hash), '22023', '2l: certifying a row the model does not have');
  raise notice '2l ok (writes): two certificates, one stale by design, two 22023 refusals';
end $step$;

-- Seven certificates that are each wrong in exactly one way.
--
-- Isolating one constraint per probe is most of the work in this step, because the
-- arithmetic constraints overlap: a bad count total is usually also a bad grade. So
-- the counts_total probe carries a grade its counts genuinely imply, the grade_derived
-- probe carries counts that genuinely add up, and the counts_check probe carries a
-- negative passed while still totalling to its checks array.
--
-- The one that is not isolated is grade_check: 'GOLD' is not in the allowed set and is
-- also not what the counts derive, so two CHECKs disagree with it. Both are 23514, so
-- the assertion is unambiguous even though which one fired is not -- and that is the
-- same reasoning that made checks_shape unprobeable, where the two codes differ.
do $step$
declare
  v_model uuid;
  v_hash  text := 'beefcafe12345678';
  v_call  text := $q$select public.record_modeling_certificate_command(%L, 'base', %L, %L, %s,
    %L, %L, %L, %s, %s, %s, %s, %L::jsonb)$q$;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  perform pg_temp.mdl_refuses(format(v_call, v_model, 'revenue', 'TOTAL', 0, 'CERTIFIED',
    'aaaabbbbccccdddd', v_hash, 1, 0, 0, 0, '[]'),
    '23514', '2l: counts that do not add up to the checks array fail counts_total');
  perform pg_temp.mdl_refuses(format(v_call, v_model, 'revenue', 'TOTAL', 0, 'CERTIFIED',
    'aaaabbbbccccdddd', v_hash, 0, 0, 1, 0, '[{}]'),
    '23514', '2l: CERTIFIED with a failure fails grade_derived');
  perform pg_temp.mdl_refuses(format(v_call, v_model, 'revenue', 'TOTAL', 0, 'CERTIFIED',
    'zzzz', v_hash, 0, 0, 0, 0, '[]'),
    '23514', '2l: a results hash that is not 16 hex characters fails hash_shape');
  perform pg_temp.mdl_refuses(format(v_call, v_model, 'revenue', 'TOTAL', 0, 'PROVISIONAL',
    'aaaabbbbccccdddd', v_hash, -1, 0, 0, 1, '[]'),
    '23514', '2l: a negative count fails counts_check');
  perform pg_temp.mdl_refuses(format(v_call, v_model, 'revenue', 'MIDDLE', 0, 'CERTIFIED',
    'aaaabbbbccccdddd', v_hash, 0, 0, 0, 0, '[]'),
    '23514', '2l: a target kind outside AT/TOTAL/FINAL fails target_kind_check');
  perform pg_temp.mdl_refuses(format(v_call, v_model, 'revenue', 'AT', -1, 'CERTIFIED',
    'aaaabbbbccccdddd', v_hash, 0, 0, 0, 0, '[]'),
    '23514', '2l: a negative target period fails period_check');
  perform pg_temp.mdl_refuses(format(v_call, v_model, 'revenue', 'TOTAL', 0, 'GOLD',
    'aaaabbbbccccdddd', v_hash, 0, 0, 0, 0, '[]'),
    '23514', '2l: an invented grade fails grade_check');

  if (select count(*) from public.modeling_certificates where model_id = v_model) <> 2 then
    raise exception '2l: a refused certificate reached the ledger; % rows',
      (select count(*) from public.modeling_certificates where model_id = v_model);
  end if;
  raise notice '2l ok (constraints): seven refusals, and the ledger still holds two rows';
end $step$;

-- ---------------------------------------------------------------------------
-- 2m. Revising back to draft, which is the only way out of PUBLISHED.
--
--     Revising clears the published hash, and that is the cost the command exists to
--     make explicit: the model stops being the thing the certificates were issued
--     against. The certificates are not touched -- the ledger is append-only, and a
--     record of a check that no longer applies is still a record of a check that
--     happened. What changes is that nothing in the model now matches their full
--     hash, so every one of them reads as stale from here on.
--
--     changed is false on the second call rather than an error, because a screen that
--     offers "revise" does not know whether somebody else already did.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  v_out := public.revise_modeling_model_command(v_model);
  if v_out->>'status' <> 'DRAFT' or (v_out->>'changed')::boolean is not true then
    raise exception '2m: revising a published model should report changed:true, got %', v_out;
  end if;
  if (select published_hash from public.modeling_models where id = v_model) is not null then
    raise exception '2m: revising did not clear the published hash';
  end if;
  if (select version from public.modeling_models where id = v_model) <> 2 then
    raise exception '2m: revising should not move the version back';
  end if;
  if (select count(*) from public.modeling_certificates where model_id = v_model) <> 2 then
    raise exception '2m: revising deleted certificates; the ledger is append-only';
  end if;

  v_out := public.revise_modeling_model_command(v_model);
  if (v_out->>'changed')::boolean is not false then
    raise exception '2m: revising a draft again should report changed:false, got %', v_out;
  end if;

  -- And now the edits 2k refused all go through, which is the assertion that the
  -- refusals were about status and not about anything else.
  perform public.upsert_modeling_row_command(
    v_model, 'late', 'Added after revision', 'COUNT', 'demand * 1');
  perform public.set_modeling_override_command(v_model, 'upside', 'price', 5100);
  raise notice '2m ok: DRAFT again, hash cleared, certificates kept, edits accepted';
end $step$;

-- ---------------------------------------------------------------------------
-- 2n. Taking it apart, which is where the interesting refusals live.
--
--     Three of the delete commands refuse with an explicit 23503 rather than letting a
--     foreign key do it, because there is no foreign key to do it: a formula naming an
--     assumption is text, not a reference. The search is a word-boundary regex over
--     the formula, and it is documented as allowed to be wrong only in the direction of
--     refusing -- so the assertion that matters is not that "pilgrims" is protected by
--     "pilgrims * price", it is that "dem" is *not* protected by "demand * 1".
--
--     A substring match would have made short keys undeletable for reasons no message
--     could explain. That is the probe below, and it is the only reason to trust the
--     other three.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_assumption_command(%L, 'pilgrims')$q$,
    v_model), '23503', '2n: an assumption a formula names cannot be deleted');
  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_row_command(%L, 'revenue')$q$,
    v_model), '23503', '2n: a row another row computes from cannot be deleted');
  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_scenario_command(%L, 'base')$q$,
    v_model), '23503', '2n: a scenario another inherits from cannot be deleted');

  -- The boundary. "dem" occurs inside "demand * 1" and is not a reference to it.
  perform public.upsert_modeling_assumption_command(v_model, 'dem', 'Short key', 'FACTOR', 1);
  perform public.delete_modeling_assumption_command(v_model, 'dem');
  if exists (select 1 from public.modeling_assumptions
              where model_id = v_model and key = 'dem') then
    raise exception '2n: a substring of a formula identifier was treated as a reference';
  end if;
  -- And a row is protected from its own name appearing in another row, which is the
  -- same regex answering the other way.
  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_row_command(%L, 'demand')$q$,
    v_model), '23503', '2n: demand is protected because late computes from it');
  raise notice '2n ok (refusals): three 23503s, and the word boundary holds both ways';
end $step$;

do $step$
declare
  v_model uuid;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  select id into v_model from public.modeling_models where key = 'suite_plan';

  -- Leaves first. Every one of these was refused a moment ago and is legal now, which
  -- is the assertion: the refusals were about what still referred to the row, not about
  -- the row.
  perform public.delete_modeling_row_command(v_model, 'margin');
  perform public.delete_modeling_row_command(v_model, 'late');
  v_out := public.delete_modeling_row_command(v_model, 'revenue');
  if (v_out->>'deleted')::integer <> 1 or v_out->>'key' <> 'revenue' then
    raise exception '2n: deleting revenue returned %', v_out;
  end if;
  perform public.delete_modeling_row_command(v_model, 'demand');

  -- Overrides go with the assumption they qualify, by ON DELETE CASCADE rather than by
  -- a refusal, because an override is not a thing that outlives its subject.
  if (select count(*) from public.modeling_overrides where model_id = v_model) <> 2 then
    raise exception '2n: expected two overrides before the cascade';
  end if;
  perform public.delete_modeling_assumption_command(v_model, 'price');
  if (select count(*) from public.modeling_overrides where model_id = v_model) <> 1 then
    raise exception '2n: deleting price did not take its override with it';
  end if;
  perform public.delete_modeling_assumption_command(v_model, 'pilgrims');
  if (select count(*) from public.modeling_overrides where model_id = v_model) <> 0 then
    raise exception '2n: deleting pilgrims did not take its override with it';
  end if;

  -- Child scenario first, for the reason 2g already proved.
  perform public.delete_modeling_scenario_command(v_model, 'upside');
  perform public.delete_modeling_scenario_command(v_model, 'base');

  -- A key that is not there deletes nothing and does not raise, for the same reason
  -- clearing an absent override does not: the end state is what was asked for.
  v_out := public.delete_modeling_row_command(v_model, 'never_existed');
  if (v_out->>'deleted')::integer <> 0 then
    raise exception '2n: deleting a missing row should report deleted:0, got %', v_out;
  end if;
  if (select count(*) from public.modeling_certificates where model_id = v_model) <> 2 then
    raise exception '2n: emptying the model took the certificates with it';
  end if;
  raise notice '2n ok (teardown): the model is empty, overrides cascaded, ledger intact';
end $step$;

-- ---------------------------------------------------------------------------
-- 2o. The separation section J's seed actually encodes.
--
--     OPERATIONS_MANAGER holds read, create and update on all five definition tables
--     and delete on none. That is not a smaller version of FINANCE -- it is a role that
--     can build a model and cannot take anything out of one, which is the shape you
--     want when the person assembling a plan is not the person who owns its history.
--
--     The sequence is what makes this non-vacuous: ops writes a row, ops is refused
--     deleting the row it just wrote, finance deletes the same row. Same row, same
--     model, two answers -- so the 42501 is about the role and not about the row.
--
--     set_modeling_override is the interesting one. It asks for create or update
--     depending on whether the pair already exists, so ops can set an override and
--     cannot clear it: the same table, two verbs, two answers.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
begin
  select id into v_model from public.modeling_models where key = 'suite_plan';
  perform pg_temp.mdl_become('modeling-suite-ops@invalid.test');

  perform public.upsert_modeling_assumption_command(v_model, 'ops_belief', 'By ops', 'FACTOR', 2);
  perform public.upsert_modeling_row_command(
    v_model, 'ops_row', 'By ops', 'COUNT', null, array[1,2,3]::double precision[]);
  perform public.upsert_modeling_scenario_command(v_model, 'ops_case', 'By ops', null);
  perform public.set_modeling_override_command(v_model, 'ops_case', 'ops_belief', 3);

  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_row_command(%L, 'ops_row')$q$,
    v_model), '42501', '2o: ops may write a row and may not delete it');
  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_assumption_command(%L, 'ops_belief')$q$,
    v_model), '42501', '2o: ops may write an assumption and may not delete it');
  perform pg_temp.mdl_refuses(format(
    $q$select public.delete_modeling_scenario_command(%L, 'ops_case')$q$,
    v_model), '42501', '2o: ops may write a scenario and may not delete it');
  perform pg_temp.mdl_refuses(format(
    $q$select public.clear_modeling_override_command(%L, 'ops_case', 'ops_belief')$q$,
    v_model), '42501', '2o: ops may set an override and may not clear it');

  -- The same four, as finance. If any of these raised, the refusals above would have
  -- been about the rows rather than about the role.
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');
  perform public.clear_modeling_override_command(v_model, 'ops_case', 'ops_belief');
  perform public.delete_modeling_row_command(v_model, 'ops_row');
  perform public.delete_modeling_assumption_command(v_model, 'ops_belief');
  perform public.delete_modeling_scenario_command(v_model, 'ops_case');
  raise notice '2o ok: ops writes and cannot delete; finance deletes the very same rows';
end $step$;

-- ---------------------------------------------------------------------------
-- 2p. The agent, who holds nothing.
--
--     Section J grants the modelling resources to FINANCE and OPERATIONS_MANAGER and
--     to nobody else. An agent is not a reader here: they cannot list the models, they
--     cannot open one, and they cannot see its certificates -- because a forecast is a
--     statement about the business, not about a booking, and the roles that sell trips
--     have no reason to be reading next year's margin.
--
--     Seven surfaces, including all three read models, because a gate that only ever
--     probed the writes would pass just as happily if the reads had been granted to
--     everyone. The reads are the ones a seed is most likely to leak by accident.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
begin
  select id into v_model from public.modeling_models where key = 'suite_plan';
  perform pg_temp.mdl_become('modeling-suite-agent@invalid.test');

  perform pg_temp.mdl_refuses(
    $q$select public.create_modeling_model_command('agent_plan', 'Nope', array['2026-01'])$q$,
    '42501', '2p: an agent cannot create a model');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_row_command(%L, 'nope', 'Nope', 'COUNT', 'x')$q$,
    v_model), '42501', '2p: an agent cannot write a row');
  perform pg_temp.mdl_refuses(format(
    $q$select public.upsert_modeling_scenario_command(%L, 'nope', 'Nope')$q$,
    v_model), '42501', '2p: an agent cannot write a scenario');
  perform pg_temp.mdl_refuses(format(
    $q$select public.publish_modeling_model_command(%L, '0123456789abcdef')$q$,
    v_model), '42501', '2p: an agent cannot publish');
  perform pg_temp.mdl_refuses(format(
    $q$select public.record_modeling_certificate_command(%L, 'base', 'demand', 'TOTAL', 0,
        'CERTIFIED', 'aaaabbbbccccdddd', '0123456789abcdef', 0, 0, 0, 0, '[]'::jsonb)$q$,
    v_model), '42501', '2p: an agent cannot certify');
  perform pg_temp.mdl_refuses(format(
    $q$select public.get_modeling_spec(%L)$q$,
    v_model), '42501', '2p: an agent cannot read a model');
  perform pg_temp.mdl_refuses(
    $q$select public.get_modeling_overview()$q$,
    '42501', '2p: an agent cannot list the models');
  perform pg_temp.mdl_refuses(format(
    $q$select public.get_modeling_certificates(%L)$q$,
    v_model), '42501', '2p: an agent cannot read the certificates');
  raise notice '2p ok: eight surfaces, one role, 42501 every time -- reads included';
end $step$;

-- ---------------------------------------------------------------------------
-- 2q. The spec, read back whole.
--
--     Everything above this point wrote. This step is the only one that asks what a
--     client actually receives, and it matters more than it looks: `modelingStore.ts`
--     parses this object field by field, and the engine in `src/apps/modeling/engine`
--     resolves formulas against the keys it finds here. A rename on either side of
--     that boundary is a runtime error in a browser, not a compile error -- so the
--     projection is asserted key by key rather than by counting its size.
--
--     The contract with the sharpest edge is the scenario: `get_modeling_spec` emits
--     `'id', s.key`, so a DocScenario's `id` is the *database key*, not the row's uuid,
--     and `baseId` is `base_key` and not a uuid either. There is no `key` field on
--     DocScenario at all. If that ever changed to emit `s.id`, every scenario would
--     still load, every inheritance chain would silently break, and nothing would say
--     so -- which is why the assertion below is that the id equals 'base' and is not
--     a uuid, rather than merely that it is present.
--
--     Built on a model of its own rather than on the residue of nine earlier steps.
--     2n emptied `suite_plan` deliberately, and a read assertion that depended on
--     what a teardown happened to leave behind would break the next time the teardown
--     changed, for a reason that had nothing to do with reading.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_model uuid;
  v_spec  jsonb;
  v_out   jsonb;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');

  v_out := public.create_modeling_model_command(
             'suite_read', 'Suite read-back', array['2026-01', '2026-02', '2026-03']);
  select id into v_model from public.modeling_models where key = 'suite_read';

  perform public.upsert_modeling_assumption_command(
            v_model, 'pilgrims', 'Pilgrims', 'COUNT', 1000::double precision,
            800::double precision, 1200::double precision, 'حجاج', 'A ranged input.', 10);
  perform public.upsert_modeling_assumption_command(
            v_model, 'price', 'Price', 'CURRENCY', 5000::double precision,
            p_sort => 20);
  perform public.upsert_modeling_row_command(
            v_model, 'demand', 'Demand', 'COUNT',
            p_given => array[10, 20, 30]::double precision[], p_sort => 10);
  perform public.upsert_modeling_row_command(
            v_model, 'revenue', 'Revenue', 'CURRENCY',
            p_formula => 'pilgrims * price', p_sort => 20);
  perform public.upsert_modeling_scenario_command(v_model, 'base', 'Base', p_sort => 10);
  perform public.upsert_modeling_scenario_command(
            v_model, 'upside', 'Upside', 'base', p_sort => 20);
  perform public.set_modeling_override_command(
            v_model, 'upside', 'pilgrims', 1200::double precision);

  v_spec := public.get_modeling_spec(v_model);

  if v_spec->'model'->>'key' <> 'suite_read'
     or v_spec->'model'->>'status' <> 'DRAFT'
     or (v_spec->'model'->>'version')::integer <> 1
     or jsonb_typeof(v_spec->'model'->'publishedHash') <> 'null'
     or v_spec->'model'->>'id' <> v_model::text then
    raise exception '2q: the model header came back wrong: %', v_spec->'model';
  end if;

  if jsonb_array_length(v_spec->'periods') <> 3
     or v_spec->'periods'->>0 <> '2026-01'
     or v_spec->'periods'->>2 <> '2026-03' then
    raise exception '2q: periods came back as %', v_spec->'periods';
  end if;
  raise notice '2q ok (header): suite_read reads back as a DRAFT at version 1 over 3 periods';
end $step$;

-- The two collections that carry a sort order, and the one field whose JSON type is
-- load-bearing. A told row's `formula` comes back as JSON null and a computed row's
-- `given` comes back as an empty array -- not the other way around, and neither as a
-- missing key. The client reads `formula` with a nullable parser and `given` with a
-- non-nullable one, so swapping those two shapes would be a parse failure on load.
do $step$
declare
  v_model uuid;
  v_spec  jsonb;
  v_rows  jsonb;
  v_asms  jsonb;
begin
  select id into v_model from public.modeling_models where key = 'suite_read';
  v_spec := public.get_modeling_spec(v_model);
  v_rows := v_spec->'rows';
  v_asms := v_spec->'assumptions';

  if jsonb_array_length(v_rows) <> 2
     or v_rows->0->>'key' <> 'demand'
     or v_rows->1->>'key' <> 'revenue' then
    raise exception '2q: rows came back as % -- expected demand then revenue by sort_order',
      v_rows;
  end if;

  if jsonb_typeof(v_rows->0->'formula') <> 'null'
     or jsonb_array_length(v_rows->0->'given') <> 3
     or (v_rows->0->'given'->>1)::double precision <> 20 then
    raise exception '2q: the told row came back as %', v_rows->0;
  end if;

  if v_rows->1->>'formula' <> 'pilgrims * price'
     or jsonb_typeof(v_rows->1->'given') <> 'array'
     or jsonb_array_length(v_rows->1->'given') <> 0 then
    raise exception '2q: the computed row came back as %', v_rows->1;
  end if;

  if jsonb_array_length(v_asms) <> 2
     or v_asms->0->>'key' <> 'pilgrims'
     or v_asms->1->>'key' <> 'price'
     or (v_asms->0->>'low')::double precision <> 800
     or (v_asms->0->>'high')::double precision <> 1200
     or jsonb_typeof(v_asms->1->'low') <> 'null'
     or jsonb_typeof(v_asms->1->'high') <> 'null'
     or v_asms->0->>'labelAr' <> 'حجاج' then
    raise exception '2q: assumptions came back as %', v_asms;
  end if;
  raise notice '2q ok (rows): told keeps its series and a null formula, computed the reverse';
end $step$;

-- The scenario projection, which is the one place the wire format and the type in
-- `src/types/modeling.ts` disagree about vocabulary on purpose: the column is
-- `base_key`, the field is `baseId`, and the value in it is a key. DocScenario has no
-- `key` field at all, so `id` is doing that job, and the two assertions below are that
-- it holds 'base' and that it is not a uuid -- the second one is the one that would
-- catch a future `'id', s.id`, which the first one would not.
do $step$
declare
  v_model uuid;
  v_scen  jsonb;
  v_base  jsonb;
  v_up    jsonb;
begin
  select id into v_model from public.modeling_models where key = 'suite_read';
  v_scen := public.get_modeling_spec(v_model)->'scenarios';

  if jsonb_array_length(v_scen) <> 2 then
    raise exception '2q: expected two scenarios, got %', v_scen;
  end if;
  v_base := v_scen->0;
  v_up   := v_scen->1;

  if v_base->>'id' <> 'base'
     or v_base->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
     or jsonb_typeof(v_base->'baseId') <> 'null' then
    raise exception '2q: the root scenario came back as % -- id must be the key', v_base;
  end if;

  if v_up->>'id' <> 'upside' or v_up->>'baseId' <> 'base' then
    raise exception '2q: inheritance came back as % / %', v_up->>'id', v_up->>'baseId';
  end if;

  -- An empty override set is an empty object, never null and never an array: the
  -- client indexes it by assumption key without checking, and `jsonb_object_agg`
  -- over no rows returns null, which is exactly why the read coalesces it.
  if jsonb_typeof(v_base->'overrides') <> 'object'
     or v_base->'overrides' <> '{}'::jsonb then
    raise exception '2q: a scenario with no overrides came back as %', v_base->'overrides';
  end if;

  if jsonb_typeof(v_up->'overrides') <> 'object'
     or (v_up->'overrides'->>'pilgrims')::double precision <> 1200
     or (select count(*) from jsonb_object_keys(v_up->'overrides')) <> 1 then
    raise exception '2q: the overridden scenario came back as %', v_up->'overrides';
  end if;
  raise notice '2q ok (scenarios): id is the key, baseId is the base key, overrides an object';
end $step$;

-- ---------------------------------------------------------------------------
-- 2r. The other two read models.
--
--     `get_modeling_spec` is the one a screen is built from; the overview is the one a
--     rail is built from and the ledger is the one a certificate pane is built from.
--     Without this step those two would be asserted only by 2p's refusals, which prove
--     that the wrong role cannot call them and say nothing about what the right role
--     gets back. The overview's counts are the interesting part: they are subqueries
--     per model, so an off-by-one in any of them is a number on a rail that nobody can
--     reconcile against the grid it sits beside.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_read  jsonb;
  v_plan  jsonb;
  v_seen  integer;
begin
  perform pg_temp.mdl_become('modeling-suite-finance@invalid.test');

  select e into v_read from jsonb_array_elements(public.get_modeling_overview()) e
   where e->>'key' = 'suite_read';
  select e into v_plan from jsonb_array_elements(public.get_modeling_overview()) e
   where e->>'key' = 'suite_plan';

  if v_read is null or v_plan is null then
    raise exception '2r: the overview did not list both suite models';
  end if;

  if (v_read->>'periods')::integer <> 3
     or v_read->>'firstPeriod' <> '2026-01'
     or v_read->>'lastPeriod' <> '2026-03'
     or (v_read->>'rows')::integer <> 2
     or (v_read->>'computedRows')::integer <> 1
     or (v_read->>'assumptions')::integer <> 2
     or (v_read->>'rangedAssumptions')::integer <> 1
     or (v_read->>'scenarios')::integer <> 2
     or (v_read->>'overrides')::integer <> 1 then
    raise exception '2r: suite_read counted wrong: %', v_read;
  end if;

  -- A model with no certificate at all: the grade is null and `certificateStale` is
  -- false rather than null, because the expression leads with `full_hash is not null`.
  if jsonb_typeof(v_read->'certificateGrade') <> 'null'
     or (v_read->>'certificateStale')::boolean <> false then
    raise exception '2r: an uncertified model reported % / %',
      v_read->'certificateGrade', v_read->'certificateStale';
  end if;

  -- 2n emptied suite_plan and 2m revised it, so it is a published-then-revised shell
  -- that still owns its ledger. Counts at zero, a grade present, and 14 periods --
  -- the horizon 2f grew and nothing since has shortened.
  if (v_plan->>'rows')::integer <> 0
     or (v_plan->>'assumptions')::integer <> 0
     or (v_plan->>'scenarios')::integer <> 0
     or (v_plan->>'overrides')::integer <> 0
     or (v_plan->>'periods')::integer <> 14
     or v_plan->>'status' <> 'DRAFT'
     or (v_plan->>'version')::integer <> 2
     or jsonb_typeof(v_plan->'certificateGrade') = 'null' then
    raise exception '2r: suite_plan reported %', v_plan;
  end if;

  select count(*) into v_seen from jsonb_array_elements(public.get_modeling_overview());
  if v_seen <> 4 then
    raise exception '2r: expected four models in scope (plan, deep, bare, read), got %', v_seen;
  end if;
  raise notice '2r ok (overview): counts reconcile, and an uncertified model is not stale';
end $step$;

-- The ledger read, asserted without depending on its order.
--
-- Both certificates were written inside this transaction, and `created_at` defaults to
-- now(), which is transaction time and therefore identical for both -- so `order by
-- created_at desc` has nothing to sort by and either may come back first. A gate that
-- asserted `->0` here would pass or fail by luck. Each is pulled by grade instead.
--
-- `describesCurrent` is false for both, and that is not the same fact the overview
-- reported. The overview said `certificateStale` false; this says `describesCurrent`
-- false. Neither is wrong: after a revision there is no published hash, so there is no
-- *different* version for a certificate to be stale against, and no hash for it to
-- match either. The two fields answer "was this issued against something else" and
-- "does this describe what is published now", and with nothing published the honest
-- answers are no and no.
do $step$
declare
  v_model uuid;
  v_all   jsonb;
  v_cert  jsonb;
  v_prov  jsonb;
begin
  select id into v_model from public.modeling_models where key = 'suite_plan';
  v_all := public.get_modeling_certificates(v_model);

  if jsonb_array_length(v_all) <> 2 then
    raise exception '2r: expected two certificates in the ledger, got %', v_all;
  end if;

  select e into v_cert from jsonb_array_elements(v_all) e where e->>'grade' = 'CERTIFIED';
  select e into v_prov from jsonb_array_elements(v_all) e where e->>'grade' = 'PROVISIONAL';
  if v_cert is null or v_prov is null then
    raise exception '2r: the ledger did not hold one of each grade: %', v_all;
  end if;

  if v_cert->'target'->>'key' <> 'revenue'
     or v_cert->'target'->>'kind' <> 'TOTAL'
     or (v_cert->'target'->>'period')::integer <> 0
     or v_cert->>'scenario' <> 'base'
     or (v_cert->>'passed')::integer <> 3
     or jsonb_array_length(v_cert->'limitations') <> 0 then
    raise exception '2r: the CERTIFIED entry came back as %', v_cert;
  end if;

  if v_prov->'target'->>'key' <> 'margin'
     or v_prov->'target'->>'kind' <> 'AT'
     or (v_prov->'target'->>'period')::integer <> 5
     or jsonb_array_length(v_prov->'limitations') <> 1
     or (v_prov->>'unmeasured')::integer <> 1 then
    raise exception '2r: the PROVISIONAL entry came back as %', v_prov;
  end if;

  if (v_cert->>'describesCurrent')::boolean
     or (v_prov->>'describesCurrent')::boolean then
    raise exception '2r: a revised model has no published hash, so nothing describes it';
  end if;

  if jsonb_array_length(v_cert->'checks')
       <> (v_cert->>'passed')::integer + (v_cert->>'warned')::integer
        + (v_cert->>'failed')::integer + (v_cert->>'unmeasured')::integer
     or jsonb_array_length(v_prov->'checks')
       <> (v_prov->>'passed')::integer + (v_prov->>'warned')::integer
        + (v_prov->>'failed')::integer + (v_prov->>'unmeasured')::integer then
    raise exception '2r: a grade came back with more counts than checks behind it';
  end if;

  -- And the build role reads. Section J grants OPERATIONS_MANAGER read on the same
  -- five resources, so the rail is populated for the people who assemble a model even
  -- though 2o proved they cannot take anything out of it.
  perform pg_temp.mdl_become('modeling-suite-ops@invalid.test');
  if jsonb_array_length(public.get_modeling_overview()) <> 4
     or jsonb_array_length(public.get_modeling_certificates(v_model)) <> 2
     or public.get_modeling_spec(v_model)->'model'->>'key' <> 'suite_plan' then
    raise exception '2r: the build role could not read what it is allowed to build';
  end if;
  raise notice '2r ok (ledger): two grades, counts equal to checks, and ops may read';
end $step$;

rollback;

-- ---------------------------------------------------------------------------
-- Part 3. The residue check, which is the only reason Part 2 was allowed to write at
-- all. Everything above ran inside one transaction and the rollback undid it; this
-- asks the database to agree rather than assuming it.
--
-- The four models are named by key, and the five child tables are not -- deliberately.
-- Every one of them carries `model_id uuid not null references modeling_models(id) on
-- delete cascade`, so a surviving assumption would need a surviving model, and the
-- models are named directly. Naming the children by key would be worse than redundant:
-- their keys are words like `price`, `demand` and `base`, and a real model in a real
-- agency is entitled to use all three. A residue check that failed because somebody's
-- actual forecast has an assumption called `price` would be a gate that punishes use.
--
-- What is asked of the children instead is referential health: no row in any of the
-- five may point at a model that does not exist. That is a stronger statement than a
-- key match, it cannot produce a false failure, and it is the one thing a botched
-- rollback of a cascade would actually break.
--
-- The certificates get a content clause of their own because their hashes are literals
-- this suite invented -- sixteen hex digits nobody would arrive at by working.
--
-- There is no clause for staff_profiles, on the same argument: `user_id` is its primary
-- key and references auth.users(id) on delete cascade, so a surviving profile would
-- need a surviving user, and the users are named by the address pattern below. A clause
-- asking for orphaned profiles would be asking the database whether it enforces its own
-- foreign keys, which is not what this suite is for.
--
-- The trailing column reports the role the session holds now. set_config with
-- is_local = true is transaction-local, so this must read as the runner's own role: a
-- suite that leaked a simulated identity into the connection would leave every later
-- gate in the chain quietly asking its questions as somebody else.
-- ---------------------------------------------------------------------------
select 'modeling_suite_left_no_residue' as check_name,
       not exists (select 1 from public.modeling_models where key like 'suite\_%')
   and not exists (select 1 from public.modeling_rows r
                    where not exists (select 1 from public.modeling_models m
                                       where m.id = r.model_id))
   and not exists (select 1 from public.modeling_assumptions a
                    where not exists (select 1 from public.modeling_models m
                                       where m.id = a.model_id))
   and not exists (select 1 from public.modeling_scenarios s
                    where not exists (select 1 from public.modeling_models m
                                       where m.id = s.model_id))
   and not exists (select 1 from public.modeling_overrides o
                    where not exists (select 1 from public.modeling_models m
                                       where m.id = o.model_id))
   and not exists (select 1 from public.modeling_certificates c
                    where not exists (select 1 from public.modeling_models m
                                       where m.id = c.model_id))
   and not exists (select 1 from public.modeling_certificates
                    where results_hash in ('aaaabbbbccccdddd', 'ddddccccbbbbaaaa')
                       or full_hash in ('beefcafe12345678', '1111222233334444'))
   and not exists (select 1 from auth.users
                    where email like 'modeling-suite-%@invalid.test') as pass,
       coalesce(public.staff_role(), 'no staff profile') as session_role_after_rollback;
