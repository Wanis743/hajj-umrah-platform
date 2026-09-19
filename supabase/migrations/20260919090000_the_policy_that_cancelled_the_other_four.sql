-- The policy that cancelled the other four.
--
-- PERMISSIVE policies for the same command are OR'd together. A table with four
-- carefully scoped policies and one PERMISSIVE ALL policy reading `is_staff()`
-- does not have five layers of protection; it has one, and it is the loosest.
-- The scoped four are unreachable -- not overridden in some subtle ordering
-- sense, simply never decisive, because the broad disjunct is already true for
-- anyone who got as far as the table.
--
-- Twenty-one tables were in that state. Twenty carried `staff_scoped_all`
-- (PERMISSIVE, ALL, USING is_staff()) and `packages` carried the same policy
-- under the name `packages_staff_access` with the call written as
-- `private.is_staff()`. That spelling matters: the first census run for this
-- migration used a pattern anchored on a bare `is_staff()` and reported 16
-- tables, silently dropping the five whose predicate is schema-qualified or
-- whose scoped policies carry no agency term. The number in this file is 21
-- because the pattern was widened, not because the database changed.
--
-- What each table keeps: exactly four PERMISSIVE policies, one per command,
-- verified before the drop rather than assumed --
--   staff_select[SELECT] staff_insert[INSERT] staff_update[UPDATE] staff_delete[DELETE]
-- so no command loses coverage. All four are `authenticated`-only and none is
-- RESTRICTIVE, so nothing here interacts with a RESTRICTIVE AND-chain.
--
-- The scoped predicates come in three shapes, and the difference decides what
-- this migration actually changes today:
--
--   strict agency equality, no ADMIN bypass -- chart_of_accounts, fiscal_periods,
--     readiness_rules (all three are branch-less):
--     has_permission(t,'read') AND agency_id = current_staff_agency_id()
--     These are the tables where the leak was observable. Measured live before
--     this file: the sole staff user's agency holds 8 of 15 chart_of_accounts
--     rows, and a real staff session with current_user asserted to be
--     `authenticated` read all 15, across 2 agencies. That is the broad policy
--     answering, and it is what stops here.
--
--   row_in_staff_scope(agency_id, branch_id) -- 13 tables including the ledger:
--     staff_role() = 'ADMIN' OR (agency = staff_agency_id() AND branch = staff_branch_id())
--     The leading disjunct is an ADMIN bypass, and this database's only active
--     staff profile is an ADMIN, so the drop is behaviour-neutral on these 13
--     today. It is not cosmetic: it is what makes the predicate bind the moment
--     a non-ADMIN exists.
--
--   has_permission(t, action) alone -- airlines, airports, countries,
--     exchange_rates, payment_methods: global reference data, no tenant column,
--     correctly so. has_permission() is `staff_role()='ADMIN' OR <a
--     staff_permissions row>`, so this too is a no-op for an ADMIN and becomes
--     the role limit it was written to be for anyone else.
--
-- A consequence worth stating rather than discovering later. staff_permissions is
-- deliberately sparse -- across these 21 resources, FINANCE holds read on 14,
-- OPERATIONS_MANAGER on 11, AGENT on 8, VISA_AGENT on 6, CRM on 4, GUIDE on 2.
-- Until now `staff_scoped_all` made all of that inert. After this file those
-- numbers are the access. That is the intended effect of having a permission
-- table at all, but it means the first non-ADMIN staff member created will see a
-- much narrower system than the current ADMIN does, and the fix for any gap is a
-- staff_permissions row, not a broader policy.
--
-- Why `packages` is dropped but not censused.
-- The first attempt at this file died with `42501 permission denied for table
-- packages` inside its own census loop, as `authenticated`. Not an RLS result --
-- a grant one. public.packages has relacl {postgres, service_role} and nothing
-- else, so `authenticated` cannot read it at all and all five of its policies,
-- broad and scoped alike, are dead letters from the client's side. The drop is
-- still right (the four scoped policies become the operative set the moment a
-- grant is added) but the table cannot appear in a census taken as
-- `authenticated`, so it is marked non-censusable below and gate G asserts that
-- reason rather than trusting this paragraph: if authenticated ever does hold
-- SELECT on packages, gate G fails and the exclusion has to be revisited.
--
-- That grant gap has a visible consequence this file does NOT fix, because it is
-- a client change and not a policy one: GroupManager.tsx:54 and
-- PilgrimManager.tsx:98 both call supabase.from('packages').select(...) and both
-- destructure only { data }, so the 42501 is swallowed and the package pickers
-- render empty rather than erroring. The two callers that work
-- (usePublicPackages.ts:77, NewReservationModal.tsx:37) go through the
-- get_public_packages RPC instead.
--
-- Two more things deliberately NOT done here.
--
-- 1. Five tables carry a broad `is_staff()` policy as their ONLY policy --
--    bank_reconciliations, bank_statement_lines, hajj_timeline_events,
--    notification_preferences, and support_tickets (whose policy is named
--    staff_support_tickets). Dropping there would not scope them, it would lock
--    them out completely: RLS with zero policies denies everything. Two of the
--    five are finance tables and carry the same cross-tenant exposure this file
--    closes elsewhere, so they need four scoped policies each written first.
--    Gate F below asserts this migration left all five alone, so that a later
--    reader can tell omission from oversight.
--
-- 2. row_in_staff_scope's branch term is left as it is. The only staff profile
--    has branch_id NULL, and `branch_id = staff_branch_id()` with a NULL right
--    side is NULL, i.e. false, for every row. So a non-ADMIN created with a NULL
--    branch would read zero rows from all 13 of those tables -- 52 journal
--    entries and 114 journal lines among them. That is a real trap and it is
--    pre-existing; the broad policy has been masking it. Changing the helper
--    changes ~41 tables at once and is its own decision, not a rider on this one.

