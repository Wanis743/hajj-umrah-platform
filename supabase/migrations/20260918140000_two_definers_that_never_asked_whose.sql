-- Two SECURITY DEFINER functions that never asked whose row they were reading.
--
-- SECURITY DEFINER suspends row security. That is the whole point of it -- these
-- functions read tables the caller holds no grant on -- but it means the scope
-- check the policies would have applied has to be written into the body by hand,
-- and in these two it never was.
--
--   get_group_readiness(p_group_id)   counted pilgrims, visas, transport and rooms
--                                     for ANY group id an authenticated caller
--                                     cared to type. No agency predicate anywhere
--                                     in the body. GroupControlCenter.tsx:54 only
--                                     ever passes a group from a scoped list, but
--                                     the RPC is reachable directly.
--
--   get_or_create_account(p_agency_id, ...)  took the agency from its caller and
--                                     believed it, then INSERTed into that
--                                     agency's chart_of_accounts. A cross-tenant
--                                     write, not merely a read.
--
-- Both also ran with a mutable search_path, which the advisor flags separately
-- (function_search_path_mutable) and which matters more in a definer function
-- than anywhere else. Both are pinned here.
--
-- Why the two security_definer_view ERRORs are NOT in this migration.
-- 20260915110000 already dealt with group_operations_summary and
-- expiring_documents: anon SELECT is revoked on both, and both carry the base
-- tables' own predicate inside the view body. What still trips the advisor is the
-- absence of security_invoker = true, and that absence is deliberate and tested --
-- authenticated holds no grant on groups, pilgrims, documents, room_allocations
-- or transport_assignments, so flipping the reloption replaces a scoping question
-- with 42501 permission denied. Verified again before writing this file: under a
-- simulated staff session both views answer (2 rows and 0 rows) with no error.
-- The lint is a known false positive for this schema and is left alone.
--
-- What the predicates below are, and why they differ from each other.
-- Neither is invented here; each is the predicate the table's own policies already
-- use, so that the RPC and the table agree about who may see what.
--
--   groups            staff_select = has_permission('groups','read')
--                                    AND row_in_staff_scope(agency_id, branch_id)
--                     -- row_in_staff_scope is ADMIN-bypassing and branch-aware.
--                     -- get_group_readiness uses exactly this, so the readiness
--                     -- panel can never deny a group the list beside it shows.
--
--   chart_of_accounts staff_insert = has_permission('chart_of_accounts','create')
--                                    AND agency_id = current_staff_agency_id()
--                     -- strict agency equality, NO admin bypass, and no branch
--                     -- term because the table has no branch_id column.
--                     -- row_in_staff_scope would have been wrong here twice over:
--                     -- it would let any ADMIN write any agency, and its branch
--                     -- term is NULL against a branch-less table, which is false
--                     -- for every non-ADMIN -- that would have broken the ledger
--                     -- triggers for ordinary finance staff.
--
-- The deny side is proved with no JWT rather than with a second staff account.
-- This database has exactly one active staff profile and it is an ADMIN, and
-- row_in_staff_scope bypasses scope for ADMIN, so an ADMIN probe cannot produce a
-- denial and a gate built on one would pass no matter what this file did. The
-- migration session has no request.jwt.claims at all, which is a genuine denial,
-- and the permit side is then proved separately with the real staff identity.

-- ---------------------------------------------------------------------------
-- 1. get_group_readiness: answer only for a group the caller may read.
-- ---------------------------------------------------------------------------
-- Out of scope returns the same zero row an empty group returns, rather than
-- raising. Two reasons. It refuses to confirm that a group id exists, and the
-- caller at GroupControlCenter.tsx:54 destructures only { data } -- on an error
-- data is null and the component renders a hardcoded 91.1% mock, so raising
-- would answer a cross-tenant probe with invented numbers instead of zeros.

