-- BI Studio: the vertical slice, asked to prove itself.
--
-- 20260901120000_bi_studio_vertical_slice.sql installs a semantic layer whose security
-- boundary is a string. bi_metrics.formula is free text that the compiler folds into an
-- aggregate and interpolates into a statement the server then runs, so the distance
-- between this subsystem and an arbitrary-SQL endpoint is one BEFORE trigger. Most of
-- what follows is about that trigger and the allowlist it consults.
--
-- Three parts, and the split is about what each one is able to prove.
--
-- Part 1 reads the catalog. Every check evaluates on any database carrying the schema,
-- writes nothing and needs no session, so it runs in CI against a freshly replayed
-- migration set. These are the regressions that reopen a hole without changing any
-- visible behaviour: a policy recreated `for all`, a definer function that lost its
-- pinned search_path, a UNIQUE index rebuilt without UNIQUE, a private helper granted
-- to authenticated by a later migration that meant well.
--
-- Part 2 drives the lifecycle inside `begin … rollback` with disposable auth.users rows,
-- because separation of duties cannot be tested by one account: no role at all holds
-- bi_datasets.publish, so proving that costs an OPERATIONS_MANAGER who is refused and an
-- ADMIN who is not. It never asserts anything about row visibility -- the fresh-database
-- harness runs as superuser, row security is bypassed there, and a visibility assertion
-- would pass for the wrong reason.
--
-- Part 3 checks that nothing survived.
--
-- Two conventions, both easy to get wrong here.
--
-- Refusals are matched on SQLSTATE, never on message text: a message can be reworded and
-- a test that reads it then fails for the wrong reason. 22023 is "this definition is
-- incoherent", 42501 is "you are not the one who may do this", and the difference
-- between the two is the whole design.
--
-- But run_bi_query_command does not raise. private.bi_run_query catches `when others`,
-- writes a bi_query_log row and *returns* {ok:false, error_code, …}, deliberately, so
-- that a refused query is still audited. Compiler refusals reached through the query
-- command are therefore asserted on the returned payload, and pg_temp.bi_refuses is for
-- everything that does raise: direct DML against a constraint, a validation trigger,
-- set_bi_status_command.
--
-- Every check emits `check_name, pass`. run-sql-gate.mjs fails the process on a false or
-- NULL pass, and fails a suite that asserted nothing at all. Part 2 reports by raising
-- instead: an exception under ON_ERROR_STOP=1 fails the gate just as hard, and inside a
-- PL/pgSQL block it can say which step broke.
--
-- Realtime publication membership is not asserted anywhere. supabase_realtime is managed
-- outside the migration set on a hosted project, so a check on it would fail on a correct
-- database.

-- ============================================================================
-- Part 1 -- the catalog. No writes, no session, no fixtures.
-- ============================================================================

-- 1a. The eleven tables exist and row security is on.
--
--     Nine of them carry tenant data; two describe the physical schema and hold none.
--     All eleven have RLS enabled all the same, because the registry's read policy is
--     what keeps the compiler's allowlist from being readable by anon -- a table with
--     RLS off and a policy on it is a table with no policy.
with expected(t) as (
  values ('bi_sources'),('bi_source_columns'),('bi_datasets'),('bi_dimensions'),
         ('bi_metrics'),('bi_reports'),('bi_visualizations'),('bi_dashboards'),
         ('bi_dashboard_tiles'),('bi_query_log'),('bi_events')
)
select 'bi.tables_present_and_rls_enabled' as check_name,
       bool_and(c.relrowsecurity is true) as pass,
       coalesce(string_agg(e.t, ' | ' order by e.t)
                filter (where c.relrowsecurity is not true), '') as detail
  from expected e
  left join pg_class c
    on c.relname = e.t
   and c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r';

-- 1b. anon holds no privilege on any BI table.
--
--     The absent-table case folds to NULL rather than to true: has_table_privilege
--     raises on a relation that does not exist, and a check that swallowed that would
--     call a deleted table secure.
with expected(t) as (
  values ('bi_sources'),('bi_source_columns'),('bi_datasets'),('bi_dimensions'),
         ('bi_metrics'),('bi_reports'),('bi_visualizations'),('bi_dashboards'),
         ('bi_dashboard_tiles'),('bi_query_log'),('bi_events')
)
select 'bi.anon_holds_no_table_privilege' as check_name,
       bool_and(p.granted is false) as pass,
       coalesce(string_agg(e.t || '.' || p.priv, ' | ' order by e.t, p.priv)
                filter (where p.granted is not false), '') as detail
  from expected e
  cross join lateral (
    select v.priv,
           case when to_regclass('public.' || e.t) is null then null
                else has_table_privilege('anon', 'public.' || e.t, v.priv) end as granted
      from (values ('select'),('insert'),('update'),('delete')) as v(priv)
  ) p;

-- 1c. The seven definition tables carry exactly four scoped policies each.
--
--     Counted by name and by whether the expression mentions row_in_staff_scope, because
--     a table with a scoped SELECT and an unscoped INSERT reads correctly and writes
--     anywhere. 20260822000011 shipped `for all using (agency_id = current_staff_agency_id())`
--     on four of these tables: that is one policy where four are wanted, and it asks
--     nothing at all about the branch.
with expected(t) as (
  values ('bi_datasets'),('bi_dimensions'),('bi_metrics'),('bi_reports'),
         ('bi_visualizations'),('bi_dashboards'),('bi_dashboard_tiles')
), found as (
  select e.t,
         count(p.policyname) filter (
           where p.policyname in ('staff_select','staff_insert','staff_update','staff_delete')
             and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%row_in_staff_scope%'
         ) as scoped
    from expected e
    left join pg_policies p on p.schemaname = 'public' and p.tablename = e.t
   group by e.t
)
select 'bi.definition_tables_have_four_scoped_policies' as check_name,
       bool_and(scoped = 4) as pass,
       coalesce(string_agg(t || ': ' || scoped, ' | ' order by t)
                filter (where scoped <> 4), '') as detail
  from found;

-- 1d. No UPDATE policy anywhere in the subsystem is missing its WITH CHECK.
--
--     A USING-only UPDATE policy lets a row be edited into a scope its author cannot
--     read, which is how a dataset moves to another branch without anybody writing that
--     feature.
select 'bi.update_policies_carry_with_check' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(tablename || '.' || policyname, ' | '
                           order by tablename, policyname), '') as detail
  from pg_policies
 where schemaname = 'public'
   and tablename like 'bi\_%'
   and cmd = 'UPDATE'
   and with_check is null;

-- 1e. The two ledgers are append-only in the schema rather than by habit.
--
--     One policy, it is a SELECT policy, it is scoped, and authenticated holds none of
--     the three write privileges. A row can then only arrive through a private definer
--     function, which is what makes "the query log cannot be edited" a property of the
--     database instead of a promise about the code.
with expected(t) as (values ('bi_query_log'),('bi_events')), found as (
  select e.t,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.t) as policies,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.t
             and p.cmd = 'SELECT'
             and coalesce(p.qual, '') like '%row_in_staff_scope%') as scoped_reads,
         case when to_regclass('public.' || e.t) is null then null else
           has_table_privilege('authenticated', 'public.' || e.t, 'insert')
           or has_table_privilege('authenticated', 'public.' || e.t, 'update')
           or has_table_privilege('authenticated', 'public.' || e.t, 'delete')
         end as writable,
         case when to_regclass('public.' || e.t) is null then null
              else has_table_privilege('authenticated', 'public.' || e.t, 'select') end as readable
    from expected e
)
select 'bi.ledgers_are_append_only' as check_name,
       bool_and(policies = 1 and scoped_reads = 1
                and writable is false and readable is true) as pass,
       coalesce(string_agg(t || ': policies=' || policies || ' scoped_reads=' || scoped_reads
                             || ' writable=' || coalesce(writable::text, 'absent'),
                           ' | ' order by t)
                filter (where not (policies = 1 and scoped_reads = 1
                                   and writable is false and readable is true)), '') as detail
  from found;

-- 1f. The registry is readable by every staff member and writable by none of them.
--
--     bi_sources and bi_source_columns are the compiler's allowlist. They describe the
--     physical schema, which is the same for every tenant, so their one policy asks
--     has_permission and deliberately does *not* ask row_in_staff_scope -- and the check
--     asserts that absence rather than tolerating it, because a scoped registry would
--     make the allowlist invisible to the branch that needs it. What must not exist is
--     any write path: an INSERT into bi_source_columns is an INSERT into the allowlist.
with expected(t) as (values ('bi_sources'),('bi_source_columns')), found as (
  select e.t,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.t) as policies,
         (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = e.t
             and p.policyname = 'staff_select' and p.cmd = 'SELECT'
             and coalesce(p.qual, '') like '%has_permission%'
             and coalesce(p.qual, '') not like '%row_in_staff_scope%') as unscoped_reads,
         case when to_regclass('public.' || e.t) is null then null else
           has_table_privilege('authenticated', 'public.' || e.t, 'insert')
           or has_table_privilege('authenticated', 'public.' || e.t, 'update')
           or has_table_privilege('authenticated', 'public.' || e.t, 'delete')
         end as writable,
         case when to_regclass('public.' || e.t) is null then null
              else has_table_privilege('authenticated', 'public.' || e.t, 'select') end as readable
    from expected e
)
select 'bi.registry_is_read_only_and_unscoped' as check_name,
       bool_and(policies = 1 and unscoped_reads = 1
                and writable is false and readable is true) as pass,
       coalesce(string_agg(t || ': policies=' || policies || ' unscoped_reads=' || unscoped_reads
                             || ' writable=' || coalesce(writable::text, 'absent'),
                           ' | ' order by t)
                filter (where not (policies = 1 and unscoped_reads = 1
                                   and writable is false and readable is true)), '') as detail
  from found;

-- 1g. trg_stamp_staff_scope is on the nine scoped tables and on neither registry table.
--
--     The scoped tables all carry agency_id and branch_id, and every policy on them asks
--     row_in_staff_scope about those two columns. Nothing in the client sets them: the
--     stamp trigger does, from the session. A scoped table missing the stamp is a table
--     whose INSERT policy is evaluated against a null scope, and a registry table that
--     grew one would be quietly re-scoped to whoever ran the migration.
with expected(t, want) as (
  values ('bi_datasets', true),('bi_dimensions', true),('bi_metrics', true),
         ('bi_reports', true),('bi_visualizations', true),('bi_dashboards', true),
         ('bi_dashboard_tiles', true),('bi_query_log', true),('bi_events', true),
         ('bi_sources', false),('bi_source_columns', false)
)
select 'bi.stamp_staff_scope_on_scoped_tables_only' as check_name,
       bool_and(has = want) as pass,
       coalesce(string_agg(t || ': ' || has, ' | ' order by t)
                filter (where has <> want), '') as detail
  from (
    select e.t, e.want,
           exists (select 1 from pg_trigger g
                    where g.tgrelid = to_regclass('public.' || e.t)
                      and g.tgname = 'trg_stamp_staff_scope'
                      and not g.tgisinternal) as has
      from expected e
  ) s;

-- 1h. Exactly seven updated_at triggers, one per definition table, and no others.
--
--     Named rather than counted, and compared in both directions, because the failure
--     this catches is not an absence: 20260822000011 attached set_bi_<table>_updated_at
--     to four of these tables, and leaving one of those beside the house trigger means
--     two functions writing the same column on the same statement. Anything matching
--     %_updated_at on a bi_ table that is not one of the seven is reported as
--     unexpected, which is how a resurrected legacy trigger fails this check by name.
with wanted(t, tg) as (
  select v.t, 'trg_' || v.t || '_updated_at'
    from (values ('bi_datasets'),('bi_dimensions'),('bi_metrics'),('bi_reports'),
                 ('bi_visualizations'),('bi_dashboards'),('bi_dashboard_tiles')) as v(t)
), present(t, tg) as (
  select c.relname, g.tgname
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
   where c.relnamespace = 'public'::regnamespace
     and not g.tgisinternal
     and c.relname like 'bi\_%'
     and g.tgname like '%\_updated\_at'
), diff as (
  select coalesce(w.tg, p.t || ' / ' || p.tg) as what,
         case when w.tg is null then 'unexpected' else 'missing' end as how
    from wanted w
    full join present p on p.t = w.t and p.tg = w.tg
   where w.tg is null or p.tg is null
)
select 'bi.updated_at_triggers_are_exactly_the_seven' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(how || ' ' || what, ' | ' order by what), '') as detail
  from diff;

-- 1i. The 20260822000011 audit triggers and isolation policies are gone.
--
--     log_bi_audit wrote an audit_logs row with a different column set than
--     write_audit_log, so leaving it attached means two ledgers disagreeing about one
--     event; and the four `for all using (agency_id = current_staff_agency_id())`
--     policies would sit *beside* the new four rather than instead of them, and
--     PostgreSQL ORs permissive policies together -- so one survivor re-opens every
--     branch to every reader while the four scoped policies still look correct.
select 'bi.legacy_triggers_and_isolation_policies_absent' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(what, ' | ' order by what), '') as detail
  from (
    select 'trigger ' || c.relname || '.' || g.tgname as what
      from pg_trigger g
      join pg_class c on c.oid = g.tgrelid
     where c.relnamespace = 'public'::regnamespace
       and not g.tgisinternal
       and g.tgname in ('audit_bi_datasets','audit_bi_metrics','audit_bi_reports',
                        'audit_bi_visualizations')
    union all
    select 'policy ' || p.tablename || '.' || p.policyname
      from pg_policies p
     where p.schemaname = 'public'
       and p.policyname in ('bi_datasets_isolation','bi_metrics_isolation',
                            'bi_reports_isolation','bi_visualizations_isolation')
  ) s;

-- 1j. The twenty private bodies are all present, and no client role may execute one.
--
--     Checking anon covers a grant to PUBLIC as well, since anon inherits it -- and PUBLIC
--     is exactly what a newly created function is granted to, so this check fails on a
--     migration that creates a body and forgets to revoke it. `grant usage on schema
--     private to authenticated` has been true since 20260520002500, so the schema is not
--     the boundary here; the function ACL is. The names are asserted alongside the count
--     because twenty bodies of which one is the wrong twenty still counts to twenty.
with expected(f) as (
  values ('bi_sync_source_columns'),('bi_register_source'),('bi_assert_safe_expression'),
         ('bi_expression_columns'),('bi_validate_dimension'),('bi_fold_expression'),
         ('bi_assert_aggregate_types'),('bi_validate_metric'),('bi_validate_dataset'),
         ('bi_literal'),('bi_compile_filters'),('bi_compile_query'),('bi_log_event'),
         ('bi_run_query'),('bi_drill_through'),('bi_validate_visualization'),
         ('bi_freeze_published_metric'),('bi_set_status'),('bi_run_visualization'),
         ('bi_sync_sources')
), priv as (
  select p.proname,
         has_function_privilege('anon', p.oid, 'execute')          as anon_ok,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname like 'bi\_%'
)
select 'bi.private_bodies_are_unreachable' as check_name,
       (select count(*) from priv) = 20
       and not exists (select 1 from expected e
                        where not exists (select 1 from priv p where p.proname = e.f))
       and not exists (select 1 from priv where anon_ok or auth_ok) as pass,
       'count=' || (select count(*) from priv)
       || ' missing=' || coalesce((select string_agg(e.f, ' ' order by e.f) from expected e
                                   where not exists (select 1 from priv p
                                                      where p.proname = e.f)), 'none')
       || ' reachable=' || coalesce((select string_agg(proname, ' ' order by proname)
                                     from priv where anon_ok or auth_ok), 'none') as detail;