-- ---------------------------------------------------------------------------
-- 1. The set, and the census before. The census is read as the real staff
--    identity, because reading it as postgres would measure the table rather
--    than the policy.
-- ---------------------------------------------------------------------------
-- Both temp tables are created, read, and written only while the role is
-- unswitched. A DO block that touches its own scratch table while in role
-- authenticated is denied on the scratch table -- the probe's own bookkeeping
-- becomes the thing that fails, and that is true of the SELECT driving the loop
-- just as much as of the INSERT at the end (the second attempt at this file died
-- on exactly that, `42501 permission denied for table _drop_set`). So: read the
-- worklist into an array first, switch, count into arrays, switch back, land.
CREATE TEMP TABLE _scope_probe (phase text, tbl text, n int) ON COMMIT DROP;
CREATE TEMP TABLE _drop_set (tbl text, censusable boolean) ON COMMIT DROP;

-- censusable = false means only "cannot be counted as authenticated", never
-- "not dropped". Every row here is dropped in section 2.
INSERT INTO _drop_set (tbl, censusable) VALUES
  ('airlines', true), ('airports', true), ('bank_accounts', true),
  ('chart_of_accounts', true), ('countries', true), ('credit_notes', true),
  ('data_quality_issues', true), ('document_access_logs', true),
  ('exchange_rates', true), ('fiscal_periods', true), ('journal_entries', true),
  ('journal_lines', true), ('manifest_snapshots', true),
  ('missing_pilgrim_events', true), ('notification_queue', true),
  ('packages', false),
  ('payment_allocations', true), ('payment_methods', true),
  ('readiness_rules', true), ('supplier_bills', true), ('workflow_jobs', true);

DO $pre$
DECLARE
  v_orig_role text := current_user;
  v_user uuid; v_agency uuid;
  v_todo text[];
  v_names text[] := '{}'; v_counts int[] := '{}';
  v_t text; v_n int; v_i int;
