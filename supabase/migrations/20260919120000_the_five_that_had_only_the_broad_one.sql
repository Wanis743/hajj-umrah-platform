-- The five that had only the broad one.
--
-- 20260919090000 dropped a PERMISSIVE ALL `is_staff()` policy from 21 tables,
-- each of which kept four scoped policies underneath. Five more tables carried
-- the same broad policy with nothing underneath it, so the same drop there would
-- not have scoped them -- it would have locked them out, because RLS with zero
-- policies denies everything. They were left standing and recorded in that
-- file's gate F. This writes the four policies each of them needed, and then
-- takes the broad one away.
--
--   bank_reconciliations   agency_id + branch_id  -> the standard staff shape
--   bank_statement_lines   agency_id + branch_id  -> the standard staff shape
--   hajj_timeline_events   agency_id + branch_id  -> the standard staff shape
--   notification_preferences  user_id, no tenant  -> the row's own user
--   support_tickets        pilgrim_id only        -> the pilgrim's tenant
--
-- The standard shape is copied from bank_accounts rather than invented, down to
-- the schema qualification and the action names, so these tables answer to the
-- same vocabulary as the other twenty:
--   SELECT  USING      private.has_permission(t,'read')   AND private.row_in_staff_scope(agency_id, branch_id)
--   INSERT  WITH CHECK private.has_permission(t,'create') AND ...
--   UPDATE  USING and WITH CHECK, both private.has_permission(t,'update') AND ...
--   DELETE  USING      private.has_permission(t,'delete') AND ...
--
-- notification_preferences is not staff data. It has a user_id and no tenant
-- column, and the thing it protects is one person's own settings, so the
-- predicate is `user_id = auth.uid()` and the policies are named own_* rather
-- than staff_* to stop a later reader assuming the staff shape by name. Note
-- what that changes: today any staff member can read every user's preferences,
-- because is_staff() is the whole test. After this, nobody can read anyone
-- else's -- including an ADMIN, deliberately, since there is no ADMIN bypass in
-- `user_id = auth.uid()` and there should not be one for this table.
--
-- support_tickets has neither a tenant column nor a user column, only
-- pilgrim_id, so its scope has to be read through public.pilgrims -- and
-- `authenticated` holds no SELECT on pilgrims. A policy expression runs with the
-- querying role's privileges, so referencing pilgrims inline would raise 42501
-- for every caller: the policy would not be strict, it would be broken. Section
-- 1 adds a SECURITY DEFINER helper instead, matching how every other predicate
-- in this schema reaches data the client cannot see.
--
-- Measured before writing this, because a policy on a table the client cannot
-- reach is decoration: all five grant `authenticated` SELECT (unlike packages,
-- which is why it fell out of 20260919090000's census). One asymmetry --
-- support_tickets grants SELECT but NOT INSERT, so its staff_insert policy below
-- is unreachable from the client until that grant exists. It is written anyway
-- rather than skipped: the alternative is a table whose INSERT is governed by
-- nothing the day someone adds the grant. public.pilgrims grants authenticated
-- neither, which is the whole reason section 1 exists.
--
-- What this costs, stated plainly. private.has_permission is
-- `staff_role()='ADMIN' OR <a staff_permissions row>`, and staff_permissions has
-- NO rows for any of these four resource names (it does have bank_accounts and
-- pilgrims). So until rows are added, only an ADMIN reaches these four tables,
-- where today any staff member does. That is a real narrowing and it is the
-- point, but it would be a regression if anything depended on it. Nothing does:
-- all five tables are empty, and none of the five names appears anywhere under
-- src/. The fix when the feature is built is a staff_permissions row, not a
-- broader policy.

-- ---------------------------------------------------------------------------
-- 1. The helper support_tickets needs.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because authenticated cannot read public.pilgrims. STABLE
-- because it is called once per row and its answer cannot change inside a
-- statement. search_path pinned for the same reason every definer here is.
--
-- A NULL pilgrim_id yields false, not NULL and not true: a ticket attached to no
-- pilgrim belongs to no tenant, and no tenant should see it. That makes such a
-- row unreachable rather than universally visible, which is the safe direction,
-- but it does mean an orphaned ticket would be invisible to everyone except
-- service_role -- worth knowing before anything starts writing tickets.
CREATE OR REPLACE FUNCTION private.pilgrim_in_staff_scope(p_pilgrim_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.pilgrims p
     WHERE p.id = p_pilgrim_id
       AND private.row_in_staff_scope(p.agency_id, p.branch_id)
  );
$function$;

-- Without this grant the policies below would raise 42501 for every caller. A
-- policy runs with the querying role's privileges, so a helper the client cannot
-- execute does not fail closed, it fails loudly -- and a migration testing it as
-- postgres would never notice. Gate C asserts the grant landed.
REVOKE ALL ON FUNCTION private.pilgrim_in_staff_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.pilgrim_in_staff_scope(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The three tenant-scoped tables.
-- ---------------------------------------------------------------------------
CREATE POLICY staff_select ON public.bank_reconciliations FOR SELECT TO authenticated
  USING (private.has_permission('bank_reconciliations', 'read')
         AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_insert ON public.bank_reconciliations FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('bank_reconciliations', 'create')
              AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_update ON public.bank_reconciliations FOR UPDATE TO authenticated
  USING (private.has_permission('bank_reconciliations', 'update')
         AND private.row_in_staff_scope(agency_id, branch_id))
  WITH CHECK (private.has_permission('bank_reconciliations', 'update')
              AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_delete ON public.bank_reconciliations FOR DELETE TO authenticated
  USING (private.has_permission('bank_reconciliations', 'delete')
         AND private.row_in_staff_scope(agency_id, branch_id));

CREATE POLICY staff_select ON public.bank_statement_lines FOR SELECT TO authenticated
  USING (private.has_permission('bank_statement_lines', 'read')
         AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_insert ON public.bank_statement_lines FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('bank_statement_lines', 'create')
              AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_update ON public.bank_statement_lines FOR UPDATE TO authenticated
  USING (private.has_permission('bank_statement_lines', 'update')
         AND private.row_in_staff_scope(agency_id, branch_id))
  WITH CHECK (private.has_permission('bank_statement_lines', 'update')
              AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_delete ON public.bank_statement_lines FOR DELETE TO authenticated
  USING (private.has_permission('bank_statement_lines', 'delete')
         AND private.row_in_staff_scope(agency_id, branch_id));

CREATE POLICY staff_select ON public.hajj_timeline_events FOR SELECT TO authenticated
  USING (private.has_permission('hajj_timeline_events', 'read')
         AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_insert ON public.hajj_timeline_events FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('hajj_timeline_events', 'create')
              AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_update ON public.hajj_timeline_events FOR UPDATE TO authenticated
  USING (private.has_permission('hajj_timeline_events', 'update')
         AND private.row_in_staff_scope(agency_id, branch_id))
  WITH CHECK (private.has_permission('hajj_timeline_events', 'update')
              AND private.row_in_staff_scope(agency_id, branch_id));
CREATE POLICY staff_delete ON public.hajj_timeline_events FOR DELETE TO authenticated
  USING (private.has_permission('hajj_timeline_events', 'delete')
         AND private.row_in_staff_scope(agency_id, branch_id));

-- ---------------------------------------------------------------------------
-- 3. notification_preferences: the row's own user, and nobody else.
-- ---------------------------------------------------------------------------
-- auth.uid() is NULL with no JWT, and `user_id = NULL` is NULL, i.e. false, so
-- an anonymous session matches nothing here without needing a separate guard.
CREATE POLICY own_select ON public.notification_preferences FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY own_insert ON public.notification_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY own_update ON public.notification_preferences FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY own_delete ON public.notification_preferences FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. support_tickets: the pilgrim's tenant, read through the definer helper.
-- ---------------------------------------------------------------------------
CREATE POLICY staff_select ON public.support_tickets FOR SELECT TO authenticated
  USING (private.has_permission('support_tickets', 'read')
         AND private.pilgrim_in_staff_scope(pilgrim_id));
CREATE POLICY staff_insert ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('support_tickets', 'create')
              AND private.pilgrim_in_staff_scope(pilgrim_id));
CREATE POLICY staff_update ON public.support_tickets FOR UPDATE TO authenticated
  USING (private.has_permission('support_tickets', 'update')
         AND private.pilgrim_in_staff_scope(pilgrim_id))
  WITH CHECK (private.has_permission('support_tickets', 'update')
              AND private.pilgrim_in_staff_scope(pilgrim_id));
CREATE POLICY staff_delete ON public.support_tickets FOR DELETE TO authenticated
  USING (private.has_permission('support_tickets', 'delete')
         AND private.pilgrim_in_staff_scope(pilgrim_id));

-- ---------------------------------------------------------------------------
-- 5. Only now is the broad policy redundant rather than load-bearing.
-- ---------------------------------------------------------------------------
-- IF EXISTS, because these five policies exist in the live database and in no
-- migration -- the same hole 20260919110000 just closed for the tables under
-- them. Against production they are really dropped; against a database rebuilt
-- from migrations alone they were never created, and a bare DROP would abort the
-- rebuild. Gate B does not care which world it is in: it asserts none remains.
DROP POLICY IF EXISTS staff_scoped_all ON public.bank_reconciliations;
DROP POLICY IF EXISTS staff_scoped_all ON public.bank_statement_lines;
DROP POLICY IF EXISTS staff_scoped_all ON public.hajj_timeline_events;
DROP POLICY IF EXISTS staff_scoped_all ON public.notification_preferences;
DROP POLICY IF EXISTS staff_support_tickets ON public.support_tickets;

-- ---------------------------------------------------------------------------
-- 6. Gates. db push wraps this file in one transaction, so any raise below
--    rolls every policy above back with it.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
  v_orig_role text := current_user;
  v_user uuid; v_agency uuid; v_pilgrim uuid;
  v_n int; v_t text; v_rows int; v_total int := 0;
  v_in boolean; v_null boolean; v_unknown boolean;
  v_tables text[] := ARRAY['bank_reconciliations','bank_statement_lines',
                           'hajj_timeline_events','notification_preferences','support_tickets'];
BEGIN
  -- A. RLS is actually on. Policies on a table with RLS disabled are decoration.
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = ANY(v_tables) AND c.relrowsecurity;
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'gate A: RLS is enabled on only % of the 5 tables', v_n;
  END IF;

  -- B. Each table covers all four commands, and no broad is_staff() ALL policy
  --    survives on any of them. This is the gate that holds in both worlds: on
  --    production because section 5 dropped them, on a rebuilt database because
  --    they were never created there.
  FOREACH v_t IN ARRAY v_tables LOOP
    SELECT count(DISTINCT p.cmd) INTO v_n FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = v_t
       AND p.cmd IN ('SELECT','INSERT','UPDATE','DELETE');
    IF v_n <> 4 THEN
      RAISE EXCEPTION 'gate B: % covers only % of the 4 commands', v_t, v_n;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = ANY(v_tables)
     AND p.permissive = 'PERMISSIVE' AND p.cmd = 'ALL'
     AND btrim(coalesce(p.qual, '')) ~ '^\(?(public\.|private\.)?is_staff\(\)\)?$';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'gate B: % broad is_staff() ALL policies still stand', v_n;
  END IF;

  -- C. The client can execute the helper its own policies call. Revoking EXECUTE
  --    on a helper does not tighten a policy, it breaks it, and nothing running
  --    as postgres can see the difference.
  IF NOT has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'gate C: authenticated lacks USAGE on schema private';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'private.pilgrim_in_staff_scope(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gate C: authenticated cannot execute pilgrim_in_staff_scope -- '
                    'every support_tickets policy would raise 42501';
  END IF;

  -- D. All five are still empty. This is not housekeeping: it is the premise
  --    gate F rests on, recorded so it cannot quietly stop being true. If a
  --    table has gained rows, "a staff session read it without error" no longer
  --    distinguishes a working policy from one that filters everything away, and
  --    F has to be re-derived against real data instead of passing by accident.
  SELECT (SELECT count(*) FROM public.bank_reconciliations)
       + (SELECT count(*) FROM public.bank_statement_lines)
       + (SELECT count(*) FROM public.hajj_timeline_events)
       + (SELECT count(*) FROM public.notification_preferences)
       + (SELECT count(*) FROM public.support_tickets) INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'gate D: the 5 tables were empty when this file was written and now hold % '
                    'rows -- gate F can no longer tell "reachable" from "filtered to nothing", '
                    'so re-derive it before applying', v_n;
  END IF;

  -- The behavioural gates need a real identity to impersonate. On the live
  -- database there is one and E and F below run. On a database rebuilt from
  -- migrations alone there is no staff profile and no pilgrim yet, and there is
  -- nothing dishonest about that -- but it must be announced rather than passed
  -- over in silence, because a reader seeing this file go green on a fresh
  -- rebuild would otherwise believe the impersonation gates had run.
  SELECT sp.user_id, sp.agency_id INTO v_user, v_agency
    FROM public.staff_profiles sp
   WHERE sp.is_active AND sp.user_id IS NOT NULL LIMIT 1;
  IF v_user IS NOT NULL THEN
    SELECT p.id INTO v_pilgrim FROM public.pilgrims p WHERE p.agency_id = v_agency LIMIT 1;
  END IF;

  IF v_user IS NULL OR v_pilgrim IS NULL THEN
    RAISE NOTICE 'gates A-D passed; E and F SKIPPED -- no active staff profile with a pilgrim '
                 'in its agency, so there is no identity to probe as. Structure is proven, '
                 'behaviour is not.';
    RETURN;
  END IF;

  -- E. The helper discriminates. Run under the staff identity, so what this
  --    proves is existence-and-resolution, not tenancy: the only staff profile
  --    is an ADMIN and row_in_staff_scope bypasses scope for ADMIN, so a
  --    cross-tenant pilgrim would answer true here too. Proving tenancy needs a
  --    non-ADMIN account, which does not exist; this gate says what it can.
  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_in      := private.pilgrim_in_staff_scope(v_pilgrim);
  v_null    := private.pilgrim_in_staff_scope(NULL);
  v_unknown := private.pilgrim_in_staff_scope('00000000-0000-0000-0000-000000000000'::uuid);
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT v_in THEN
    RAISE EXCEPTION 'gate E: the helper denied pilgrim % of the staff agency', v_pilgrim;
  END IF;
  IF v_null IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'gate E: a NULL pilgrim_id answered %, expected false', v_null;
  END IF;
  IF v_unknown IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'gate E: an unknown pilgrim answered %, expected false', v_unknown;
  END IF;

  -- F. A real staff session can reach all five without error. This is the actual
  --    risk of adding policies where there were none: a predicate that raises
  --    rather than filters. The handler names the role, because 42501 here could
  --    be the helper grant, the table grant, or a lost role.
  PERFORM set_config('request.jwt.claims',
          json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'gate F: role switch failed (current_user=%)', current_user;
  END IF;
  BEGIN
    FOREACH v_t IN ARRAY v_tables LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_rows;
      v_total := v_total + v_rows;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', v_orig_role, true);
    RAISE EXCEPTION 'gate F: % was unreachable as authenticated (session_user=%): %',
                    v_t, session_user, SQLERRM;
  END;
  -- Restore to the role this block found, never to 'none': SET ROLE NONE means
  -- session_user, and db push's session_user is a NOINHERIT login role holding
  -- nothing, which silently strips every statement after it.
  PERFORM set_config('role', v_orig_role, true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF current_user <> v_orig_role THEN
    RAISE EXCEPTION 'gate F: could not restore role % (current_user=%)', v_orig_role, current_user;
  END IF;
  IF v_total <> 0 THEN
    RAISE EXCEPTION 'gate F: a staff session read % rows from tables holding none', v_total;
  END IF;

  RAISE NOTICE 'gates A-F passed: 5 tables scoped, 5 broad policies dropped, '
               'helper grants verified, staff session reached all five';
END;
$gate$;