-- 1k. The public surface is exactly fifteen functions, authenticated reaches all of
--     them, and anon reaches none.
--
--     Compared by signature rather than by name, and in both directions. A name-only
--     check passes when an argument is added, which is how a second overload appears
--     beside the wrapper and inherits the default EXECUTE to PUBLIC; and the
--     `unexpected` direction is what fails this check if the two orphaned 20260822000011
--     bodies (set_bi_updated_at, log_bi_audit) are ever back in public.
--
--     The signature is rebuilt from proargtypes with format_type rather than read from
--     pg_get_function_identity_arguments, whose rendering of argument names has varied
--     between server versions -- a check that fails on PostgreSQL 15 and passes on 16
--     is not a check.
with wanted(sig) as (
  values ('set_bi_status_command(text, uuid, text, text)'),
         ('run_bi_query_command(uuid, text[], text[], jsonb, text, text, boolean, integer, uuid)'),
         ('run_bi_visualization_command(uuid)'),
         ('run_bi_drill_through_command(uuid, text, jsonb, jsonb, integer)'),
         ('sync_bi_sources_command()'),
         ('get_bi_catalog()'),
         ('get_bi_dataset_detail(uuid)'),
         ('get_bi_drill_path(uuid, text)'),
         ('get_bi_lineage(text, uuid)'),
         ('get_bi_dashboards()'),
         ('get_bi_dashboard(uuid)'),
         ('get_bi_reports()'),
         ('get_bi_studio_overview()'),
         ('get_bi_query_log(integer, text)'),
         ('get_bi_events(text, uuid, integer)')
), present as (
  select p.proname || '(' ||
         coalesce((select string_agg(format_type(a.oid, null), ', ' order by a.ord)
                     from unnest(p.proargtypes) with ordinality as a(oid, ord)), '') || ')' as sig,
         has_function_privilege('anon', p.oid, 'execute')          as anon_ok,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%bi\_%'
), diff as (
  select coalesce(w.sig, p.sig) as sig,
         case when w.sig is null    then 'unexpected'
              when p.sig is null    then 'missing'
              when not p.auth_ok    then 'not executable by authenticated'
              else                       'reachable by anon' end as how
    from wanted w
    full join present p on p.sig = w.sig
   where w.sig is null or p.sig is null or not p.auth_ok or p.anon_ok
)
select 'bi.public_surface_is_exactly_the_fifteen' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(how || ' ' || sig, ' | ' order by sig), '') as detail
  from diff;

-- 1l. All thirty-five bodies are SECURITY DEFINER with a pinned search_path.
--
--     Definer is what lets a wrapper enforce a rule the caller could otherwise bypass,
--     and it is also what makes an unpinned search_path a privilege escalation: a
--     schema earlier in the path than public, owned by the caller, redefines any
--     unqualified name the body uses. The predicate asks for `search_path=` and not for
--     a particular value, because five of the pure-expression helpers pin
--     `pg_catalog, public` in that order while the other thirty pin `public, pg_catalog`
--     -- both are pinned, and a check that demanded one ordering would fail on a correct
--     database.
with bodies as (
  select n.nspname, p.proname, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ' '), '') as cfg
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'private' and p.proname like 'bi\_%')
      or (n.nspname = 'public'  and p.proname like '%bi\_%')
)
select 'bi.bodies_are_definer_with_pinned_search_path' as check_name,
       count(*) = 35 and bool_and(prosecdef and cfg like '%search\_path=%') as pass,
       'count=' || count(*) || ' bad='
       || coalesce(string_agg(nspname || '.' || proname, ' ' order by nspname, proname)
                   filter (where not (prosecdef and cfg like '%search\_path=%')), 'none') as detail
  from bodies;

-- 1m. The thirty-five named constraints are present, each with the kind it was declared
--     as: eight UNIQUE, one FOREIGN KEY, twenty-six CHECK.
--
--     The kind is asserted and not just the name, because the way a uniqueness rule
--     disappears is not a DROP -- it is a later migration that recreates
--     bi_datasets_key_unique as a plain index, or as a CHECK, and then every catalog
--     listing still shows the name. A UNIQUE constraint is the only one of those three
--     that PostgreSQL backs with a unique index, so asking for contype 'u' is what makes
--     "one key per agency" a fact rather than a naming convention.
with expected(c, kind) as (
  values ('bi_sources_relation_unique','u'),('bi_source_columns_unique','u'),
         ('bi_datasets_key_unique','u'),('bi_dimensions_key_unique','u'),
         ('bi_reports_key_unique','u'),('bi_visualizations_key_unique','u'),
         ('bi_dashboards_key_unique','u'),('bi_dashboard_tiles_once','u'),
         ('bi_query_log_visualization_fk','f'),
         ('bi_sources_key_shape','c'),('bi_datasets_status_check','c'),
         ('bi_datasets_key_shape','c'),('bi_datasets_published_needs_source','c'),
         ('bi_datasets_published_stamp','c'),('bi_dimensions_key_shape','c'),
         ('bi_dimensions_drill_pair','c'),('bi_dimensions_no_self_drill','c'),
         ('bi_metrics_status_check','c'),('bi_metrics_aggregate_check','c'),
         ('bi_metrics_format_check','c'),('bi_metrics_decimals_check','c'),
         ('bi_metrics_key_shape','c'),('bi_metrics_ratio_shape','c'),
         ('bi_metrics_published_stamp','c'),('bi_reports_key_shape','c'),
         ('bi_reports_status_check','c'),('bi_reports_published_stamp','c'),
         ('bi_visualizations_key_shape','c'),('bi_visualizations_chart_type_check','c'),
         ('bi_visualizations_grain_check','c'),('bi_visualizations_row_limit_check','c'),
         ('bi_visualizations_shape_check','c'),('bi_dashboards_key_shape','c'),
         ('bi_dashboards_published_stamp','c'),('bi_dashboard_tiles_fits','c')
), found as (
  select con.conname, con.contype::text as kind
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
   where cl.relnamespace = 'public'::regnamespace and cl.relname like 'bi\_%'
)
select 'bi.named_constraints_present_with_the_right_kind' as check_name,
       count(*) filter (where f.kind is null or f.kind <> e.kind) = 0 as pass,
       coalesce(string_agg(e.c || ': ' || coalesce(f.kind, 'absent'), ' | ' order by e.c)
                filter (where f.kind is null or f.kind <> e.kind), '') as detail
  from expected e
  left join found f on f.conname = e.c;

-- 1n. The twenty-three named indexes are present.
--
--     They are asserted here rather than treated as tuning because most of them are the
--     `(agency_id, branch_id)` scope indexes, and a row-security predicate that cannot
--     use an index is a sequential scan on every read -- which is how a correct policy
--     becomes the thing somebody disables under load. The rest back a foreign key that
--     the delete path relies on: bi_dashboard_tiles -> bi_visualizations is `on delete
--     restrict`, and that restriction is checked by scanning the referencing side.
with expected(i) as (
  values ('idx_bi_source_columns_source'),
         ('idx_bi_datasets_scope'),('idx_bi_datasets_source'),('idx_bi_datasets_status'),
         ('idx_bi_dimensions_dataset'),('idx_bi_dimensions_scope'),
         ('idx_bi_metrics_dataset'),('idx_bi_metrics_scope'),('idx_bi_metrics_status'),
         ('idx_bi_query_log_scope'),('idx_bi_query_log_dataset'),('idx_bi_query_log_actor'),
         ('idx_bi_events_entity'),('idx_bi_events_scope'),
         ('idx_bi_reports_scope'),('idx_bi_reports_status'),
         ('idx_bi_visualizations_scope'),('idx_bi_visualizations_dataset'),
         ('idx_bi_visualizations_report'),
         ('idx_bi_dashboards_scope'),('idx_bi_dashboards_status'),
         ('idx_bi_tiles_dashboard'),('idx_bi_tiles_visualization')
)
select 'bi.named_indexes_present' as check_name,
       count(*) filter (where x.indexname is null) = 0 as pass,
       coalesce(string_agg(e.i, ' | ' order by e.i)
                filter (where x.indexname is null), '') as detail
  from expected e
  left join pg_indexes x on x.schemaname = 'public' and x.indexname = e.i;

-- 1o. The RBAC seed is exactly this matrix -- no more, no less.
--
--     Compared as a sorted action list per (role, resource) and joined both ways, which
--     is the only formulation that catches the failure that matters. A positive check
--     ("OPERATIONS_MANAGER can read bi_datasets") still passes after somebody adds
--     `('AGENT','bi_metrics','update')`, and the whole point of this matrix is the
--     actions that are *not* in it. The full join also reports a role that appears here
--     without being expected at all -- an ADMIN row, say, which would look harmless and
--     would mean the lifecycle's separation of duties is being expressed twice, in two
--     places that can disagree.
--
--     Everything is cast to text because staff_permissions.role may be an enum, and
--     enum = text has no operator: the check would fail to run rather than fail to pass.
with expected(role, resource, actions) as (
  values
  ('OPERATIONS_MANAGER','bi_datasets','create,read,update'),
  ('OPERATIONS_MANAGER','bi_dimensions','create,delete,read,update'),
  ('OPERATIONS_MANAGER','bi_metrics','create,read,update'),
  ('OPERATIONS_MANAGER','bi_reports','create,delete,publish,read,update'),
  ('OPERATIONS_MANAGER','bi_visualizations','create,delete,read,update'),
  ('OPERATIONS_MANAGER','bi_dashboards','create,delete,publish,read,update'),
  ('OPERATIONS_MANAGER','bi_dashboard_tiles','create,delete,read,update'),
  ('OPERATIONS_MANAGER','bi_query_log','read'),('OPERATIONS_MANAGER','bi_events','read'),
  -- FINANCE holds the identical set, deliberately: the two roles that build the
  -- semantic layer are the two that answer for it.
  ('FINANCE','bi_datasets','create,read,update'),
  ('FINANCE','bi_dimensions','create,delete,read,update'),
  ('FINANCE','bi_metrics','create,read,update'),
  ('FINANCE','bi_reports','create,delete,publish,read,update'),
  ('FINANCE','bi_visualizations','create,delete,read,update'),
  ('FINANCE','bi_dashboards','create,delete,publish,read,update'),
  ('FINANCE','bi_dashboard_tiles','create,delete,read,update'),
  ('FINANCE','bi_query_log','read'),('FINANCE','bi_events','read'),
  -- CRM may compose what exists and may not define it, and may not read the log.
  ('CRM','bi_datasets','read'),('CRM','bi_dimensions','read'),('CRM','bi_metrics','read'),
  ('CRM','bi_reports','create,read,update'),
  ('CRM','bi_visualizations','create,delete,read,update'),
  ('CRM','bi_dashboards','create,read,update'),
  ('CRM','bi_dashboard_tiles','create,delete,read,update'),('CRM','bi_events','read'),
  -- AGENT and VISA_AGENT read the seven and write nothing.
  ('AGENT','bi_datasets','read'),('AGENT','bi_dimensions','read'),('AGENT','bi_metrics','read'),
  ('AGENT','bi_reports','read'),('AGENT','bi_visualizations','read'),
  ('AGENT','bi_dashboards','read'),('AGENT','bi_dashboard_tiles','read'),
  ('VISA_AGENT','bi_datasets','read'),('VISA_AGENT','bi_dimensions','read'),
  ('VISA_AGENT','bi_metrics','read'),('VISA_AGENT','bi_reports','read'),
  ('VISA_AGENT','bi_visualizations','read'),('VISA_AGENT','bi_dashboards','read'),
  ('VISA_AGENT','bi_dashboard_tiles','read'),
  -- GUIDE the same minus bi_reports: a guide is shown a dashboard, not a report.
  ('GUIDE','bi_datasets','read'),('GUIDE','bi_dimensions','read'),('GUIDE','bi_metrics','read'),
  ('GUIDE','bi_visualizations','read'),('GUIDE','bi_dashboards','read'),
  ('GUIDE','bi_dashboard_tiles','read')
), found as (
  select role::text as role, resource::text as resource,
         string_agg(action::text, ',' order by action::text) as actions
    from public.staff_permissions
   where resource::text like 'bi\_%'
   group by role::text, resource::text
), diff as (
  select coalesce(e.role, f.role) || '.' || coalesce(e.resource, f.resource) as what,
         'has ' || coalesce(f.actions, 'nothing')
              || ', wants ' || coalesce(e.actions, 'nothing') as how
    from expected e
    full join found f on f.role = e.role and f.resource = e.resource
   where coalesce(f.actions, '') <> coalesce(e.actions, '')
)
select 'bi.rbac_matrix_is_exact' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(what || ' ' || how, ' | ' order by what), '') as detail
  from diff;

-- 1p. The four deliberate holes, stated on their own rather than left implicit in 1o.
--
--     Publishing a dataset or a metric is what turns a definition into the agency's
--     official number, and deleting one unmakes every report built on it. No staff role
--     holds either action on either resource: an ADMIN reaches them through
--     has_permission's role bypass, not through a row here, which is what makes
--     "the analyst defines and somebody else certifies" a mechanism instead of a policy
--     document. 2d proves the same boundary from the other side, with two sessions.
select 'bi.dataset_and_metric_lifecycle_is_held_by_no_role' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(role::text || '.' || resource::text || '.' || action::text, ' | '
                           order by role::text, resource::text, action::text), '') as detail
  from public.staff_permissions
 where resource::text in ('bi_datasets','bi_metrics')
   and action::text in ('publish','delete');

-- 1q. Every registered source is coherent with the database it claims to describe.
--
--     Not "there are eleven sources": private.bi_register_source deliberately *skips* a
--     relation that does not exist here or that carries no agency_id, raising a notice
--     and returning null, so a count would fail on a correct database that simply has
--     not installed the CRM tables. What must hold of every row that did get written is
--     asserted instead -- and the load-bearing one is required_permission = key, because
--     that is the equality the compiler leans on when it refuses a dataset whose reader
--     cannot read the underlying table. A source registered with a permission naming
--     some other resource would widen access exactly as far as the difference.
--
--     cols > 0 matters in the opposite direction: bi_source_columns is the token
--     allowlist, so a source whose columns were never measured does not admit unsafe
--     expressions, it refuses every expression -- a dataset nobody can query.
with s as (
  select v.id, v.key, v.is_active, v.required_permission, v.tenant_column,
         v.relation_schema, v.relation_name, v.default_time_column,
         to_regclass(format('%I.%I', v.relation_schema, v.relation_name)) is not null as rel_exists,
         (select count(*) from public.bi_source_columns c where c.source_id = v.id) as cols,
         (v.default_time_column is null
          or exists (select 1 from information_schema.columns c
                      where c.table_schema = v.relation_schema
                        and c.table_name   = v.relation_name
                        and c.column_name  = v.default_time_column)) as time_col_real
    from public.bi_sources v
), judged as (
  select key,
         (is_active and required_permission = key and tenant_column = 'agency_id'
          and relation_schema = 'public' and rel_exists and cols > 0 and time_col_real) as ok,
         key || ': active=' || is_active || ' perm=' || required_permission
             || ' tenant=' || tenant_column || ' relation_exists=' || rel_exists
             || ' columns=' || cols || ' time_column_real=' || time_col_real as detail
    from s
)
select 'bi.registered_sources_are_coherent' as check_name,
       count(*) > 0 and bool_and(ok) as pass,
       coalesce(string_agg(detail, ' | ' order by key) filter (where not ok), '') as detail
  from judged;

-- 1r. Each of the eleven seeded relations is registered when, and only when, it can be.
--
--     The seed is eleven `perform private.bi_register_source(...)` calls, and `perform`
--     throws away the null the function returns when it skips: a relation that does not
--     exist, or that exists without agency_id, is announced with `raise notice` and the
--     migration succeeds. Which means the one failure this check exists for -- the seed
--     silently registering nothing at all -- looks identical to a clean install unless
--     somebody asks afterwards.
--
--     So eligibility is recomputed here from the same two facts the function tests, and
--     presence is required exactly where those hold. A relation that is missing on this
--     database is not a failure; a relation that is present, scoped by agency_id, and
--     still unregistered is. The eleven keys are also the eleven relation names, which
--     is why the key alone is enough to look the relation up.
with seeded(k) as (
  values ('bookings'),('pilgrims'),('packages'),('invoices'),('payments'),
         ('journal_entries'),('crm_leads'),('crm_opportunities'),('crm_quotes'),
         ('crm_customers'),('dms_documents')
), eligibility as (
  select s.k,
         to_regclass('public.' || quote_ident(s.k)) is not null as relation_here,
         exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = s.k
                    and c.column_name = 'agency_id') as scoped_here,
         exists (select 1 from public.bi_sources v
                  where v.key = s.k and v.is_active) as registered
    from seeded s
)
select 'bi.seeded_sources_registered_where_eligible' as check_name,
       count(*) filter (where relation_here and scoped_here and not registered) = 0 as pass,
       coalesce(string_agg(k || ' exists and is agency-scoped but is not registered', ' | '
                           order by k)
                filter (where relation_here and scoped_here and not registered), '')
       || ' skipped_here=' || coalesce((select string_agg(k, ' ' order by k) from eligibility
                                        where not (relation_here and scoped_here)), 'none') as detail
  from eligibility;