CREATE OR REPLACE FUNCTION public.get_group_readiness(p_group_id uuid)
RETURNS TABLE(total_pax integer, visas_approved integer, flights_ticketed integer,
              hotels_assigned integer, readiness_score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_total_pax INT := 0;
    v_visas INT := 0;
    v_flights INT := 0;
    v_hotels INT := 0;
    v_score NUMERIC := 0;
    v_has_transport BOOLEAN := false;
    v_agency UUID;
    v_branch UUID;
BEGIN
    -- 0. Whose group is this? Every coalesce here is deliberate: staff_role()
    --    and row_in_staff_scope() both return NULL when there is no staff
    --    identity, and NOT NULL is NULL, which an IF treats as false -- i.e.
    --    without the coalesce the absence of an identity would read as a pass.
    SELECT g.agency_id, g.branch_id INTO v_agency, v_branch
      FROM public.groups g WHERE g.id = p_group_id;

    IF v_agency IS NULL
       OR NOT COALESCE(public.has_permission('groups', 'read'), false)
       OR NOT COALESCE(public.row_in_staff_scope(v_agency, v_branch), false) THEN
        RETURN QUERY SELECT 0, 0, 0, 0, 0.0::NUMERIC;
        RETURN;
    END IF;

    -- 1. Total Pax
    SELECT COUNT(*) INTO v_total_pax FROM public.pilgrims WHERE group_id = p_group_id;

    IF v_total_pax = 0 THEN
        RETURN QUERY SELECT 0, 0, 0, 0, 0.0::NUMERIC;
        RETURN;
    END IF;

    -- 2. Visas Approved
    SELECT COUNT(*) INTO v_visas FROM public.pilgrims
     WHERE group_id = p_group_id AND visa_status = 'APPROVED';

    -- 3. Flights (Transport Assignments)
    SELECT EXISTS(SELECT 1 FROM public.transport_assignments
                   WHERE group_id = p_group_id AND status = 'CONFIRMED') INTO v_has_transport;
    IF v_has_transport THEN
        v_flights := v_total_pax;
    ELSE
        v_flights := 0;
    END IF;

    -- 4. Hotels Assigned
    SELECT COUNT(DISTINCT pilgrim_id) INTO v_hotels FROM public.room_allocations
     WHERE group_id = p_group_id AND status = 'CONFIRMED' AND pilgrim_id IS NOT NULL;

    -- 5. Calculate Score (Average of the 3 metrics out of total pax)
    v_score := ((v_visas + v_flights + v_hotels)::NUMERIC / (v_total_pax * 3)::NUMERIC) * 100.0;

    RETURN QUERY SELECT
        v_total_pax,
        v_visas,
        v_flights,
        v_hotels,
        ROUND(v_score, 1);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. get_or_create_account: stop believing the caller about the agency.
-- ---------------------------------------------------------------------------
-- This one raises rather than returning a neutral value, because its callers are
-- ledger triggers -- a posting that silently landed in no account, or the wrong
-- one, is worse than a failed insert.
--
-- The guard keys on auth.uid() rather than on the role. There is no end-user
-- identity in a service_role call, an Edge function, or a migration, and those
-- contexts legitimately act for any agency; there IS one whenever a staff member
-- triggers a posting, and that is the path being closed. A JWT with no staff
-- profile behind it is rejected too: current_staff_agency_id() returns NULL, and
-- NULL is not a licence to write anywhere.

CREATE OR REPLACE FUNCTION public.get_or_create_account(p_agency_id uuid, p_code text,
                                                        p_name text, p_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_acc_id UUID;
    v_uid UUID := auth.uid();
    v_caller_agency UUID;
BEGIN
    IF p_agency_id IS NULL THEN
        RAISE EXCEPTION 'get_or_create_account: p_agency_id is required'
          USING ERRCODE = '22004';
    END IF;

    IF v_uid IS NOT NULL THEN
        v_caller_agency := public.current_staff_agency_id();
        IF v_caller_agency IS NULL OR v_caller_agency <> p_agency_id THEN
            RAISE EXCEPTION 'get_or_create_account: agency % is outside the caller''s scope',
                            p_agency_id
              USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT id INTO v_acc_id FROM public.chart_of_accounts
     WHERE agency_id = p_agency_id AND code = p_code;

    IF v_acc_id IS NULL THEN
        INSERT INTO public.chart_of_accounts (agency_id, code, name, account_type)
        VALUES (p_agency_id, p_code, p_name, p_type)
        RETURNING id INTO v_acc_id;
    END IF;

    RETURN v_acc_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Proof, part one: behaviour. This runs BEFORE the revoke in section 4.
--    The behavioural probes have to call the function, so they run while every
--    grant still stands; section 4 then removes one, and section 5 asserts the
--    removal from the catalogue, which needs no call at all. That split keeps
--    the two halves from depending on whichever role db push happens to connect
--    as -- a dependency that cost two rolled-back attempts to find. The first
--    died on 42501 at D1 and the second, with the role named in the message,
--    said current_user=cli_login_postgres: C2 was resetting `role` to 'none',
--    which means session_user, and db push's session_user is a bare NOINHERIT
--    login role. Every statement after C2 was running with no privileges at all.
--    C2 now restores the role it found rather than assuming 'none' is neutral.
--
--    psql is unavailable here, so db push wrapping this file in a transaction is
--    the verification: any raise below rolls the whole file back.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
  v_user uuid; v_agency uuid; v_other uuid;
  v_group uuid; v_group_pax int;
  v_code text; v_other_code text;
  v_got record; v_id uuid; v_raised boolean; v_n int;
  v_coa_before int; v_coa_after int;
  v_orig_role text := current_user;
BEGIN
  -- Fixtures, and a refusal to run vacuously if they are missing.
  SELECT sp.user_id, sp.agency_id INTO v_user, v_agency
    FROM public.staff_profiles sp
   WHERE sp.is_active AND sp.user_id IS NOT NULL LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'gate: no active staff profile -- every probe below would be vacuous';
  END IF;

  SELECT g.id INTO v_group FROM public.groups g
   WHERE EXISTS (SELECT 1 FROM public.pilgrims p WHERE p.group_id = g.id) LIMIT 1;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'gate: no group has pilgrims -- the readiness probe would pass on zeros';
  END IF;
  SELECT COUNT(*) INTO v_group_pax FROM public.pilgrims WHERE group_id = v_group;

  SELECT code INTO v_code FROM public.chart_of_accounts WHERE agency_id = v_agency LIMIT 1;
  SELECT agency_id INTO v_other FROM public.chart_of_accounts
   WHERE agency_id IS DISTINCT FROM v_agency LIMIT 1;
  IF v_code IS NULL OR v_other IS NULL THEN
    RAISE EXCEPTION 'gate: need an existing account in the staff agency and one other agency '
                    '(found code=%, other_agency=%)', v_code, v_other;
  END IF;
  SELECT code INTO v_other_code FROM public.chart_of_accounts WHERE agency_id = v_other LIMIT 1;

  SELECT COUNT(*) INTO v_coa_before FROM public.chart_of_accounts;

  -- A. search_path is pinned on both.
  SELECT COUNT(*) INTO v_n FROM pg_proc p
   WHERE p.oid IN ('public.get_group_readiness(uuid)'::regprocedure,
                   'public.get_or_create_account(uuid,text,text,text)'::regprocedure)
     AND COALESCE(array_to_string(p.proconfig, ','), '') LIKE '%search_path%';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'gate A: expected 2 functions with a pinned search_path, found %', v_n;
  END IF;

  -- C1. Deny side: no staff identity in this session, so a group with pilgrims
  --     must come back as zeros. Before this file it came back with real counts.
  SELECT * INTO v_got FROM public.get_group_readiness(v_group);
  IF v_got.total_pax <> 0 THEN
    RAISE EXCEPTION 'gate C1: readiness reported % pax for group % with no staff identity',
                    v_got.total_pax, v_group;
  END IF;

  -- C2. Permit side: the same group, the same call, with the real staff identity
  --     and the real role. Without this, C1 would also pass on a function that
  --     simply always returns zeros.
  PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'gate C2: role switch failed (current_user=%) -- the probe would be theatre',
                    current_user;
  END IF;
  SELECT * INTO v_got FROM public.get_group_readiness(v_group);
  -- Back to the role this block started in -- NOT to 'none'. SET ROLE NONE resets
  -- to session_user, and db push's session_user is the bare cli_login_postgres
  -- login role, which is NOINHERIT and holds nothing; the CLI does a SET ROLE
  -- postgres of its own at connect time. Resetting to 'none' silently demoted
  -- every statement after this line and killed the first two attempts at D1.
  PERFORM set_config('role', v_orig_role, true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF current_user <> v_orig_role THEN
    RAISE EXCEPTION 'gate C2: could not restore role % (current_user=%)',
                    v_orig_role, current_user;
  END IF;
  IF v_got.total_pax <> v_group_pax THEN
    RAISE EXCEPTION 'gate C2: readiness reported % pax for an in-scope group holding % pilgrims',
                    v_got.total_pax, v_group_pax;
  END IF;

  -- D1. No end-user identity: the trigger/service path still works. An existing
  --     code is used so this takes the SELECT branch and writes nothing. The
  --     handler reports the role AND the message, because 42501 here has two
  --     quite different causes -- a missing EXECUTE, or a session that lost its
  --     role -- and the first two attempts at this file were the second one.
  BEGIN
    v_id := public.get_or_create_account(v_agency, v_code, 'gate probe', 'ASSET');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'gate D1: denied as % (session_user=%, expected role %): %',
                    current_user, session_user, v_orig_role, SQLERRM;
  END;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'gate D1: the service path could not resolve an existing account';
  END IF;

  -- D2. Staff identity, another agency: must be refused. A bare
  --     `WHEN insufficient_privilege` would not be enough -- a missing EXECUTE
  --     raises 42501 too, so catching the code alone would let this pass for
  --     exactly the wrong reason. The message has to be the guard's own.
  PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_raised := false;
  BEGIN
    v_id := public.get_or_create_account(v_other, v_other_code, 'gate probe', 'ASSET');
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%outside the caller%' THEN
      RAISE EXCEPTION 'gate D2: 42501 came from somewhere other than the guard: %', SQLERRM;
    END IF;
    v_raised := true;
  END;
  -- D3. Staff identity, own agency: must still be allowed.
  v_id := public.get_or_create_account(v_agency, v_code, 'gate probe', 'ASSET');
  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT v_raised THEN
    RAISE EXCEPTION 'gate D2: a staff session of agency % reached agency %', v_agency, v_other;
  END IF;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'gate D3: a staff session was denied its own agency %', v_agency;
  END IF;

  -- D4. A null agency is a bug, not a wildcard.
  v_raised := false;
  BEGIN
    v_id := public.get_or_create_account(NULL, 'GATE', 'gate probe', 'ASSET');
  EXCEPTION WHEN null_value_not_allowed THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'gate D4: a NULL agency was accepted';
  END IF;

  -- E. The revoke in section 4 rests on both ledger triggers being postgres-owned
  --    SECURITY DEFINER. Assert it instead of trusting the argument.
  SELECT COUNT(*) INTO v_n
    FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid IN ('public.trg_invoice_to_ledger()'::regprocedure,
                   'public.trg_payment_to_ledger()'::regprocedure)
     AND p.prosecdef AND r.rolname = 'postgres';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'gate E: expected 2 postgres-owned definer ledger triggers, found % -- '
                    'the revoke would break the posting path', v_n;
  END IF;

  -- F. None of the probes above may have written a row.
  SELECT COUNT(*) INTO v_coa_after FROM public.chart_of_accounts;
  IF v_coa_after <> v_coa_before THEN
    RAISE EXCEPTION 'gate F: the probes created % chart_of_accounts row(s)',
                    v_coa_after - v_coa_before;
  END IF;

  RAISE NOTICE 'behaviour gates A,C-F passed: group % (% pax), agencies %/%, coa rows %',
               v_group, v_group_pax, v_agency, v_other, v_coa_after;
END;
$gate$;

-- ---------------------------------------------------------------------------
-- 4. Now take the grant away.
-- ---------------------------------------------------------------------------
-- No client calls get_or_create_account -- it appears nowhere under src/, and the
-- only two callers in the database are trg_invoice_to_ledger and
-- trg_payment_to_ledger. Both are postgres-owned SECURITY DEFINER, so the nested
-- call resolves as the definer and needs no grant on the caller's side. Gate E
-- above asserted that before we got here, rather than trusting the argument.
-- service_role keeps EXECUTE for backend and Edge paths.
--
-- The guard in section 2 stays regardless. Defence in depth is the point: the
-- revoke closes today's reachable path, and the guard survives whoever grants
-- EXECUTE back in a year -- including the ALTER DEFAULT PRIVILEGES that
-- 20260916140000 had to unpick.
REVOKE EXECUTE ON FUNCTION public.get_or_create_account(uuid, text, text, text)
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Proof, part two: the grant is gone. Catalogue only -- no call needed, which
--    is precisely why this half can run after the revoke.
-- ---------------------------------------------------------------------------
DO $gate2$
BEGIN
  IF has_function_privilege('authenticated',
       'public.get_or_create_account(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gate B: authenticated still holds EXECUTE on get_or_create_account';
  END IF;
  IF has_function_privilege('anon',
       'public.get_or_create_account(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gate B: anon still holds EXECUTE on get_or_create_account';
  END IF;
  -- service_role is the one that must survive, or the ledger loses its backend path.
  IF NOT has_function_privilege('service_role',
       'public.get_or_create_account(uuid,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gate B: the revoke took service_role with it';
  END IF;
  -- get_group_readiness is a legitimate staff RPC and must stay reachable.
  IF NOT has_function_privilege('authenticated',
       'public.get_group_readiness(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'gate B: authenticated lost EXECUTE on get_group_readiness';
  END IF;
  RAISE NOTICE 'grant gate B passed';
END;
$gate2$;