BEGIN
  SELECT sp.user_id, sp.agency_id INTO v_user, v_agency
    FROM public.staff_profiles sp
   WHERE sp.is_active AND sp.user_id IS NOT NULL LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'census: no active staff profile -- every count below would be vacuous';
  END IF;

  -- The worklist is read here, as the migration role. Reading it after the
  -- switch would need a grant on a temp table that authenticated has no reason
  -- to hold.
  SELECT array_agg(tbl ORDER BY tbl) INTO v_todo FROM _drop_set WHERE censusable;

  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'census: role switch failed (current_user=%) -- the census would be theatre',
                    current_user;
  END IF;

  FOREACH v_t IN ARRAY v_todo LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
    v_names := v_names || v_t; v_counts := v_counts || v_n;
  END LOOP;

  -- Restore the role BEFORE writing anything, and restore it to the role this
  -- block found. Not to 'none': SET ROLE NONE means session_user, and db push's
  -- session_user is a bare NOINHERIT login role that holds nothing.
  PERFORM set_config('role', v_orig_role, true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF current_user <> v_orig_role THEN
    RAISE EXCEPTION 'census: could not restore role % (current_user=%)', v_orig_role, current_user;
  END IF;

  FOR v_i IN 1 .. array_length(v_names, 1) LOOP
    INSERT INTO _scope_probe VALUES ('before', v_names[v_i], v_counts[v_i]);
  END LOOP;
END;
$pre$;

-- ---------------------------------------------------------------------------
-- 2. Drop the broad policy. Written out per table rather than generated from
--    _drop_set in a loop, so the set is reviewable in the diff and cannot
--    quietly widen. Gate A cross-checks the two lists against each other.
-- ---------------------------------------------------------------------------
DROP POLICY staff_scoped_all ON public.airlines;
DROP POLICY staff_scoped_all ON public.airports;
DROP POLICY staff_scoped_all ON public.bank_accounts;
DROP POLICY staff_scoped_all ON public.chart_of_accounts;
DROP POLICY staff_scoped_all ON public.countries;
DROP POLICY staff_scoped_all ON public.credit_notes;
DROP POLICY staff_scoped_all ON public.data_quality_issues;
DROP POLICY staff_scoped_all ON public.document_access_logs;
DROP POLICY staff_scoped_all ON public.exchange_rates;
DROP POLICY staff_scoped_all ON public.fiscal_periods;
DROP POLICY staff_scoped_all ON public.journal_entries;
DROP POLICY staff_scoped_all ON public.journal_lines;
DROP POLICY staff_scoped_all ON public.manifest_snapshots;
DROP POLICY staff_scoped_all ON public.missing_pilgrim_events;
DROP POLICY staff_scoped_all ON public.notification_queue;
DROP POLICY packages_staff_access ON public.packages;
DROP POLICY staff_scoped_all ON public.payment_allocations;
DROP POLICY staff_scoped_all ON public.payment_methods;
DROP POLICY staff_scoped_all ON public.readiness_rules;
DROP POLICY staff_scoped_all ON public.supplier_bills;
DROP POLICY staff_scoped_all ON public.workflow_jobs;

-- ---------------------------------------------------------------------------
-- 3. Census, after -- and the gates. db push wraps this file in one
--    transaction, so any raise below rolls the drops back with it. psql is
--    unavailable here, which makes that wrapper the verification.
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_orig_role text := current_user;
  v_user uuid; v_agency uuid;
  v_todo text[];
  v_names text[] := '{}'; v_counts int[] := '{}';
  r record; v_t text; v_n int; v_i int;
  v_before int; v_after int; v_own int;
  v_decreased int := 0; v_msg text;
BEGIN
  SELECT sp.user_id, sp.agency_id INTO v_user, v_agency
    FROM public.staff_profiles sp
   WHERE sp.is_active AND sp.user_id IS NOT NULL LIMIT 1;

  -- Same worklist, same reason: read it before the switch, not after.
  SELECT array_agg(tbl ORDER BY tbl) INTO v_todo
    FROM _scope_probe WHERE phase = 'before';

  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'gate: role switch failed (current_user=%)', current_user;
  END IF;

  FOREACH v_t IN ARRAY v_todo LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
    v_names := v_names || v_t; v_counts := v_counts || v_n;
  END LOOP;

  PERFORM set_config('role', v_orig_role, true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF current_user <> v_orig_role THEN
    RAISE EXCEPTION 'gate: could not restore role % (current_user=%)', v_orig_role, current_user;
  END IF;

  FOR v_i IN 1 .. array_length(v_names, 1) LOOP
    INSERT INTO _scope_probe VALUES ('after', v_names[v_i], v_counts[v_i]);
  END LOOP;

  -- A. The drop set is 21, the census is the 20 of them a client can read, and
  --    no broad is_staff() ALL policy survives on any of the 21 -- including the
  --    one table the census could not reach.
  SELECT count(*) INTO v_n FROM _drop_set;
  IF v_n <> 21 THEN
    RAISE EXCEPTION 'gate A: drop set holds % tables, expected 21', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM _scope_probe WHERE phase = 'before';
  IF v_n <> 20 THEN
    RAISE EXCEPTION 'gate A: censused % tables, expected 20 (21 less packages)', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN (SELECT tbl FROM _drop_set)
     AND p.permissive = 'PERMISSIVE' AND p.cmd = 'ALL'
     AND btrim(coalesce(p.qual, '')) ~ '^\(?(public\.|private\.)?is_staff\(\)\)?$';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'gate A: % broad is_staff() ALL policies still stand on the 21 tables', v_n;
  END IF;

  -- B. Each of the 21 kept exactly one policy per command. A table that lost its
  --    SELECT policy here would read as "0 rows", which gate C would happily
  --    call an improvement.
  FOR r IN SELECT tbl FROM _drop_set ORDER BY tbl LOOP
    SELECT count(DISTINCT p.cmd) INTO v_n FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = r.tbl
       AND p.cmd IN ('SELECT','INSERT','UPDATE','DELETE');
    IF v_n <> 4 THEN
      RAISE EXCEPTION 'gate B: % now covers only % of the 4 commands', r.tbl, v_n;
    END IF;
  END LOOP;

  -- C. No table may have become MORE visible, and at least one must have become
  --    less. Without the second half this gate would pass unchanged on a file
  --    that dropped nothing at all.
  FOR r IN SELECT tbl FROM _scope_probe WHERE phase = 'before' ORDER BY tbl LOOP
    SELECT n INTO v_before FROM _scope_probe WHERE phase = 'before' AND tbl = r.tbl;
    SELECT n INTO v_after  FROM _scope_probe WHERE phase = 'after'  AND tbl = r.tbl;
    IF v_after > v_before THEN
      RAISE EXCEPTION 'gate C: % went from % rows to % -- dropping a policy widened access',
                      r.tbl, v_before, v_after;
    END IF;
    IF v_after < v_before THEN
      v_decreased := v_decreased + 1;
    END IF;
  END LOOP;
  IF v_decreased = 0 THEN
    RAISE EXCEPTION 'gate C: no table narrowed -- the cross-agency rows this file exists '
                    'to hide were never visible, so either the census is wrong or the '
                    'drops did nothing';
  END IF;

  -- D. The three strict-agency tables must now show exactly their own agency,
  --    counted here without RLS. This is the assertion that says "scoped", not
  --    merely "smaller".
  FOR r IN SELECT unnest(ARRAY['chart_of_accounts','fiscal_periods','readiness_rules']) AS tbl LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE agency_id = %L', r.tbl, v_agency)
      INTO v_own;
    SELECT n INTO v_after FROM _scope_probe WHERE phase = 'after' AND tbl = r.tbl;
    IF v_after <> v_own THEN
      RAISE EXCEPTION 'gate D: % shows % rows to a staff session but holds % in that agency',
                      r.tbl, v_after, v_own;
    END IF;
  END LOOP;

  -- E. Nothing the current staff user legitimately owns became unreachable.
  --    Only meaningful where the table's predicate has no ADMIN bypass, which is
  --    the same three tables -- elsewhere the bypass makes this vacuous, so it is
  --    not asserted there and this comment says so rather than implying coverage.
  FOR r IN SELECT unnest(ARRAY['chart_of_accounts','fiscal_periods','readiness_rules']) AS tbl LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE agency_id = %L', r.tbl, v_agency)
      INTO v_own;
    SELECT n INTO v_after FROM _scope_probe WHERE phase = 'after' AND tbl = r.tbl;
    IF v_own > 0 AND v_after = 0 THEN
      RAISE EXCEPTION 'gate E: % locked the staff user out of its own % rows', r.tbl, v_own;
    END IF;
  END LOOP;

  -- F. The five single-policy tables were left alone, on purpose. If a later
  --    migration drops their only policy this gate is where the intent is
  --    recorded.
  SELECT count(*) INTO v_n
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('bank_reconciliations','bank_statement_lines',
                         'hajj_timeline_events','notification_preferences','support_tickets')
     AND p.permissive = 'PERMISSIVE' AND p.cmd = 'ALL'
     AND btrim(coalesce(p.qual, '')) ~ '^\(?(public\.|private\.)?is_staff\(\)\)?$';
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'gate F: expected the 5 single-policy tables untouched, found % broad policies',
                    v_n;
  END IF;

  -- G. The census exclusion must be the grant, and only the grant. A table is
  --    non-censusable here exactly when authenticated cannot SELECT it; if that
  --    ever stops being true the table belongs back in the census and gate D's
  --    reasoning has to be redone for it.
  FOR r IN SELECT tbl, censusable FROM _drop_set ORDER BY tbl LOOP
    IF has_table_privilege('authenticated', 'public.' || r.tbl, 'SELECT') <> r.censusable THEN
      RAISE EXCEPTION 'gate G: % is marked censusable=% but authenticated SELECT is % -- '
                      'the census set and the grants disagree',
                      r.tbl, r.censusable,
                      has_table_privilege('authenticated', 'public.' || r.tbl, 'SELECT');
    END IF;
  END LOOP;

  SELECT string_agg(b.tbl || ' ' || b.n || '->' || a.n, ', ' ORDER BY b.tbl) INTO v_msg
    FROM _scope_probe b JOIN _scope_probe a ON a.tbl = b.tbl AND a.phase = 'after'
   WHERE b.phase = 'before' AND a.n <> b.n;
  RAISE NOTICE 'gates A-G passed. 21 broad policies dropped, 20 censused, % narrowed: %',
               v_decreased, coalesce(v_msg, '(none)');
END;
$post$;