-- 1s. The five gatekeeping triggers, found by the function they call rather than by name.
--
--     Scoping this scan to `tgname like 'trg\_bi\_%'` would be wrong twice over: it would
--     drag in the seven trg_bi_*_updated_at stamps that 1h already owns, and it would
--     miss the failure that matters most -- a validator body that exists, typechecks and
--     is attached to nothing. Every rule these five enforce (a dataset's expressions
--     resolve against its source, a dimension's drill target is real, a metric's
--     aggregate matches its column types, a visualization's shelves match its chart
--     type, a published metric cannot be edited in place) is enforced *only* here. A
--     detached validator is not a weaker rule, it is no rule, and the table's own CHECK
--     constraints will not notice.
--
--     So the timing is asserted too, decomposed from tgtype into words a failure message
--     can print: BEFORE is what lets these raise instead of rolling back, and ROW is
--     what makes them see NEW at all. And tgenabled is asserted because ALTER TABLE ...
--     DISABLE TRIGGER leaves the pg_trigger row perfectly in place -- 'R' counts as
--     disabled here, since replica-only means it never fires on this database.
with expected(trg, tbl, fn, spec) as (
  values ('trg_bi_validate_dataset','bi_datasets','bi_validate_dataset','BEFORE INSERT,UPDATE ROW'),
         ('trg_bi_validate_dimension','bi_dimensions','bi_validate_dimension','BEFORE INSERT,UPDATE ROW'),
         ('trg_bi_validate_metric','bi_metrics','bi_validate_metric','BEFORE INSERT,UPDATE ROW'),
         ('trg_bi_validate_visualization','bi_visualizations','bi_validate_visualization','BEFORE INSERT,UPDATE ROW'),
         ('trg_bi_freeze_published_metric','bi_metrics','bi_freeze_published_metric','BEFORE UPDATE ROW')
), found as (
  select t.tgname as trg, cl.relname as tbl, p.proname as fn,
         (case when (t.tgtype & 64) = 64 then 'INSTEAD OF '
               when (t.tgtype &  2) =  2 then 'BEFORE ' else 'AFTER ' end)
         || concat_ws(',', case when (t.tgtype &  4) =  4 then 'INSERT' end,
                           case when (t.tgtype &  8) =  8 then 'DELETE' end,
                           case when (t.tgtype & 16) = 16 then 'UPDATE' end)
         || (case when (t.tgtype & 1) = 1 then ' ROW' else ' STATEMENT' end) as spec,
         t.tgenabled in ('O','A') as enabled
    from pg_trigger t
    join pg_class cl on cl.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where not t.tgisinternal and n.nspname = 'private'
     and p.proname in ('bi_validate_dataset','bi_validate_dimension','bi_validate_metric',
                       'bi_validate_visualization','bi_freeze_published_metric')
), diff as (
  select coalesce(e.trg, f.trg || ' on ' || f.tbl) as what,
         case when e.trg is null    then 'unexpected, calls private.' || f.fn
              when f.trg is null    then 'missing -- private.' || e.fn || ' is attached to nothing'
              when f.tbl <> e.tbl   then 'on ' || f.tbl || ', wants ' || e.tbl
              when f.spec <> e.spec then 'fires ' || f.spec || ', wants ' || e.spec
              else                       'disabled' end as how
    from expected e
    full join found f on f.trg = e.trg and f.fn = e.fn
   where e.trg is null or f.trg is null
      or f.tbl <> e.tbl or f.spec <> e.spec or not f.enabled
)
select 'bi.validation_triggers_are_attached_and_enabled' as check_name,
       count(*) = 0 as pass,
       coalesce(string_agg(what || ': ' || how, ' | ' order by what), '') as detail
  from diff;

-- 1t. The chart_type domain is exactly the thirty-three types the engine can draw.
--
--     Both directions are failures, and the second is the interesting one. A type in the
--     engine's switch but rejected by the constraint is a visualization nobody can save;
--     a type the constraint accepts that the engine has no branch for is a saved
--     visualization that renders as nothing -- and it renders as nothing *for a reader*,
--     on a published dashboard, long after the migration that widened the list. Seven of
--     these thirty-three are drawn as a named PENDING placeholder rather than a picture,
--     which is a promise the reader can see; a thirty-fourth value would be a blank tile,
--     which is not.
--
--     The literals are read back out of pg_get_constraintdef rather than compared as a
--     whole string, because PostgreSQL rewrites `in (...)` into `= ANY (ARRAY[...::text])`
--     and reformats the whitespace, so a textual comparison would fail on a database
--     where nothing is wrong.
with def as (
  select pg_get_constraintdef(con.oid) as d
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
   where cl.relnamespace = 'public'::regnamespace
     and cl.relname = 'bi_visualizations'
     and con.conname = 'bi_visualizations_chart_type_check'
), present as (
  select distinct m[1] as v
    from def, lateral regexp_matches(def.d, '''([A-Z][A-Z_]*)''', 'g') as m
), expected(v) as (
  values ('TABLE'),('PIVOT'),('KPI'),('LINE'),('AREA'),('BAR'),('COLUMN'),
         ('STACKED_BAR'),('STACKED_COLUMN'),('PIE'),('DONUT'),('SCATTER'),('BUBBLE'),
         ('WATERFALL'),('BRIDGE'),('BULLET'),('HISTOGRAM'),('BOX_PLOT'),('HEATMAP'),
         ('TREEMAP'),('DECOMPOSITION_TREE'),('SANKEY'),('FUNNEL'),('GANTT'),
         ('CORRELATION_MATRIX'),('PARETO'),('FORECAST_BAND'),('SENSITIVITY_MATRIX'),
         ('DEPENDENCY_GRAPH'),('DRIVER_TREE'),('RADAR'),('GAUGE'),('COMBO')
), diff as (
  select coalesce(e.v, p.v) as v,
         case when e.v is null then 'accepted by the database, absent from the engine'
              else                   'drawn by the engine, rejected by the database' end as how
    from expected e
    full join present p on p.v = e.v
   where e.v is null or p.v is null
)
select 'bi.chart_type_check_is_exactly_the_thirty_three' as check_name,
       (select count(*) from def) = 1 and not exists (select 1 from diff) as pass,
       case when (select count(*) from def) <> 1
              then 'bi_visualizations_chart_type_check is absent'
            else coalesce((select string_agg(v || ': ' || how, ' | ' order by v) from diff), '')
       end as detail;
-- ===========================================================================
-- Part 2. The lifecycle, driven for real and then discarded.
--
-- Everything above reads catalogs. Nothing above proves that a definition can be
-- written, refused, published, queried, drilled and frozen -- and those are the
-- only claims that matter to somebody deciding whether the BI studio is built.
--
-- Three disposable accounts, because separation of duties cannot be demonstrated
-- by one: an OPERATIONS_MANAGER who may define but not publish a definition, an
-- ADMIN who may publish, and an AGENT who may read the catalog and nothing else.
-- All three live inside `begin ... rollback`, so the database this suite runs
-- against is byte-identical afterwards, which Part 3 then checks rather than
-- assumes.
--
-- Two things this part deliberately does not assert. Row visibility: the harness
-- runs as the owner, so RLS is bypassed and every `select` here would pass no
-- matter what the policies said -- Part 1c/1d read the policies themselves for
-- exactly that reason. And realtime publication membership, which is asserted
-- nowhere in this file.
-- ===========================================================================
begin;

-- The three helpers. `bi_refuses` is for what raises: direct DML against a
-- constraint, a validation trigger, set_bi_status_command. `bi_payload_fails` is
-- for what does not -- run_bi_query_command and run_bi_drill_through_command
-- catch their own errors so the refusal survives as a bi_query_log row, and a
-- caught refusal has to be read off the returned payload instead.
create or replace function pg_temp.bi_refuses(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
declare v_caught text;
begin
  begin execute p_sql; exception when others then v_caught := sqlstate; end;
  if v_caught is distinct from p_state then
    raise exception '% : expected SQLSTATE %, got %', p_what, p_state,
      coalesce(v_caught, 'no error at all');
  end if;
end $fn$;

create or replace function pg_temp.bi_payload_fails(p_payload jsonb, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  if coalesce(p_payload->>'ok', 'missing') <> 'false' then
    raise exception '% : the command answered ok=% instead of refusing',
      p_what, coalesce(p_payload->>'ok', 'nothing');
  end if;
  if p_payload->>'error_code' is distinct from p_state then
    raise exception '% : expected error_code %, got % (%)', p_what, p_state,
      coalesce(p_payload->>'error_code', 'none'),
      coalesce(p_payload->>'error_message', 'no message');
  end if;
end $fn$;

create or replace function pg_temp.bi_become(p_email text)
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
-- 2a. What the definition layer refuses, probed by direct DML before any
--     session exists.
--
--     Direct DML is the point. These are constraints and BEFORE triggers, so the
--     claim being tested is that they hold against a writer who never goes
--     through a command -- the PostgREST PATCH that section H of the migration
--     names as the reason validation lives in a trigger at all. With no JWT,
--     stamp_staff_scope() stamps DEFAULT/HQ, so every probe row lands in the same
--     scope the accounts in 2b will hold.
--
--     Three refusals below arrive as 22023 where a reader might expect 23514,
--     because check constraints are evaluated after BEFORE-row triggers and the
--     trigger gets there first. Each one says so where it happens. Part 1m has
--     already proved those constraints are declared, so both lines of defence are
--     covered: 1m that the constraint exists, here that a writer meets one.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_src uuid;
begin
  select id into v_src from public.bi_sources where key = 'bookings';
  if v_src is null then
    raise exception '2a: the bookings source is not registered; section C never ran';
  end if;

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id)
    values ('BI suite probe', 'BI_Probe', %L)$q$, v_src),
    '23514', '2a: an uppercase dataset key fails bi_datasets_key_shape');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id, status)
    values ('BI suite probe', 'bi_suite_badstatus', %L, 'ARCHIVED')$q$, v_src),
    '23514', '2a: a status outside the three fails bi_datasets_status_check');

  perform pg_temp.bi_refuses($q$
    insert into public.bi_datasets(name, key, status, published_at)
    values ('BI suite probe', 'bi_suite_nosource', 'PUBLISHED', now())$q$,
    '23514', '2a: PUBLISHED with no source fails bi_datasets_published_needs_source');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id, status)
    values ('BI suite probe', 'bi_suite_nostamp', %L, 'PUBLISHED')$q$, v_src),
    '23514', '2a: PUBLISHED with no published_at fails bi_datasets_published_stamp');
end $step$;
-- The dataset validator: a row filter or a time column means nothing without a
-- source, and with one they are measured against the registry rather than trusted.
do $step$
declare
  v_src uuid;
begin
  select id into v_src from public.bi_sources where key = 'bookings';

  perform pg_temp.bi_refuses($q$
    insert into public.bi_datasets(name, key, row_filter_json)
    values ('BI suite probe', 'bi_suite_filternosrc',
            '[{"field":"reference","op":"STARTS_WITH","value":"X"}]'::jsonb)$q$,
    '22023', '2a: a row filter with no source is refused');

  perform pg_temp.bi_refuses($q$
    insert into public.bi_datasets(name, key, default_time_column)
    values ('BI suite probe', 'bi_suite_timenosrc', 'created_at')$q$,
    '22023', '2a: a default time column with no source is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id, default_time_column)
    values ('BI suite probe', 'bi_suite_texttime', %L, 'reference')$q$, v_src),
    '22023', '2a: a text column cannot be the default time column');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id, default_time_column)
    values ('BI suite probe', 'bi_suite_ghosttime', %L, 'not_a_column')$q$, v_src),
    '22023', '2a: a time column absent from the registry is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id, row_filter_json)
    values ('BI suite probe', 'bi_suite_ghostfield', %L,
            '[{"field":"not_a_column","op":"EQ","value":1}]'::jsonb)$q$, v_src),
    '22023', '2a: a row filter naming no registered column is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id, row_filter_json)
    values ('BI suite probe', 'bi_suite_badop', %L,
            '[{"field":"reference","op":"REGEX","value":"^X"}]'::jsonb)$q$, v_src),
    '22023', '2a: an operator this compiler does not emit is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_datasets(name, key, source_id, row_filter_json)
    values ('BI suite probe', 'bi_suite_nofield', %L,
            '[{"op":"EQ","value":1}]'::jsonb)$q$, v_src),
    '22023', '2a: a filter entry with no field is refused');
end $step$;
-- Two probe datasets: one bound to `bookings`, one deliberately unbound so the
-- "bind it first" refusals have something to be refused against.
insert into public.bi_datasets(name, key, source_id, default_time_column)
select 'BI suite probe', 'bi_suite_probe', s.id, 'created_at'
  from public.bi_sources s where s.key = 'bookings';

insert into public.bi_datasets(name, key)
values ('BI suite unbound', 'bi_suite_unbound');

-- The expression check. This is the file's security boundary: everything a
-- dimension or a metric stores is EXECUTEd later inside a definer function, so
-- each rule below is the difference between a semantic layer and an injection
-- point. The refusals are checked in the order bi_assert_safe_expression applies
-- them, because a later rule cannot be trusted to catch what an earlier one lets
-- through -- a 501-character expression must be refused for its length even
-- though it also happens to name no real column.
do $step$
declare
  v_ds text := (select id::text from public.bi_datasets where key = 'bi_suite_probe');
  v_n  integer := 0;
  r    record;
begin
  for r in
    select * from (values
      ('',                            'a blank expression'),
      (repeat('reference', 60),       'an expression past the 500-character limit'),
      ('total_dzd; drop table x',     'a semicolon'),
      ('"total_dzd"',                 'a double-quoted identifier'),
      ('$1',                          'a parameter placeholder'),
      ('total_dzd -- comment',        'a line comment'),
      ('total_dzd /* comment */',     'a block comment'),
      ('public.bookings',             'a schema-qualified name'),
      ('reference || ''unterminated', 'an unterminated text literal'),
      ('total_dzd)',                  'a parenthesis that was never opened'),
      ('round((total_dzd',            'a parenthesis left open'),
      ('passport_number',             'a column the source does not have'),
      ('(select 1)',                  'the select keyword'),
      ('total_dzd from bookings',     'a relation reached through the allowed word from'),
      ('total_dzd + reference',       'an expression that does not type-check')
    ) as t(expr, what)
  loop
    perform pg_temp.bi_refuses(format($q$
      insert into public.bi_dimensions(dataset_id, key, display_name, expression)
      values (%L, %L, 'Probe', %L)$q$, v_ds, 'bi_probe_x' || v_n, r.expr),
      '22023', format('2a: dimension expression rejects %s', r.what));
    v_n := v_n + 1;
  end loop;
end $step$;
-- The positive control the fifteen refusals above need in order to mean anything:
-- an expression with a decimal point, arithmetic and a function call is accepted,
-- so the allowlist is discriminating rather than merely hostile. `0.5` survives
-- the qualified-name rule because its dot touches digits on both sides.
insert into public.bi_dimensions(dataset_id, key, display_name, expression, data_type)
select d.id, 'bi_probe_half', 'Half the amount', 'round(total_dzd * 0.5)', 'number'
  from public.bi_datasets d where d.key = 'bi_suite_probe';

do $step$
declare
  v_ds      text := (select id::text from public.bi_datasets where key = 'bi_suite_probe');
  v_unbound text := (select id::text from public.bi_datasets where key = 'bi_suite_unbound');
  v_lineage jsonb;
begin
  -- Lineage is measured from the same token scan the validator uses, so it is a
  -- fact about the expression rather than a JSONB column somebody remembered to fill.
  select lineage->'source_columns' into v_lineage
    from public.bi_dimensions where key = 'bi_probe_half';
  if v_lineage is distinct from '["total_dzd"]'::jsonb then
    raise exception '2a: dimension lineage measured % instead of ["total_dzd"]', v_lineage;
  end if;

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression)
    values (%L, 'Bad Key', 'Probe', 'reference')$q$, v_ds),
    '23514', '2a: an uppercase dimension key fails bi_dimensions_key_shape');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression, data_type)
    values (%L, 'bi_probe_money', 'Probe', 'total_dzd', 'money')$q$, v_ds),
    '23514', '2a: a data type outside the six is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression,
                                     drill_through_kind, drill_through_expression)
    values (%L, 'bi_probe_kind', 'Probe', 'reference', 'HOTEL', 'id')$q$, v_ds),
    '23514', '2a: a drill-through kind outside the eleven is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression,
                                     drill_through_kind)
    values (%L, 'bi_probe_halfpair', 'Probe', 'reference', 'BOOKING')$q$, v_ds),
    '23514', '2a: a drill-through kind with no key fails bi_dimensions_drill_pair');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression,
                                     drill_through_expression)
    values (%L, 'bi_probe_otherhalf', 'Probe', 'reference', 'id')$q$, v_ds),
    '23514', '2a: a drill-through key with no kind fails bi_dimensions_drill_pair');
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression)
    values (%L, 'bi_probe_half', 'Probe', 'reference')$q$, v_ds),
    '23505', '2a: two dimensions cannot share a key on one dataset');

  -- 22023, not 23514: the cycle walk in bi_validate_dimension runs as a BEFORE
  -- trigger and check constraints are evaluated afterwards, so a self-drill meets
  -- the walk first. Part 1m has already proved bi_dimensions_no_self_drill is
  -- declared; this proves the writer is stopped.
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression, drill_to_key)
    values (%L, 'bi_probe_loop', 'Probe', 'reference', 'bi_probe_loop')$q$, v_ds),
    '22023', '2a: a dimension that drills to itself is refused by the cycle walk');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression)
    values (%L, 'bi_probe_unbound', 'Probe', 'reference')$q$, v_unbound),
    '22023', '2a: a dimension on a dataset with no source is refused');

  -- Also 22023 rather than the 23503 the foreign key would give, and for the same
  -- reason: the trigger looks the dataset up before the constraint is consulted.
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_dimensions(dataset_id, key, display_name, expression)
    values (%L, 'bi_probe_ghostds', 'Probe', 'reference')$q$, gen_random_uuid()),
    '22023', '2a: a dimension on a dataset that does not exist is refused');
end $step$;
-- Metrics. The vocabularies first, as plain constraints.
do $step$
declare
  v_ds text := (select id::text from public.bi_datasets where key = 'bi_suite_probe');
begin
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, status)
    values (%L, 'bi_probe_m1', 'Probe', 'total_dzd', 'ARCHIVED')$q$, v_ds),
    '23514', '2a: a metric status outside the three is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, format)
    values (%L, 'bi_probe_m2', 'Probe', 'total_dzd', 'MONEY')$q$, v_ds),
    '23514', '2a: a display format outside the five is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, decimals)
    values (%L, 'bi_probe_m3', 'Probe', 'total_dzd', 7)$q$, v_ds),
    '23514', '2a: seven decimal places is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula)
    values (%L, 'Bad Key', 'Probe', 'total_dzd')$q$, v_ds),
    '23514', '2a: an uppercase metric key fails bi_metrics_key_shape');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, status)
    values (%L, 'bi_probe_m4', 'Probe', 'total_dzd', 'PUBLISHED')$q$, v_ds),
    '23514', '2a: PUBLISHED with no published_at fails bi_metrics_published_stamp');

  -- 22023, not 23514: bi_fold_expression is reached from the validation trigger and
  -- has no fold for MEDIAN, so it refuses before bi_metrics_aggregate_check is
  -- evaluated. Part 1m proves the constraint is there behind it.
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
    values (%L, 'bi_probe_median', 'Probe', 'total_dzd', 'MEDIAN')$q$, v_ds),
    '22023', '2a: an aggregate with no fold is refused when the metric is written');

  -- The lexical check passes -- `reference` is a real column and `sum` is allowed --
  -- and the planner is what refuses. Without this, sum(text) would have failed in
  -- front of whoever opened the dashboard instead of whoever defined the metric.
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
    values (%L, 'bi_probe_sumtext', 'Probe', 'reference', 'SUM')$q$, v_ds),
    '22023', '2a: a text column cannot be summed');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, filter_json)
    values (%L, 'bi_probe_badfilter', 'Probe', 'total_dzd',
            '[{"field":"not_a_column","op":"EQ","value":1}]'::jsonb)$q$, v_ds),
    '22023', '2a: a metric filter naming no registered column is refused');
end $step$;
-- Four metrics that work, so the refusals above are not the only thing proved and
-- so the ratio rules have real operands to be checked against.
insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
select d.id, 'bi_probe_count', 'Probe count', 'id', 'COUNT'
  from public.bi_datasets d where d.key = 'bi_suite_probe';
insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
select d.id, 'bi_probe_amount', 'Probe amount', 'total_dzd', 'SUM'
  from public.bi_datasets d where d.key = 'bi_suite_probe';
insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
select d.id, 'bi_probe_avg', 'Probe average', 'total_dzd', 'AVG'
  from public.bi_datasets d where d.key = 'bi_suite_probe';
insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate,
                              numerator_metric_key, denominator_metric_key)
select d.id, 'bi_probe_ratio', 'Probe ratio', '', 'RATIO',
       'bi_probe_amount', 'bi_probe_count'
  from public.bi_datasets d where d.key = 'bi_suite_probe';

do $step$
declare
  v_add  jsonb;
  v_row  record;
begin
  -- Additivity is measured from the aggregate, not declared by whoever wrote the
  -- metric: a subtotal that averages averages is the classic BI lie, and the flag
  -- that stops a UI from computing one is set here.
  select jsonb_object_agg(key, is_additive) into v_add
    from public.bi_metrics where key like 'bi\_probe\_%';
  if v_add is distinct from jsonb_build_object(
       'bi_probe_count', true, 'bi_probe_amount', true,
       'bi_probe_avg', false, 'bi_probe_ratio', false) then
    raise exception '2a: additivity was measured as % instead of SUM/COUNT only', v_add;
  end if;

  -- A ratio owns no expression, so the validator clears whatever was sent and
  -- records the two operands as its lineage instead.
  select formula, lineage->'operands' as operands into v_row
    from public.bi_metrics where key = 'bi_probe_ratio';
  if v_row.formula <> '' then
    raise exception '2a: a ratio kept the formula % instead of clearing it', v_row.formula;
  end if;
  if v_row.operands is distinct from '["bi_probe_amount","bi_probe_count"]'::jsonb then
    raise exception '2a: ratio lineage recorded operands % instead of the two keys',
      v_row.operands;
  end if;
end $step$;
do $step$
declare
  v_ds      text := (select id::text from public.bi_datasets where key = 'bi_suite_probe');
  v_unbound text := (select id::text from public.bi_datasets where key = 'bi_suite_unbound');
begin
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
    values (%L, 'bi_probe_count', 'Probe', 'id', 'COUNT')$q$, v_ds),
    '23505', '2a: two metrics cannot share a key');

  -- 22023, not the 23514 bi_metrics_ratio_shape would give: the operand lookup in
  -- bi_validate_metric runs as a BEFORE trigger and finds no metric named NULL, so
  -- it refuses before the constraint is evaluated. 1m proves the constraint exists.
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
    values (%L, 'bi_probe_r1', 'Probe', '', 'RATIO')$q$, v_ds),
    '22023', '2a: a ratio with no operands is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate,
                                  numerator_metric_key, denominator_metric_key)
    values (%L, 'bi_probe_r2', 'Probe', '', 'RATIO', 'bi_probe_r2', 'bi_probe_count')$q$, v_ds),
    '22023', '2a: a ratio cannot divide by itself');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate,
                                  numerator_metric_key, denominator_metric_key)
    values (%L, 'bi_probe_r3', 'Probe', '', 'RATIO', 'bi_probe_missing', 'bi_probe_count')$q$, v_ds),
    '22023', '2a: a ratio naming a numerator that is not a metric here is refused');

  -- The rule that keeps arithmetic honest: a ratio of ratios cannot be recomposed
  -- from its parts at any grain, so the compiler refuses to be handed one.
  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate,
                                  numerator_metric_key, denominator_metric_key)
    values (%L, 'bi_probe_r4', 'Probe', '', 'RATIO', 'bi_probe_ratio', 'bi_probe_ratio')$q$, v_ds),
    '22023', '2a: a ratio of two ratios is refused');

  perform pg_temp.bi_refuses(format($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
    values (%L, 'bi_probe_r5', 'Probe', 'total_dzd', 'SUM')$q$, v_unbound),
    '22023', '2a: a metric on a dataset with no source is refused');

  perform pg_temp.bi_refuses($q$
    insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
    values (gen_random_uuid(), 'bi_probe_r6', 'Probe', 'total_dzd', 'SUM')$q$,
    '22023', '2a: a metric on a dataset that does not exist is refused');
end $step$;
-- The probes are finished, so they go. Deleting the two datasets is also the only
-- honest way to check that a definition is a unit rather than three loosely related
-- tables: if `on delete cascade` were missing anywhere, a deleted dataset would leave
-- dimensions and metrics pointing at nothing and the counts below would not be zero.
delete from public.bi_datasets where key in ('bi_suite_probe', 'bi_suite_unbound');

do $step$
declare
  v_dims    integer;
  v_metrics integer;
begin
  select count(*) into v_dims    from public.bi_dimensions where key like 'bi\_probe\_%';
  select count(*) into v_metrics from public.bi_metrics    where key like 'bi\_probe\_%';
  if v_dims <> 0 or v_metrics <> 0 then
    raise exception '2a: deleting the probe datasets left % dimensions and % metrics behind',
      v_dims, v_metrics;
  end if;
end $step$;
-- ---------------------------------------------------------------------------
-- 2b. Three disposable accounts, because the separation this slice claims cannot
--     be shown by one.
--
--     An OPERATIONS_MANAGER who may define a dataset and may not publish one; an
--     ADMIN who may publish because has_permission answers true for ADMIN
--     unconditionally rather than because a seed row grants it; and an AGENT who
--     holds read on the catalog and nothing else. Section O leaves
--     bi_datasets.publish held by no role on purpose, and the pair ops/admin is
--     what turns that hole into a demonstrated refusal instead of a comment.
--
--     Each account is asserted for the permissions the later steps depend on, so
--     a failure here names a missing grant instead of surfacing later as a step
--     that mysteriously refuses. bookings.read is among them: 2e queries a
--     bookings dataset, and bi_run_query checks the source's own permission.
--
--     The emails are fixed rather than random so Part 3 can assert that none of
--     the three survived the rollback.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_agency uuid;
  v_branch uuid;
  v_ops    uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_agent  uuid := gen_random_uuid();
begin
  select a.id, b.id into v_agency, v_branch
    from public.agencies a
    join public.branches b on b.agency_id = a.id and b.code = 'HQ'
   where a.code = 'DEFAULT' limit 1;
  if v_agency is null then
    raise exception '2b: no DEFAULT/HQ agency; 20260324000300 seeds it, so the schema is incomplete';
  end if;

  insert into auth.users(id, email) values (v_ops,   'bi-suite-ops@invalid.test');
  insert into auth.users(id, email) values (v_admin, 'bi-suite-admin@invalid.test');
  insert into auth.users(id, email) values (v_agent, 'bi-suite-agent@invalid.test');
  insert into public.staff_profiles(user_id, role, agency_id, branch_uuid, branch_id, is_active)
  values (v_ops,   'OPERATIONS_MANAGER', v_agency, v_branch, v_branch::text, true),
         (v_admin, 'ADMIN',              v_agency, v_branch, v_branch::text, true),
         (v_agent, 'AGENT',              v_agency, v_branch, v_branch::text, true);
  raise notice '2b ok: three accounts exist in DEFAULT/HQ';
end $step$;
do $step$
declare
  r        record;
  v_expect boolean;
begin
  for r in
    select * from (values
      ('bi-suite-ops@invalid.test',   'OPERATIONS_MANAGER', 'bi_datasets',   'create',  true),
      ('bi-suite-ops@invalid.test',   'OPERATIONS_MANAGER', 'bi_datasets',   'publish', false),
      ('bi-suite-ops@invalid.test',   'OPERATIONS_MANAGER', 'bi_metrics',    'publish', false),
      ('bi-suite-ops@invalid.test',   'OPERATIONS_MANAGER', 'bi_dashboards', 'publish', true),
      ('bi-suite-ops@invalid.test',   'OPERATIONS_MANAGER', 'bi_query_log',  'read',    true),
      ('bi-suite-ops@invalid.test',   'OPERATIONS_MANAGER', 'bookings',      'read',    true),
      ('bi-suite-admin@invalid.test', 'ADMIN',              'bi_datasets',   'publish', true),
      ('bi-suite-admin@invalid.test', 'ADMIN',              'bi_metrics',    'publish', true),
      ('bi-suite-admin@invalid.test', 'ADMIN',              'bookings',      'read',    true),
      ('bi-suite-agent@invalid.test', 'AGENT',              'bi_datasets',   'read',    true),
      ('bi-suite-agent@invalid.test', 'AGENT',              'bi_datasets',   'create',  false),
      ('bi-suite-agent@invalid.test', 'AGENT',              'bi_dashboards', 'create',  false),
      ('bi-suite-agent@invalid.test', 'AGENT',              'bi_query_log',  'read',    false)
    ) as t(email, role, resource, action, expected)
  loop
    perform pg_temp.bi_become(r.email);
    if public.staff_role() <> r.role then
      raise exception '2b: % came back as % rather than %',
        r.email, coalesce(public.staff_role(), 'no role'), r.role;
    end if;
    v_expect := public.has_permission(r.resource, r.action);
    if v_expect is distinct from r.expected then
      raise exception '2b: % on %.% is % but the rest of Part 2 needs %',
        r.role, r.resource, r.action, v_expect, r.expected;
    end if;
  end loop;
  raise notice '2b ok: thirteen preconditions hold, including the two publish holes';
end $step$;
-- ---------------------------------------------------------------------------
-- 2c. The fixture rows, then the definition that reads them, written as ops.
--
--     Three bookings, not two: the third is a decoy whose reference does not match
--     the dataset's row filter. Without it, every number 2e asserts would be equally
--     true of a compiler that ignored row_filter_json entirely, and the filter is
--     the part of a semantic layer that stops a dashboard from quietly reporting
--     another branch's business.
--
--     The timestamps are fixed rather than relative because 2e asserts one row per
--     month and two per day. Nothing in the compiler applies a default time window
--     -- bi_compile_query takes no date range, only the filters it is given -- so a
--     date in the past stays visible and the suite reads the same in any month.
--
--     The dataset is left DRAFT here. Publishing it is 2d's subject, and a query
--     against a draft is what 2f needs in order to observe a DENIED row.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_agency  uuid;
  v_branch  uuid;
  v_pilgrim uuid;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  select a.id, b.id into v_agency, v_branch
    from public.agencies a
    join public.branches b on b.agency_id = a.id and b.code = 'HQ'
   where a.code = 'DEFAULT' limit 1;

  insert into public.pilgrims(full_name, agency_id, branch_id)
  values ('BI Suite Pilgrim', v_agency, v_branch)
  returning id into v_pilgrim;

  insert into public.bookings(reference, pilgrim_id, total_dzd, created_at, agency_id, branch_id)
  values ('BI-SUITE-001', v_pilgrim, 1000, '2026-04-11 09:00:00+00', v_agency, v_branch),
         ('BI-SUITE-002', v_pilgrim, 2000, '2026-04-12 09:00:00+00', v_agency, v_branch),
         ('BI-DECOY-001', v_pilgrim, 999999, '2026-04-13 09:00:00+00', v_agency, v_branch);
  raise notice '2c ok: two in-filter bookings and one decoy exist';
end $step$;
insert into public.bi_datasets(name, key, source_id, default_time_column, row_filter_json)
select 'BI suite bookings', 'bi_suite_bookings', s.id, 'created_at',
       '[{"field":"reference","op":"STARTS_WITH","value":"BI-SUITE-"}]'::jsonb
  from public.bi_sources s where s.key = 'bookings';

-- `bi_suite_month` drills down to `bi_suite_day` and drills through to the bookings
-- themselves. Both are the point of a semantic layer rather than decoration: 2k walks
-- the first and expands the second back into the two fixture rows.
insert into public.bi_dimensions(dataset_id, key, display_name, expression, data_type, is_default)
select d.id, 'bi_suite_day', 'Booking day', 'created_at::date', 'date', false
  from public.bi_datasets d where d.key = 'bi_suite_bookings';
insert into public.bi_dimensions(dataset_id, key, display_name, expression, data_type,
                                 drill_to_key, drill_through_kind, drill_through_expression,
                                 is_default)
select d.id, 'bi_suite_month', 'Booking month', 'to_char(created_at, ''YYYY-MM'')', 'text',
       'bi_suite_day', 'BOOKING', 'id', true
  from public.bi_datasets d where d.key = 'bi_suite_bookings';

insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
select d.id, 'bi_suite_count', 'Bookings', 'id', 'COUNT'
  from public.bi_datasets d where d.key = 'bi_suite_bookings';
insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
select d.id, 'bi_suite_amount', 'Booked amount', 'total_dzd', 'SUM'
  from public.bi_datasets d where d.key = 'bi_suite_bookings';
insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate,
                              numerator_metric_key, denominator_metric_key)
select d.id, 'bi_suite_avg_value', 'Average booking value', '', 'RATIO',
       'bi_suite_amount', 'bi_suite_count'
  from public.bi_datasets d where d.key = 'bi_suite_bookings';

do $step$
declare
  v_ds     record;
  v_dims   integer;
  v_mets   integer;
begin
  select status, source_id, default_time_column, version into v_ds
    from public.bi_datasets where key = 'bi_suite_bookings';
  if v_ds.status <> 'DRAFT' or v_ds.version <> 1 then
    raise exception '2c: a new dataset is % at version % rather than DRAFT at 1',
      v_ds.status, v_ds.version;
  end if;
  select count(*) into v_dims from public.bi_dimensions where key like 'bi\_suite\_%';
  select count(*) into v_mets from public.bi_metrics    where key like 'bi\_suite\_%';
  if v_dims <> 2 or v_mets <> 3 then
    raise exception '2c: the definition has % dimensions and % metrics, not 2 and 3',
      v_dims, v_mets;
  end if;
  raise notice '2c ok: bi_suite_bookings is defined and DRAFT';
end $step$;
-- ---------------------------------------------------------------------------
-- 2d. Publishing, which is the whole point of separating definition from approval.
--
--     Section O leaves bi_datasets.publish and bi_metrics.publish held by no role,
--     so the person who defines a metric can never be the person who blesses it. The
--     two refusals below are that design observed from the outside: the same call,
--     the same arguments, refused for ops and accepted for admin.
--
--     42501 rather than 22023 throughout, and deliberately so -- "you are not the
--     one who may do this" is a different fact from "this definition is incoherent",
--     and the UI shows the database's own sentence for both.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_ds  uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
  v_met uuid := (select id from public.bi_metrics  where key = 'bi_suite_count');
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DATASET'', %L, ''PUBLISHED'')', v_ds),
    '42501', '2d: the role that defined the dataset cannot publish it');
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''METRIC'', %L, ''PUBLISHED'')', v_met),
    '42501', '2d: the role that defined a metric cannot publish it');

  -- The refusal has to leave nothing behind, or "refused" would mean "half applied".
  if (select status from public.bi_datasets where id = v_ds) <> 'DRAFT' then
    raise exception '2d: a refused publish still moved the dataset off DRAFT';
  end if;
  if exists (select 1 from public.bi_events where entity_id = v_ds
               and event_type like 'STATUS\_%') then
    raise exception '2d: a refused publish still wrote an event';
  end if;

  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  -- Ordering, not permission: a published metric on a draft dataset is a number
  -- nobody but its author could compute, because bi_run_query refuses the dataset.
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''METRIC'', %L, ''PUBLISHED'')', v_met),
    '22023', '2d: a metric cannot be published before its dataset');
  raise notice '2d ok: publish is refused for ops and out of order for admin';
end $step$;
do $step$
declare
  v_ds    uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
  v_admin uuid := (select id from auth.users where email = 'bi-suite-admin@invalid.test');
  v_res   jsonb;
  v_row   record;
  v_ev    jsonb;
  v_agg   text;
  v_n     integer;
  r       record;
begin
  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  v_res := public.set_bi_status_command('DATASET', v_ds, 'PUBLISHED', 'suite');
  if v_res is distinct from jsonb_build_object('ok', true, 'kind', 'DATASET',
       'id', v_ds::text, 'from', 'DRAFT', 'to', 'PUBLISHED') then
    raise exception '2d: publishing answered % instead of the five-key receipt', v_res;
  end if;

  select status, published_at is not null as stamped, published_by, deprecated_at
    into v_row from public.bi_datasets where id = v_ds;
  if v_row.status <> 'PUBLISHED' or not v_row.stamped
     or v_row.published_by is distinct from v_admin or v_row.deprecated_at is not null then
    raise exception '2d: after publishing the row reads status %, stamped %, by %',
      v_row.status, v_row.stamped, v_row.published_by;
  end if;

  -- The event is the part a later auditor reads, so its payload is asserted rather
  -- than its existence: `from` is what makes a status history replayable.
  select payload into v_ev from public.bi_events
   where entity_kind = 'DATASET' and entity_id = v_ds and event_type = 'STATUS_PUBLISHED';
  if v_ev->>'from' <> 'DRAFT' or v_ev->>'to' <> 'PUBLISHED' or v_ev->>'note' <> 'suite' then
    raise exception '2d: the publish event recorded %', v_ev;
  end if;

  for r in select id, key, aggregate from public.bi_metrics
            where dataset_id = v_ds order by key loop
    perform public.set_bi_status_command('METRIC', r.id, 'PUBLISHED');
    select payload->>'aggregate' into v_agg from public.bi_events
     where entity_kind = 'METRIC' and entity_id = r.id and event_type = 'STATUS_PUBLISHED';
    if v_agg is distinct from r.aggregate then
      raise exception '2d: metric % logged aggregate % rather than %', r.key, v_agg, r.aggregate;
    end if;
  end loop;

  select count(*) into v_n from public.bi_metrics
   where dataset_id = v_ds and status = 'PUBLISHED' and published_at is not null;
  if v_n <> 3 then
    raise exception '2d: % of 3 metrics are published and stamped', v_n;
  end if;
  raise notice '2d ok: the dataset and its three metrics are published by admin';
end $step$;
-- What publishing checks before it agrees, walked with one throwaway dataset that is
-- completed one piece at a time. Each refusal is a promise to whoever opens a
-- dashboard: a published dataset has a source, something to group by, and something
-- to measure -- so a tile can never resolve to an empty screen for a reason the
-- viewer cannot see.
do $step$
declare
  v_bare uuid;
begin
  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  insert into public.bi_datasets(name, key) values ('BI suite bare', 'bi_suite_bare')
  returning id into v_bare;

  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DATASET'', %L, ''PUBLISHED'')', v_bare),
    '22023', '2d: a dataset with no source cannot be published');

  update public.bi_datasets set source_id = (select id from public.bi_sources where key = 'bookings')
   where id = v_bare;
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DATASET'', %L, ''PUBLISHED'')', v_bare),
    '22023', '2d: a dataset with no dimensions cannot be published');

  insert into public.bi_dimensions(dataset_id, key, display_name, expression)
  values (v_bare, 'bi_suite_bare_ref', 'Reference', 'reference');
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DATASET'', %L, ''PUBLISHED'')', v_bare),
    '22023', '2d: a dataset with no metrics cannot be published');

  perform pg_temp.bi_refuses(
    'select public.set_bi_status_command(''DATASET'', gen_random_uuid(), ''PUBLISHED'')',
    '22023', '2d: a dataset that does not exist cannot be published');
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DATASET'', %L, ''RETIRED'')', v_bare),
    '22023', '2d: RETIRED is not one of the three statuses');
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''CHART'', %L, ''PUBLISHED'')', v_bare),
    '22023', '2d: CHART is not a publishable kind');

  delete from public.bi_datasets where id = v_bare;
  raise notice '2d ok: publishing refuses an incomplete definition three ways';
end $step$;
-- ---------------------------------------------------------------------------
-- 2e. The compiler, asked real questions against real rows.
--
--     Refusals here are read off the payload rather than caught, because
--     run_bi_query_command does not raise: private.bi_run_query wraps the whole
--     body in an exception handler so a failed analysis still writes a ledger row.
--     A caller learns "no" from `ok:false` and `error_code`, and 2f then checks
--     that the same "no" was written down.
--
--     The numbers are the falsifiable part. Three bookings sit in April 2026 and
--     only two match the dataset's row filter, so count 2 / amount 3000 / ratio
--     1500 are all wrong for a compiler that drops row_filter_json, and the day
--     grouping returns two rows rather than three for the same reason.
-- ---------------------------------------------------------------------------
do $step$
declare v_ds uuid;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';

  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, array['bi_suite_nope'], array['bi_suite_count']),
    '22023', '2e: an undefined dimension is not compiled');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, array['bi_suite_day'], array['bi_suite_nope']),
    '22023', '2e: an undefined metric is not compiled');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', '{}'),
    '22023', '2e: an analysis with neither a dimension nor a metric is refused');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
                                p_time_grain => 'FORTNIGHT'),
    '22023', '2e: a time grain outside the closed set of five is refused');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, array['bi_suite_day'], array['bi_suite_count'],
                                p_order_by => 'bi_suite_month'),
    '22023', '2e: ordering by a column that was not selected is refused');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(gen_random_uuid(), '{}', array['bi_suite_count']),
    '22023', '2e: a dataset that does not exist has nothing to compile');
  raise notice '2e ok: the compiler refuses six malformed requests through its payload';
end $step$;
do $step$
declare v_ds uuid; v_res jsonb; v_row jsonb;
begin
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';
  v_res := public.run_bi_query_command(v_ds, array['bi_suite_month'],
             array['bi_suite_count', 'bi_suite_amount', 'bi_suite_avg_value']);
  if coalesce(v_res->>'ok', 'missing') <> 'true' then
    raise exception '2e: the month analysis failed with % (%)',
      v_res->>'error_code', v_res->>'error_message';
  end if;
  if (v_res->>'row_count')::integer <> 1 then
    raise exception '2e: April 2026 is one month but the analysis returned % rows',
      v_res->>'row_count';
  end if;
  v_row := v_res->'rows'->0;
  if v_row->>'d0' <> '2026-04' then
    raise exception '2e: the month dimension rendered % instead of 2026-04', v_row->>'d0';
  end if;
  -- The decoy is the point of this assertion. BI-DECOY-001 is a April 2026 booking
  -- for 999999 DZD whose reference does not match the dataset's row filter, so a
  -- compiler that ignored row_filter_json would answer 3 and 1002999 here and the
  -- month grouping would still look perfectly plausible.
  if (v_row->>'m0')::numeric <> 2 then
    raise exception '2e: the row filter let % bookings through instead of 2', v_row->>'m0';
  end if;
  if (v_row->>'m1')::numeric <> 3000 then
    raise exception '2e: the booked amount came out % instead of 3000', v_row->>'m1';
  end if;
  -- 1500, not an average of averages: the RATIO is composed at query time out of
  -- its two operands' folds, so it is sum/count over the group rather than a mean
  -- of per-row means. This is the same fact 2a asserted as is_additive=false.
  if (v_row->>'m2')::numeric <> 1500 then
    raise exception '2e: the ratio came out % instead of 3000/2', v_row->>'m2';
  end if;
  if coalesce(v_res->>'truncated', 'missing') <> 'false'
     or (v_res->>'row_limit')::integer <> 500 then
    raise exception '2e: one row under a 500-row limit was reported as truncated=% limit=%',
      v_res->>'truncated', v_res->>'row_limit';
  end if;
  raise notice '2e ok: 2 bookings, 3000 DZD, 1500 average, one month';
end $step$;
do $step$
declare v_ds uuid; v_res jsonb; v_map jsonb; v_add jsonb;
begin
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';
  v_res := public.run_bi_query_command(v_ds, array['bi_suite_month'],
             array['bi_suite_count', 'bi_suite_amount', 'bi_suite_avg_value']);
  -- The alias map is the contract between the compiler and every chart in the app.
  -- The client reads rows by `d0`/`m1` and never by the key it asked for, because
  -- the keys are the caller's strings and the aliases are the compiler's own -- so
  -- if this mapping drifted, every visualization would read the wrong column
  -- without erroring once.
  select jsonb_object_agg(c->>'key', c->>'alias') into v_map
    from jsonb_array_elements(v_res->'columns') c;
  if v_map is distinct from jsonb_build_object(
       'bi_suite_month', 'd0', 'bi_suite_count', 'm0',
       'bi_suite_amount', 'm1', 'bi_suite_avg_value', 'm2') then
    raise exception '2e: the column aliases came back as %', v_map;
  end if;
  -- Additivity travels with the column and not only with the row in bi_metrics:
  -- this is the copy a subtotal switch and a chart legend actually read.
  select jsonb_object_agg(c->>'key', c->'is_additive') into v_add
    from jsonb_array_elements(v_res->'columns') c where c->>'kind' = 'METRIC';
  if v_add is distinct from jsonb_build_object(
       'bi_suite_count', true, 'bi_suite_amount', true, 'bi_suite_avg_value', false) then
    raise exception '2e: the payload advertised additivity as %', v_add;
  end if;
  -- Drill metadata rides on the dimension column for the same reason: the cell a
  -- reader clicks has to know where it leads without a second round trip.
  if v_res->'columns'->0->>'drill_to_key' <> 'bi_suite_day'
     or v_res->'columns'->0->>'drill_through_kind' <> 'BOOKING' then
    raise exception '2e: the month column carried drill % / %',
      v_res->'columns'->0->>'drill_to_key', v_res->'columns'->0->>'drill_through_kind';
  end if;
  raise notice '2e ok: the column contract names four aliases, three additivity flags and one drill';
end $step$;
do $step$
declare v_ds uuid; v_res jsonb;
begin
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';
  -- Grouped one level finer, and ordered by the dimension rather than by the
  -- default of first-metric-descending, because both days count 1 and a tie is not
  -- an order. Asking for the order explicitly is also what proves p_order_by is
  -- resolved through the column list into an ordinal rather than pasted into SQL.
  v_res := public.run_bi_query_command(v_ds, array['bi_suite_day'],
             array['bi_suite_count', 'bi_suite_amount'],
             p_order_by => 'bi_suite_day', p_order_desc => false);
  if (v_res->>'row_count')::integer <> 2 then
    raise exception '2e: two in-filter bookings on two days is 2 rows, got %',
      v_res->>'row_count';
  end if;
  if v_res->'rows'->0->>'d0' <> '2026-04-11'
     or v_res->'rows'->1->>'d0' <> '2026-04-12' then
    raise exception '2e: ascending by day gave % then %',
      v_res->'rows'->0->>'d0', v_res->'rows'->1->>'d0';
  end if;
  if (v_res->'rows'->0->>'m1')::numeric <> 1000
     or (v_res->'rows'->1->>'m1')::numeric <> 2000 then
    raise exception '2e: the per-day amounts were % and %',
      v_res->'rows'->0->>'m1', v_res->'rows'->1->>'m1';
  end if;
  -- The decoy from the other side: 2026-04-13 must not be a row at all, at any
  -- grain, for any amount.
  if exists (select 1 from jsonb_array_elements(v_res->'rows') r
              where r->>'d0' = '2026-04-13' or (r->>'m1')::numeric = 999999) then
    raise exception '2e: the decoy booking reached the result set';
  end if;
  raise notice '2e ok: by day, two rows, 1000 then 2000, and no decoy';
end $step$;
do $step$
declare v_ds uuid; v_res jsonb; v_col jsonb;
begin
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';
  -- A time grain is not a dimension anybody defined. It is the compiler adding one
  -- from the dataset's own default_time_column, under the reserved key `bi_period`
  -- -- which is why bi_compile_query refuses a grain on a dataset that already
  -- defines a dimension of that name instead of emitting two columns called one
  -- thing. Nothing here passes a date range: there is no parameter for one, so a
  -- fixed April 2026 fixture stays visible whatever day the gate runs.
  v_res := public.run_bi_query_command(v_ds, '{}', array['bi_suite_amount'],
             p_time_grain => 'MONTH');
  if coalesce(v_res->>'ok', 'missing') <> 'true' or v_res->>'time_grain' <> 'MONTH' then
    raise exception '2e: the grain run answered ok=% grain=%',
      v_res->>'ok', v_res->>'time_grain';
  end if;
  if (v_res->>'row_count')::integer <> 1 then
    raise exception '2e: one month of bookings became % rows', v_res->>'row_count';
  end if;
  select c into v_col from jsonb_array_elements(v_res->'columns') c
   where c->>'kind' = 'DIMENSION';
  if v_col->>'key' <> 'bi_period' or v_col->>'alias' <> 'd0'
     or v_col->>'grain' <> 'MONTH' or v_col->>'data_type' <> 'timestamp' then
    raise exception '2e: the generated period column came back as %', v_col;
  end if;
  -- date_trunc, so the cell is the first instant of the month and a chart can sort
  -- and space it as a date. The month dimension defined in 2c is a string for
  -- labelling; this one is a timestamp for arithmetic. Both exist on purpose.
  if left(v_res->'rows'->0->>'d0', 7) <> '2026-04'
     or (v_res->'rows'->0->>'m0')::numeric <> 3000 then
    raise exception '2e: the truncated month row was % / %',
      v_res->'rows'->0->>'d0', v_res->'rows'->0->>'m0';
  end if;
  raise notice '2e ok: a MONTH grain adds bi_period from the dataset time column';
end $step$;
-- The caller's filters. Every one of these arrives as JSON from a browser, so the
-- five refusals matter as much as the three results: a filter is the one part of an
-- analysis where a value the caller typed reaches the WHERE clause, and it gets
-- there through private.bi_literal rather than through string concatenation.
do $step$
declare v_ds uuid;
begin
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
      '[{"field":"not_a_field","op":"EQ","value":1}]'::jsonb),
    '22023', '2e: a filter field that is neither a dimension nor a source column is refused');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
      '[{"field":"reference","op":"IN","values":[]}]'::jsonb),
    '22023', '2e: IN with an empty list is refused rather than compiled to in ()');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
      '[{"field":"total_dzd","op":"BETWEEN","value":1}]'::jsonb),
    '22023', '2e: BETWEEN with one bound is refused');
  -- `> null` is never true, so a filter that compiled it would silently return an
  -- empty analysis and look like an absence of data.
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
      '[{"field":"total_dzd","op":"GT","value":null}]'::jsonb),
    '22023', '2e: an ordering comparison against no value is refused');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
      '[{"field":"reference","op":"REGEX","value":"^BI"}]'::jsonb),
    '22023', '2e: an operator outside the closed set is refused');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
      '{"field":"reference","op":"EQ","value":"x"}'::jsonb),
    '22023', '2e: a filter object that is not an array is refused');
  raise notice '2e ok: six malformed filters are refused before they reach a WHERE clause';
end $step$;
do $step$
declare v_ds uuid; v_res jsonb;
begin
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';
  -- Resolved as a dimension: the filter names `bi_suite_day`, and what lands in the
  -- WHERE clause is that dimension's expression, so a caller filters on the thing
  -- the chart showed it rather than on a column it was never told about.
  v_res := public.run_bi_query_command(v_ds, '{}',
             array['bi_suite_count', 'bi_suite_amount'],
             '[{"field":"bi_suite_day","op":"EQ","value":"2026-04-11"}]'::jsonb);
  if (v_res->'rows'->0->>'m0')::numeric <> 1
     or (v_res->'rows'->0->>'m1')::numeric <> 1000 then
    raise exception '2e: filtering to one day gave % bookings worth %',
      v_res->'rows'->0->>'m0', v_res->'rows'->0->>'m1';
  end if;
  -- Resolved as a source column: `total_dzd` is no dimension of this dataset, so the
  -- second lookup finds it in bi_source_columns and types the literal from there.
  -- The answer is 1 and not 2 because the row filter is ANDed in first -- the decoy
  -- is also above 1500.
  v_res := public.run_bi_query_command(v_ds, '{}',
             array['bi_suite_count', 'bi_suite_amount'],
             '[{"field":"total_dzd","op":"GT","value":1500}]'::jsonb);
  if (v_res->'rows'->0->>'m0')::numeric <> 1
     or (v_res->'rows'->0->>'m1')::numeric <> 2000 then
    raise exception '2e: filtering above 1500 gave % bookings worth %',
      v_res->'rows'->0->>'m0', v_res->'rows'->0->>'m1';
  end if;
  -- The escaping, stated as a number. A bare percent sign is a LIKE wildcard, so an
  -- unescaped CONTAINS would match both in-filter bookings and answer 2. Escaped, it
  -- searches for a literal "%" in the reference and finds none.
  v_res := public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
             '[{"field":"reference","op":"CONTAINS","value":"%"}]'::jsonb);
  if (v_res->'rows'->0->>'m0')::numeric <> 0 then
    raise exception '2e: CONTAINS "%%" matched % rows, so the wildcard was not escaped',
      v_res->'rows'->0->>'m0';
  end if;
  v_res := public.run_bi_query_command(v_ds, '{}', array['bi_suite_count'],
             '[{"field":"reference","op":"IN","values":["BI-SUITE-001","BI-SUITE-002"]}]'::jsonb);
  if (v_res->'rows'->0->>'m0')::numeric <> 2 then
    raise exception '2e: an IN list of both references matched % rows',
      v_res->'rows'->0->>'m0';
  end if;
  raise notice '2e ok: filters resolve as dimension, as column, and with LIKE escaped';
end $step$;
-- ---------------------------------------------------------------------------
-- 2f. The query ledger, which is the only record of what a semantic layer cost
--     and who spent it.
--
--     Three outcomes are written and all three are asserted. OK from 2e's runs,
--     ERROR from its malformed requests, DENIED from a refusal that was about
--     permission rather than about shape. The distinction is not cosmetic: DENIED
--     is the row somebody reads when a colleague is probing what they cannot see,
--     ERROR is the row somebody reads when a definition is broken, and a ledger
--     that spelled both 'ERROR' would answer neither question.
--
--     The DENIED row needs its own dataset. bi_suite_bookings has been PUBLISHED
--     since 2d, and a published dataset is readable by every role that can read the
--     relation behind it. A DRAFT is readable by its author and by ADMIN and by
--     nobody else, which is the whole reason DRAFT is usable as a workspace.
-- ---------------------------------------------------------------------------
do $step$
declare v_draft uuid;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  insert into public.bi_datasets(name, key, source_id, default_time_column)
  select 'BI suite draft', 'bi_suite_draft', s.id, 'created_at'
    from public.bi_sources s where s.key = 'bookings'
  returning id into v_draft;
  insert into public.bi_dimensions(dataset_id, key, display_name, expression)
  values (v_draft, 'bi_suite_draft_ref', 'Reference', 'reference');
  insert into public.bi_metrics(dataset_id, key, display_name, formula, aggregate)
  values (v_draft, 'bi_suite_draft_count', 'Rows', 'id', 'COUNT');

  -- The author reads their own draft first. Without this line the refusal below
  -- would prove nothing: a dataset nobody can read is not access control.
  if coalesce(public.run_bi_query_command(v_draft, '{}',
       array['bi_suite_draft_count'])->>'ok', 'missing') <> 'true' then
    raise exception '2f: the author of a draft cannot read their own draft';
  end if;

  perform pg_temp.bi_become('bi-suite-agent@invalid.test');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_draft, '{}', array['bi_suite_draft_count']),
    '42501', '2f: a draft is not readable by somebody who does not own it');
  raise notice '2f ok: a draft is a workspace, not a publication';
end $step$;
do $step$
declare v_ds uuid; v_n integer; v_bad integer;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  select id into v_ds from public.bi_datasets where key = 'bi_suite_bookings';
  -- The counts are exact rather than "at least one", so that adding a run to 2e
  -- without noticing it was billed cannot pass this gate.
  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_ds and outcome = 'OK';
  if v_n <> 8 then
    raise exception '2f: the published dataset was billed % OK runs, expected 2e''s 8', v_n;
  end if;
  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_ds and outcome = 'ERROR';
  if v_n <> 11 then
    raise exception '2f: % ERROR rows for the published dataset, expected 2e''s 11', v_n;
  end if;
  select count(*) into v_bad from public.bi_query_log
   where dataset_id = v_ds and outcome = 'ERROR' and error_code is distinct from '22023';
  if v_bad <> 0 then
    raise exception '2f: % refused runs carried an SQLSTATE other than 22023', v_bad;
  end if;
  -- The request for a dataset that does not exist is logged with a null dataset_id
  -- rather than not logged at all: the foreign key cannot hold an id that names no
  -- row, and a failure the ledger drops is a failure nobody can count. The id
  -- itself survives in the request payload, which is where a reader looks for it.
  select count(*) into v_n from public.bi_query_log
   where dataset_id is null and outcome = 'ERROR' and error_code = '22023'
     and request->>'dataset_id' is not null;
  if v_n <> 1 then
    raise exception '2f: the vanished-dataset request produced % unattributed rows', v_n;
  end if;
  raise notice '2f ok: 8 billed runs and 12 refused ones are on the ledger';
end $step$;
do $step$
declare
  v_ds uuid; v_draft uuid; v_ops uuid; v_agent uuid; v_n integer;
  v_sql text; v_rows integer; v_actor uuid;
begin
  select id into v_ds    from public.bi_datasets where key = 'bi_suite_bookings';
  select id into v_draft from public.bi_datasets where key = 'bi_suite_draft';
  select id into v_ops   from auth.users where email = 'bi-suite-ops@invalid.test';
  select id into v_agent from auth.users where email = 'bi-suite-agent@invalid.test';
  -- Attribution. A ledger that cannot say who ran a query is an expense report with
  -- no names on it.
  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_ds and actor_id is distinct from v_ops;
  if v_n <> 0 then
    raise exception '2f: % rows on the published dataset were not attributed to ops', v_n;
  end if;

  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_draft and outcome = 'DENIED';
  if v_n <> 1 then
    raise exception '2f: the draft refusal wrote % DENIED rows', v_n;
  end if;
  select compiled_sql, row_count, actor_id into v_sql, v_rows, v_actor
    from public.bi_query_log where dataset_id = v_draft and outcome = 'DENIED';
  if v_actor is distinct from v_agent then
    raise exception '2f: the DENIED row was attributed to % rather than to the agent', v_actor;
  end if;
  -- Compiled, then refused. The permission check that stops a draft runs after the
  -- compiler, so the statement that would have run is on the ledger while row_count
  -- stays null -- which is exactly the pair of facts an auditor needs: what was
  -- asked for, and that it never executed.
  if coalesce(v_sql, '') = '' then
    raise exception '2f: the DENIED row recorded no SQL, so what was attempted is unknown';
  end if;
  if v_rows is not null then
    raise exception '2f: the DENIED row claims % rows came back from a query that did not run',
      v_rows;
  end if;
  raise notice '2f ok: the refusal is attributed, compiled and unexecuted';
end $step$;
do $step$
declare v_ds uuid; v_draft uuid; v_n integer; v_row record;
begin
  select id into v_ds    from public.bi_datasets where key = 'bi_suite_bookings';
  select id into v_draft from public.bi_datasets where key = 'bi_suite_draft';
  -- What is stored is the statement, not the request: the request is a wish and the
  -- statement is what the database was actually told to do. Two properties of every
  -- stored statement are asserted here, because both are promises the compiler makes
  -- and neither is visible from the payload the caller got back.
  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_ds and outcome = 'OK' and compiled_sql not ilike '%BI-SUITE-%';
  if v_n <> 0 then
    raise exception '2f: % billed statements were compiled without the dataset row filter', v_n;
  end if;
  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_ds and outcome = 'OK'
     and (compiled_sql like '%;%' or compiled_sql not like '% limit %');
  if v_n <> 0 then
    raise exception '2f: % billed statements were not one single limited statement', v_n;
  end if;
  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_ds and outcome = 'OK' and column_count = 4;
  if v_n <> 2 then
    raise exception '2f: % runs reported four columns, expected the two month analyses', v_n;
  end if;
  select count(*) into v_n from public.bi_query_log
   where dataset_id = v_ds and outcome = 'OK'
     and (row_count is null or duration_ms is null);
  if v_n <> 0 then
    raise exception '2f: % billed runs recorded no row count or no duration', v_n;
  end if;
  -- Usage counters move on success only. A refused query is not usage, and a tile
  -- that says "last read four minutes ago" must not be counting somebody's failures.
  select query_count, last_queried_at is not null as touched into v_row
    from public.bi_datasets where id = v_ds;
  if v_row.query_count <> 8 or not v_row.touched then
    raise exception '2f: the published dataset counts % queries (touched=%)',
      v_row.query_count, v_row.touched;
  end if;
  select query_count into v_n from public.bi_datasets where id = v_draft;
  if v_n <> 1 then
    raise exception '2f: the draft counts % queries, so a refusal was billed as usage', v_n;
  end if;
  raise notice '2f ok: the ledger stores statements, and only successes are usage';
end $step$;
-- ---------------------------------------------------------------------------
-- 2g. The freeze, which is the difference between a metric and a variable.
--
--     A published metric's meaning cannot be edited in place. Not because editing
--     is dangerous in itself, but because last quarter's dashboard printed a number
--     and somebody will eventually ask what that number meant -- and the only
--     honest answer is a version. So changing what a metric measures is a route:
--     back to DRAFT (which bumps the version and writes an event), edit, publish
--     again. Four lines of trigger, and a year later the question is answerable.
--
--     What is *not* frozen is asserted too, and it is the more delicate half. A
--     display name is a label, not a meaning; freezing it would mean a typo in
--     "Booked amont" outlives the quarter, and a system that punishes proofreading
--     gets edited around rather than obeyed.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_met     uuid := (select id from public.bi_metrics where key = 'bi_suite_amount');
  v_version integer;
  v_name    text;
begin
  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  perform pg_temp.bi_refuses(
    format('update public.bi_metrics set formula = %L where id = %L', 'total_dzd * 2', v_met),
    '22023', '2g: a published metric''s formula cannot be edited in place');
  perform pg_temp.bi_refuses(
    format('update public.bi_metrics set aggregate = %L where id = %L', 'AVG', v_met),
    '22023', '2g: a published metric''s aggregate cannot be edited in place');
  perform pg_temp.bi_refuses(
    format('update public.bi_metrics set filter_json = %L where id = %L',
           '[{"field":"total_dzd","op":"GT","value":0}]', v_met),
    '22023', '2g: a published metric''s own filter cannot be edited in place');
  perform pg_temp.bi_refuses(
    format('update public.bi_metrics set numerator_metric_key = %L where key = %L',
           'bi_suite_count', 'bi_suite_avg_value'),
    '22023', '2g: a published ratio''s operands cannot be swapped in place');

  -- The label moves freely, and the version does not move with it: renaming is not
  -- a new definition, and a version that ticked for a typo would be noise in the
  -- one column an auditor reads.
  update public.bi_metrics set display_name = 'Booked amount (DZD)' where id = v_met;
  select display_name, version into v_name, v_version
    from public.bi_metrics where id = v_met;
  if v_name <> 'Booked amount (DZD)' or v_version <> 1 then
    raise exception '2g: after renaming, the metric reads "%" at version %', v_name, v_version;
  end if;
  raise notice '2g ok: meaning is frozen while published, and the label is not';
end $step$;
-- The route the freeze leaves open, walked end to end. Note that the assertions on
-- bi_events compare *sets* rather than reading "the latest" row: every statement in
-- this suite runs inside one transaction, where now() is frozen, so created_at is
-- identical across all of these events and ordering by it would pick an arbitrary
-- one. The set is also the stronger claim -- the history holds both meanings at once,
-- which is the property that makes last quarter's number explicable.
do $step$
declare
  v_met  uuid := (select id from public.bi_metrics where key = 'bi_suite_amount');
  v_row  record;
  v_ev   jsonb;
  v_n    integer;
  v_set  text[];
begin
  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  perform public.set_bi_status_command('METRIC', v_met, 'DRAFT', 'restating the amount');

  select status, version, published_at, deprecated_at into v_row
    from public.bi_metrics where id = v_met;
  if v_row.status <> 'DRAFT' or v_row.version <> 2
     or v_row.published_at is not null or v_row.deprecated_at is not null then
    raise exception '2g: returning to draft left status % at version % (published_at %)',
      v_row.status, v_row.version, v_row.published_at;
  end if;

  -- The event that records the return carries the formula as it was, not as it is
  -- about to become: this row is the last description of the old meaning.
  select payload into v_ev from public.bi_events
   where entity_kind = 'METRIC' and entity_id = v_met and event_type = 'STATUS_DRAFT';
  if v_ev->>'from' <> 'PUBLISHED' or v_ev->>'formula' <> 'total_dzd'
     or v_ev->>'note' <> 'restating the amount' then
    raise exception '2g: the return-to-draft event recorded %', v_ev;
  end if;

  update public.bi_metrics set formula = 'total_dzd * 2' where id = v_met;
  perform public.set_bi_status_command('METRIC', v_met, 'PUBLISHED');

  select status, version into v_row from public.bi_metrics where id = v_met;
  if v_row.status <> 'PUBLISHED' or v_row.version <> 2 then
    raise exception '2g: re-publishing left status % at version %', v_row.status, v_row.version;
  end if;

  select count(*), array_agg(payload->>'formula' order by payload->>'formula')
    into v_n, v_set from public.bi_events
   where entity_kind = 'METRIC' and entity_id = v_met and event_type = 'STATUS_PUBLISHED';
  if v_n <> 2 or v_set is distinct from array['total_dzd', 'total_dzd * 2'] then
    raise exception '2g: the metric has % publish events describing %', v_n, v_set;
  end if;
  raise notice '2g ok: meaning changes by version, and both versions are on the record';
end $step$;
-- And the part that makes the freeze worth having: the number moves. A semantic layer
-- that cached a compiled plan would answer 3000 here and be wrong in the most
-- expensive way -- silently, and only for the definitions somebody had bothered to
-- correct. The queries are run as ops so that every billed row on this dataset stays
-- attributed to the one analyst, as 2f asserted.
do $step$
declare
  v_ds  uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
  v_met uuid := (select id from public.bi_metrics  where key = 'bi_suite_amount');
  v_res jsonb;
  v_row record;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  v_res := public.run_bi_query_command(v_ds, array['bi_suite_month'], array['bi_suite_amount']);
  if v_res->>'ok' <> 'true' or (v_res->'rows'->0->>'m0')::numeric <> 6000 then
    raise exception '2g: after doubling the formula the month answers % (ok=%)',
      v_res->'rows'->0->>'m0', v_res->>'ok';
  end if;

  -- Restoring the old text is not restoring the old version. Version 3 measures what
  -- version 1 measured, and the two are still different definitions: one was written
  -- before the correction and one after, and a dashboard printed from each of them
  -- can be told apart. A version counter that went backwards would make that
  -- impossible, and would also make it impossible to trust the counter at all.
  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  perform public.set_bi_status_command('METRIC', v_met, 'DRAFT', 'putting it back');
  update public.bi_metrics set formula = 'total_dzd' where id = v_met;
  perform public.set_bi_status_command('METRIC', v_met, 'PUBLISHED');

  select status, version, formula into v_row from public.bi_metrics where id = v_met;
  if v_row.status <> 'PUBLISHED' or v_row.version <> 3 or v_row.formula <> 'total_dzd' then
    raise exception '2g: after restoring, the metric is % at version % measuring %',
      v_row.status, v_row.version, v_row.formula;
  end if;

  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  v_res := public.run_bi_query_command(v_ds, array['bi_suite_month'], array['bi_suite_amount']);
  if (v_res->'rows'->0->>'m0')::numeric <> 3000 then
    raise exception '2g: after restoring the formula the month answers %',
      v_res->'rows'->0->>'m0';
  end if;
  raise notice '2g ok: the compiler reads the definition of record, not a cached plan';
end $step$;
-- ---------------------------------------------------------------------------
-- 2h. Saved analyses, where the definition is validated by compiling it.
--
--     trg_bi_validate_visualization does not check the chart against a list of
--     rules; it runs the compiler over the saved arguments and lets the compiler
--     refuse. So a tile can never be saved in a state that fails when somebody
--     opens the dashboard next quarter -- the failure happens at the moment of
--     saving, to the person who can fix it.
--
--     The two SQLSTATEs below are worth reading together. A bad time grain is
--     22023 and a bad row limit is 23514, even though both are also spelled out in
--     check constraints on the table: the BEFORE trigger runs first, so whatever
--     the compiler has an opinion about is answered by the compiler, and the
--     constraint is the backstop for what it does not look at.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_ds uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  perform pg_temp.bi_refuses(
    $q$insert into public.bi_visualizations(key, title, chart_type, dataset_id, dimensions)
       values ('bi_suite_viz_unbound', 'Unbound', 'COLUMN', null, '["bi_suite_month"]'::jsonb)$q$,
    '22023', '2h: an analysis cannot name dimensions with no dataset to resolve them');
  perform pg_temp.bi_refuses(
    format($q$insert into public.bi_visualizations(key, title, chart_type, dataset_id, dimensions)
              values ('bi_suite_viz_bad', 'Bad', 'COLUMN', %L, '["bi_suite_nope"]'::jsonb)$q$, v_ds),
    '22023', '2h: an analysis naming an undefined dimension is not saved');
  perform pg_temp.bi_refuses(
    format($q$insert into public.bi_visualizations(key, title, chart_type, dataset_id, measures, time_grain)
              values ('bi_suite_viz_grain', 'Grain', 'LINE', %L, '["bi_suite_count"]'::jsonb, 'FORTNIGHT')$q$, v_ds),
    '22023', '2h: the compiler answers a bad time grain before the check constraint does');
  perform pg_temp.bi_refuses(
    format($q$insert into public.bi_visualizations(key, title, chart_type, dataset_id, measures)
              values ('bi_suite_viz_chart', 'Chart', 'PIE_CHART_3D', %L, '["bi_suite_count"]'::jsonb)$q$, v_ds),
    '23514', '2h: a chart type outside the vocabulary is refused by the constraint');
  perform pg_temp.bi_refuses(
    format($q$insert into public.bi_visualizations(key, title, chart_type, dataset_id, measures, row_limit)
              values ('bi_suite_viz_rows', 'Rows', 'TABLE', %L, '["bi_suite_count"]'::jsonb, 9000)$q$, v_ds),
    '23514', '2h: a row limit above the ceiling is refused by the constraint');

  -- The one shape the trigger deliberately allows: a sketch bound to nothing. An
  -- analyst who has opened the builder and chosen a chart has not yet made a claim
  -- about any data, and refusing to save that would mean losing work to a
  -- half-finished thought.
  insert into public.bi_visualizations(key, title, chart_type)
  values ('bi_suite_viz_sketch', 'A sketch', 'KPI');
  raise notice '2h ok: an analysis is validated by compiling it, and a sketch is allowed';
end $step$;
do $step$
declare
  v_ds  uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
  v_viz uuid;
  v_res jsonb;
  v_n   integer;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  insert into public.bi_visualizations(key, title, title_ar, chart_type, dataset_id,
                                       dimensions, measures, order_by, order_desc)
  values ('bi_suite_viz_month', 'Bookings by month', 'الحجوزات شهريا', 'COLUMN', v_ds,
          '["bi_suite_month"]'::jsonb, '["bi_suite_count","bi_suite_amount"]'::jsonb,
          'bi_suite_count', true)
  returning id into v_viz;

  v_res := public.run_bi_visualization_command(v_viz);
  -- A saved analysis returns the result *and* how to draw it, in one call. The
  -- alternative -- rows from one round trip and the chart type from another -- is how
  -- a dashboard ends up drawing last week's shape over this week's numbers.
  if v_res->>'ok' <> 'true' or v_res->>'chart_type' <> 'COLUMN'
     or v_res->>'visualization_key' <> 'bi_suite_viz_month'
     or v_res->>'title' <> 'Bookings by month'
     or v_res->>'visualization_id' <> v_viz::text then
    raise exception '2h: running the saved analysis answered %', v_res - 'rows';
  end if;
  if (v_res->>'row_count')::integer <> 1
     or (v_res->'rows'->0->>'m0')::numeric <> 2
     or (v_res->'rows'->0->>'m1')::numeric <> 3000 then
    raise exception '2h: the saved analysis returned % rows reading %',
      v_res->>'row_count', v_res->'rows';
  end if;

  -- The ledger attributes the cost to the tile, not just to the dataset. Without
  -- this column "which dashboard is expensive" has no answer.
  select count(*) into v_n from public.bi_query_log
   where visualization_id = v_viz and outcome = 'OK' and dataset_id = v_ds;
  if v_n <> 1 then
    raise exception '2h: the run left % ledger rows attributed to the analysis', v_n;
  end if;

  perform pg_temp.bi_refuses(
    format('select public.run_bi_visualization_command(%L)',
           (select id from public.bi_visualizations where key = 'bi_suite_viz_sketch')),
    '22023', '2h: a sketch bound to no dataset cannot be run');
  perform pg_temp.bi_refuses(
    'select public.run_bi_visualization_command(gen_random_uuid())',
    '22023', '2h: an analysis that does not exist cannot be run');
  raise notice '2h ok: a saved analysis runs, draws itself, and is billed to itself';
end $step$;
-- ---------------------------------------------------------------------------
-- 2i. Reports, dashboards and tiles -- the part where governed numbers get
--     arranged on a page.
--
--     Publishing a *dashboard* is a different act from publishing a *definition*,
--     and section O gives them to different people on purpose: operations arranges
--     numbers that somebody else has already blessed. So every block from here to
--     the end of 2i runs as ops, and none of it needs admin.
--
--     What publishing checks is that the page resolves. An empty report and an
--     empty dashboard are both refused, and so is a dashboard holding a tile whose
--     dataset is still a draft -- because that tile would render an authorization
--     error for every viewer who is not its author, which is a worse failure than
--     refusing to publish: it is invisible to the person who caused it.
-- ---------------------------------------------------------------------------
do $step$
declare
  v_rep uuid;
  v_res jsonb;
  v_row record;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  insert into public.bi_reports(key, title) values ('bi_suite_report', 'BI suite report')
  returning id into v_rep;

  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''REPORT'', %L, ''PUBLISHED'')', v_rep),
    '22023', '2i: a report with nothing on it cannot be published');

  update public.bi_visualizations set report_id = v_rep where key = 'bi_suite_viz_month';
  v_res := public.set_bi_status_command('REPORT', v_rep, 'PUBLISHED');
  if v_res is distinct from jsonb_build_object('ok', true, 'kind', 'REPORT',
       'id', v_rep::text, 'from', 'DRAFT', 'to', 'PUBLISHED') then
    raise exception '2i: publishing the report answered %', v_res;
  end if;

  select status, version, published_at is not null as stamped into v_row
    from public.bi_reports where id = v_rep;
  if v_row.status <> 'PUBLISHED' or v_row.version <> 1 or not v_row.stamped then
    raise exception '2i: the published report reads % v% (stamped %)',
      v_row.status, v_row.version, v_row.stamped;
  end if;
  raise notice '2i ok: a report publishes once it has something on it';
end $step$;
do $step$
declare
  v_dash uuid;
  v_viz  uuid := (select id from public.bi_visualizations where key = 'bi_suite_viz_month');
  v_row  record;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  insert into public.bi_dashboards(key, title) values ('bi_suite_dash', 'BI suite dashboard')
  returning id into v_dash;

  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DASHBOARD'', %L, ''PUBLISHED'')', v_dash),
    '22023', '2i: a dashboard with no tiles cannot be published');

  -- The grid is twelve columns wide and the arithmetic is a constraint, not a
  -- convention in the front end. A tile that starts at 10 and is 6 wide is off the
  -- page for every viewer, and the only place that can be refused for all writers at
  -- once -- builder, import, a later migration -- is here.
  perform pg_temp.bi_refuses(
    format($q$insert into public.bi_dashboard_tiles(dashboard_id, visualization_id, grid_x, grid_w)
              values (%L, %L, 10, 6)$q$, v_dash, v_viz),
    '23514', '2i: a tile cannot start at column 10 and be six wide');
  perform pg_temp.bi_refuses(
    format($q$insert into public.bi_dashboard_tiles(dashboard_id, visualization_id, grid_h)
              values (%L, %L, 25)$q$, v_dash, v_viz),
    '23514', '2i: a tile cannot be taller than the grid');

  insert into public.bi_dashboard_tiles(dashboard_id, visualization_id, grid_x, grid_y, grid_w, grid_h)
  values (v_dash, v_viz, 0, 0, 6, 4);
  -- The same analysis twice on one page is a mistake every time: two tiles that must
  -- always agree, drawn from two round trips that can disagree.
  perform pg_temp.bi_refuses(
    format($q$insert into public.bi_dashboard_tiles(dashboard_id, visualization_id, grid_x)
              values (%L, %L, 6)$q$, v_dash, v_viz),
    '23505', '2i: the same analysis cannot be placed twice on one dashboard');

  perform public.set_bi_status_command('DASHBOARD', v_dash, 'PUBLISHED');
  select status, published_at is not null as stamped into v_row
    from public.bi_dashboards where id = v_dash;
  if v_row.status <> 'PUBLISHED' or not v_row.stamped then
    raise exception '2i: the published dashboard reads % (stamped %)', v_row.status, v_row.stamped;
  end if;

  -- And now the analysis cannot be deleted out from under it. Not cascaded, not
  -- nulled: refused, with the dashboard still showing the number it showed before.
  perform pg_temp.bi_refuses(
    format('delete from public.bi_visualizations where id = %L', v_viz),
    '23503', '2i: an analysis on a dashboard cannot be deleted');
  raise notice '2i ok: the grid is arithmetic, and a placed analysis is protected';
end $step$;
do $step$
declare
  v_draft uuid := (select id from public.bi_datasets where key = 'bi_suite_draft');
  v_dash2 uuid;
  v_viz2  uuid;
  v_dash  uuid := (select id from public.bi_dashboards where key = 'bi_suite_dash');
  v_out   jsonb;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  -- Saving this is allowed: it compiles, and an analyst building a page out of a
  -- dataset that is still under review is doing ordinary work. It is *publishing the
  -- page* that is refused, which is the moment the promise is made to other readers.
  insert into public.bi_visualizations(key, title, chart_type, dataset_id, measures)
  values ('bi_suite_viz_draft', 'On a draft', 'KPI', v_draft, '["bi_suite_draft_count"]'::jsonb)
  returning id into v_viz2;
  insert into public.bi_dashboards(key, title) values ('bi_suite_dash_draft', 'Draft page')
  returning id into v_dash2;
  insert into public.bi_dashboard_tiles(dashboard_id, visualization_id) values (v_dash2, v_viz2);

  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DASHBOARD'', %L, ''PUBLISHED'')', v_dash2),
    '22023', '2i: a dashboard with a tile on an unpublished dataset cannot be published');

  -- The read model is what the screen actually consumes, so it is asserted rather
  -- than the tables it reads. Note `readable_by_me`, computed per tile: one page may
  -- legitimately mix a chart everyone sees with one only finance may, and the tile
  -- states the refusal instead of the dashboard failing as a whole.
  v_out := public.get_bi_dashboard(v_dash);
  if (v_out->>'tile_count')::integer <> 1
     or v_out->'tiles'->0->'visualization'->>'chart_type' <> 'COLUMN'
     or v_out->'tiles'->0->'visualization'->>'dataset_status' <> 'PUBLISHED'
     or v_out->'tiles'->0->>'readable_by_me' <> 'true'
     or v_out->'tiles'->0->'grid'->>'w' <> '6'
     or v_out->>'can_edit' <> 'true' or v_out->>'can_publish' <> 'true' then
    raise exception '2i: ops reads the dashboard as %', v_out - 'tiles';
  end if;

  -- The same page, read by somebody who may look and not touch. The buttons are the
  -- answer to a question the database was asked, not a guess the front end makes.
  perform pg_temp.bi_become('bi-suite-agent@invalid.test');
  v_out := public.get_bi_dashboard(v_dash);
  if (v_out->>'tile_count')::integer <> 1
     or v_out->>'can_edit' <> 'false' or v_out->>'can_publish' <> 'false' then
    raise exception '2i: an agent reads the dashboard as %', v_out - 'tiles';
  end if;
  raise notice '2i ok: the page resolves before it publishes, and says who may change it';
end $step$;
-- 2j. The overview a reader lands on. Its `capabilities` object is the whole reason
--     the studio can render one screen for every role: each button asks the database
--     what this session may do rather than inferring it from the role name, so a
--     permission change lands on the screen without a front-end release.
--
--     Ops is the interesting case precisely because it is not uniform. It may define
--     a dataset and publish a dashboard, and may not publish the definition that
--     dashboard draws -- which is the governance split section O intends, and a flat
--     "is this user an analyst" flag could not express.
do $step$
declare
  v_out jsonb;
  v_cap jsonb;
  v_top jsonb;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  v_out := public.get_bi_studio_overview();
  v_cap := v_out->'capabilities';
  if v_cap is distinct from jsonb_build_object(
       'can_define', true, 'can_publish_definitions', false,
       'can_save_analysis', true, 'can_build_dashboards', true,
       'can_publish_dashboards', true, 'can_read_query_log', true,
       'can_sync_sources', false) then
    raise exception '2j: ops reads its capabilities as %', v_cap;
  end if;
  if v_out->'usage_7d'->>'visible' <> 'true'
     or (v_out->'usage_7d'->>'denied_7d')::integer < 1
     or (v_out->'usage_7d'->>'errors_7d')::integer < 1 then
    raise exception '2j: ops sees usage as %', v_out->'usage_7d';
  end if;

  -- The usage list has to agree with the counter on the dataset row. Two places
  -- report the same fact, and a suite that checked only one would not notice them
  -- diverging -- which is how a "most queried" panel ends up ranking by a number
  -- nobody else can reproduce.
  select value into v_top from jsonb_array_elements(v_out->'most_queried')
   where value->>'dataset_key' = 'bi_suite_bookings';
  if v_top is null or (v_top->>'query_count')::integer <> 11
     or v_top->>'status' <> 'PUBLISHED' or v_top->>'last_queried_at' is null then
    raise exception '2j: the usage list reports bi_suite_bookings as %', v_top;
  end if;

  perform pg_temp.bi_become('bi-suite-agent@invalid.test');
  v_cap := public.get_bi_studio_overview()->'capabilities';
  if v_cap <> jsonb_build_object(
       'can_define', false, 'can_publish_definitions', false,
       'can_save_analysis', false, 'can_build_dashboards', false,
       'can_publish_dashboards', false, 'can_read_query_log', false,
       'can_sync_sources', false) then
    raise exception '2j: an agent reads its capabilities as %', v_cap;
  end if;
  -- Timings and denials are an audit surface. A role that may read a chart is not
  -- thereby entitled to see who else was refused one, so the panel is absent rather
  -- than empty: `{"visible": false}` is a different statement from a zero count.
  if public.get_bi_studio_overview()->'usage_7d' <> jsonb_build_object('visible', false) then
    raise exception '2j: an agent can see the query ledger summary';
  end if;
  raise notice '2j ok: the screen asks the database what this session may do';
end $step$;
-- 2k. Drill-down and drill-through, which are two different promises and are worth
--     separating. Drill-down is a walk inside the semantic layer -- month to day --
--     and needs no query at all. Drill-through leaves it: it turns one cell back into
--     the rows underneath, which is where a reader stops trusting a chart or starts.
do $step$
declare
  v_ds   uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
  v_out  jsonb;
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  v_out := public.get_bi_drill_path(v_ds, 'bi_suite_month');
  if (v_out->>'depth')::integer <> 2 or v_out->>'root' <> 'bi_suite_month' then
    raise exception '2k: the drill path from month is %', v_out;
  end if;
  if v_out->'path'->0->>'key' <> 'bi_suite_month'
     or v_out->'path'->0->>'has_drill_through' <> 'true'
     or v_out->'path'->0->>'drill_through_kind' <> 'BOOKING'
     or (v_out->'path'->0->>'depth')::integer <> 0
     or v_out->'path'->1->>'key' <> 'bi_suite_day'
     or v_out->'path'->1->>'data_type' <> 'date'
     or v_out->'path'->1->>'has_drill_through' <> 'false'
     or (v_out->'path'->1->>'depth')::integer <> 1 then
    raise exception '2k: the steps of the drill path are %', v_out->'path';
  end if;

  -- Day is the leaf. Asking for the path below it is an ordinary question with an
  -- empty answer, not an error: the screen renders no further breadcrumb.
  v_out := public.get_bi_drill_path(v_ds, 'bi_suite_day');
  if (v_out->>'depth')::integer <> 1 or v_out->'path'->0->>'key' <> 'bi_suite_day' then
    raise exception '2k: the drill path from day is %', v_out;
  end if;
  -- A key that was never defined resolves to nothing rather than to a guess.
  v_out := public.get_bi_drill_path(v_ds, 'bi_suite_nope');
  if (v_out->>'depth')::integer <> 0 or v_out->'path' <> '[]'::jsonb then
    raise exception '2k: an unknown dimension produced the path %', v_out;
  end if;

  -- Scope is checked before the walk, and reported as 42501 rather than as an empty
  -- path, because "there is nothing here" and "this is not yours to see" are answers
  -- a caller has to be able to tell apart.
  perform pg_temp.bi_refuses(
    'select public.get_bi_drill_path(gen_random_uuid(), ''bi_suite_month'')',
    '42501', '2k: a drill path outside scope is refused, not emptied');
end $step$;
do $step$
declare
  v_ds    uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
  v_out   jsonb;
  v_want  text[];
  v_got   text[];
begin
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  select array_agg(id::text order by reference) into v_want
    from public.bookings where reference in ('BI-SUITE-001', 'BI-SUITE-002');

  v_out := public.run_bi_drill_through_command(v_ds, 'bi_suite_month',
                                              to_jsonb('2026-04'::text));
  if v_out->>'ok' <> 'true' or v_out->>'kind' <> 'BOOKING'
     or (v_out->>'entity_count')::integer <> 2 or v_out->>'truncated' <> 'false' then
    raise exception '2k: drilling through April returned %', v_out;
  end if;
  select array_agg(value #>> '{}' order by value #>> '{}') into v_got
    from jsonb_array_elements(v_out->'entity_ids');
  -- The decoy is the assertion. BI-DECOY-001 is in the same month, in the same agency,
  -- and is excluded by the dataset's row filter -- so if the drill-through built its
  -- own where clause instead of reusing the dataset's, the reader would click a cell
  -- summing 3000 and be handed a row worth 999999. The filter has to travel.
  if v_got is distinct from (select array_agg(x order by x) from unnest(v_want) x) then
    raise exception '2k: the rows behind the cell are % but the fixtures are %', v_got, v_want;
  end if;

  -- The dimension exists and is a leaf: there is nothing to expand into. Refusals
  -- here come back on the payload, because bi_drill_through logs and returns rather
  -- than raising -- a failed drill is a ledger row like any other query.
  perform pg_temp.bi_payload_fails(
    public.run_bi_drill_through_command(v_ds, 'bi_suite_day', to_jsonb('2026-04-11'::text)),
    '22023', '2k: a dimension with no drill-through target cannot be expanded');
  perform pg_temp.bi_payload_fails(
    public.run_bi_drill_through_command(v_ds, 'bi_suite_nope', to_jsonb('x'::text)),
    '22023', '2k: an undefined dimension cannot be expanded');
  raise notice '2k ok: the cell expands into its own rows, and the row filter travels';
end $step$;
-- 2l. Deprecation last, because it is the step that proves the dependency graph is
--     read in the right direction. Retiring a definition is the ordinary end of its
--     life -- not deletion, which would destroy the record of what a published number
--     meant -- and the rules exist so that it cannot be retired out from under a page
--     somebody is still reading.
do $step$
declare
  v_ds   uuid := (select id from public.bi_datasets  where key = 'bi_suite_bookings');
  v_amt  uuid := (select id from public.bi_metrics   where key = 'bi_suite_amount');
  v_dash uuid := (select id from public.bi_dashboards where key = 'bi_suite_dash');
  v_row  record;
begin
  -- Definitions are ADMIN-only to retire, for the same reason they are ADMIN-only to
  -- publish: whoever settles what a word means is whoever may stop it meaning that.
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DATASET'', %L, ''DEPRECATED'')', v_ds),
    '42501', '2l: ops cannot retire a dataset it was never allowed to publish');

  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''DATASET'', %L, ''DEPRECATED'')', v_ds),
    '22023', '2l: a dataset on a published dashboard cannot be retired');
  -- Same refusal, one level finer: the metric is named in that dashboard's tile.
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''METRIC'', %L, ''DEPRECATED'')', v_amt),
    '22023', '2l: a metric shown on a published dashboard cannot be retired');

  -- Retiring the page is the act that releases everything under it, and it is the
  -- one a dashboard owner can perform alone.
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  perform public.set_bi_status_command('DASHBOARD', v_dash, 'DEPRECATED', 'quarter closed');
  select status, published_at, deprecated_at, version into v_row
    from public.bi_dashboards where id = v_dash;
  if v_row.status <> 'DEPRECATED' or v_row.published_at is not null
     or v_row.deprecated_at is null or v_row.version <> 1 then
    raise exception '2l: the retired dashboard reads as %', v_row;
  end if;
  -- The tile is still there. Retiring a page does not dismantle it, so republishing
  -- next quarter is one status change rather than a rebuild from memory.
  if (select count(*) from public.bi_dashboard_tiles where dashboard_id = v_dash) <> 1 then
    raise exception '2l: retiring the dashboard removed its tile';
  end if;
end $step$;
do $step$
declare
  v_ds   uuid := (select id from public.bi_datasets where key = 'bi_suite_bookings');
  v_amt  uuid := (select id from public.bi_metrics  where key = 'bi_suite_amount');
  v_avg  uuid := (select id from public.bi_metrics  where key = 'bi_suite_avg_value');
  v_row  record;
  v_ev   jsonb;
begin
  perform pg_temp.bi_become('bi-suite-admin@invalid.test');
  -- The page is gone and the metric is still held: it is an operand of a live ratio,
  -- which would otherwise keep compiling against a definition that has been retired
  -- and produce a number whose provenance is a contradiction.
  perform pg_temp.bi_refuses(
    format('select public.set_bi_status_command(''METRIC'', %L, ''DEPRECATED'')', v_amt),
    '22023', '2l: a metric feeding a live ratio cannot be retired before the ratio');

  perform public.set_bi_status_command('METRIC', v_avg, 'DEPRECATED');
  perform public.set_bi_status_command('METRIC', v_amt, 'DEPRECATED', 'superseded');
  select status, published_at, deprecated_at into v_row
    from public.bi_metrics where id = v_amt;
  if v_row.status <> 'DEPRECATED' or v_row.published_at is not null
     or v_row.deprecated_at is null then
    raise exception '2l: the retired metric reads as %', v_row;
  end if;

  -- And now the dataset, which takes its metrics with it: a metric compiles against
  -- one dataset's source and nothing else can run it, so leaving them published would
  -- leave rows claiming to be usable that no caller can reach.
  perform public.set_bi_status_command('DATASET', v_ds, 'DEPRECATED', 'source retired');
  select status, published_at, deprecated_at into v_row
    from public.bi_datasets where id = v_ds;
  if v_row.status <> 'DEPRECATED' or v_row.published_at is not null
     or v_row.deprecated_at is null then
    raise exception '2l: the retired dataset reads as %', v_row;
  end if;
  if (select count(*) from public.bi_metrics
       where dataset_id = v_ds and status <> 'DEPRECATED') <> 0 then
    raise exception '2l: a metric outlived the dataset it is compiled against';
  end if;
  select payload into v_ev from public.bi_events
   where entity_kind = 'DATASET' and entity_id = v_ds and event_type = 'STATUS_DEPRECATED';
  if v_ev->>'from' <> 'PUBLISHED' or v_ev->>'note' <> 'source retired'
     or (v_ev->>'metrics_deprecated')::integer <> 3 then
    raise exception '2l: the deprecation event reads as %', v_ev;
  end if;

  -- The last consequences, and the ones a reader meets. Two different refusals,
  -- reached in the order the code checks things: bi_run_query compiles before it
  -- looks at the dataset's status, so a retired *metric* answers first and says so.
  perform pg_temp.bi_become('bi-suite-ops@invalid.test');
  perform pg_temp.bi_payload_fails(
    public.run_bi_query_command(v_ds, array['bi_suite_month'], array['bi_suite_count']),
    '22023', '2l: a retired metric cannot be put into a new analysis');
  -- Drilling through names no metric, so it reaches the dataset gate: the retired
  -- dataset stops answering. Not by returning an empty result, which reads as "no
  -- bookings in April" and is a lie, but by refusing.
  perform pg_temp.bi_payload_fails(
    public.run_bi_drill_through_command(v_ds, 'bi_suite_month', to_jsonb('2026-04'::text)),
    '42501', '2l: a retired dataset no longer answers ordinary readers');
  raise notice '2l ok: nothing is retired out from under a page that is still read';
end $step$;
rollback;

-- ---------------------------------------------------------------------------
-- Part 3. The residue check, which is the only reason Part 2 was allowed to write
-- at all. Everything above ran inside one transaction and the rollback undid it;
-- this asks the database to agree rather than assuming it.
--
-- There is no clause for bi_dashboard_tiles, and that is an argument rather than an
-- omission: both of its foreign keys are NOT NULL, so a surviving tile would need a
-- surviving dashboard and a surviving analysis, and those are named directly below.
--
-- The ledger halves are checked by content, not by id. bi_query_log rows point at a
-- dataset that would itself be gone, and bi_events stores entity_id as a bare uuid
-- with no foreign key at all -- so the honest question is whether any row still
-- carries text this suite wrote, which is what `BI-SUITE-` and the notes are.
--
-- The trailing column reports the role the session holds now. set_config with
-- is_local = true is transaction-local, so this must read as the runner's own role:
-- a suite that leaked a simulated identity into the connection would leave every
-- later gate in the chain quietly asking its questions as somebody else.
-- ---------------------------------------------------------------------------
select 'bi_suite_left_no_residue' as check_name,
       not exists (select 1 from public.bi_datasets
                    where key like 'bi_suite%' or key like 'bi_probe%')
   and not exists (select 1 from public.bi_dimensions
                    where key like 'bi_suite%' or key like 'bi_probe%')
   and not exists (select 1 from public.bi_metrics
                    where key like 'bi_suite%' or key like 'bi_probe%')
   and not exists (select 1 from public.bi_visualizations where key like 'bi_suite%')
   and not exists (select 1 from public.bi_reports where key like 'bi_suite%')
   and not exists (select 1 from public.bi_dashboards where key like 'bi_suite%')
   and not exists (select 1 from public.bi_query_log where compiled_sql like '%BI-SUITE-%')
   and not exists (select 1 from public.bi_events
                    where payload->>'note' in ('source retired', 'quarter closed',
                                               'restating the amount', 'putting it back'))
   and not exists (select 1 from auth.users where email like 'bi-suite-%@invalid.test')
   and not exists (select 1 from public.bookings
                    where reference like 'BI-SUITE-%' or reference like 'BI-DECOY-%')
   and not exists (select 1 from public.pilgrims where full_name = 'BI Suite Pilgrim') as pass,
       coalesce(public.staff_role(), 'no staff profile') as session_role_after_rollback;
