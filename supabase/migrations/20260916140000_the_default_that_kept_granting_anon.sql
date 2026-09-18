-- 20260916140000_the_default_that_kept_granting_anon.sql
--
-- What is actually wrong
-- ----------------------
-- 20260916120000 ends with the pair every migration in this repo ends with:
--
--   REVOKE ALL ON FUNCTION public.get_export_view(...) FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_export_view(...) TO authenticated;
--
-- and its gate then asserted that PUBLIC does not hold EXECUTE and that
-- authenticated does. Both assertions passed. The function is nevertheless
-- executable by the anon key, because neither the revoke nor the gate was
-- aimed at anon:
--
--   REVOKE ... FROM PUBLIC removes the privilege granted to the pseudo-role
--   PUBLIC. It cannot remove a privilege granted to a named role. anon holds
--   EXECUTE in its own right, so PUBLIC losing it changes nothing.
--
-- Where anon's grant comes from -- it was never written by any migration:
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
--
-- is recorded in pg_default_acl for this project, so *every* function created
-- in public is granted EXECUTE to anon at birth. The observed default ACL is
--
--   f: {postgres=X, anon=X, authenticated=X, service_role=X}
--
-- which is why the hole is not one slip but a schema-wide condition: of 280
-- functions in public, 242 are SECURITY DEFINER and 78 are anon-executable,
-- 56 of those both. A SECURITY DEFINER function runs as its owner, so an
-- anon-executable one is a hole in exactly the shape of its own body.
--
-- There is a second, independent path to the same place. 72 of those 78
-- functions carry an explicit EXECUTE grant to PUBLIC, and PUBLIC includes
-- anon, so revoking anon alone would leave all 72 reachable -- and this
-- migration's own gate would then abort it.
--
-- Where those 72 grants came from cannot be established from the catalogue,
-- and this migration does not pretend otherwise. What is measured: the grantor
-- on every one of them is postgres; no migration in this repository contains a
-- GRANT ... TO PUBLIC (searched); and neither pg_default_acl row for functions
-- in public -- postgres's or supabase_admin's -- lists PUBLIC as a grantee,
-- both being exactly {postgres, anon, authenticated, service_role}=X. A
-- function created under those defaults is therefore born with a non-NULL ACL
-- and no PUBLIC grant, which is also why 0 functions in public still have a
-- NULL ACL and why the usual explanation -- a GRANT materialising PostgreSQL's
-- built-in EXECUTE-to-PUBLIC default onto a NULL ACL -- cannot be what
-- happened here. 41 of the 72 are *_command wrappers and 15 are attached to
-- triggers, which is the shape of one bulk grant rather than 72 authoring
-- slips; the statement that issued it is not in this repository.
--
-- Also measured, and the reason the repair does not depend on the provenance:
-- 0 of the 78 are anon-executable *without* a direct anon grant. The two paths
-- overlap completely rather than hiding behind each other, so both have to be
-- closed for either to mean anything.
--
-- Revoking PUBLIC is safe here, which is a fact about this database and not a
-- general one: every one of the 72 also holds a direct authenticated grant and
-- a direct service_role grant (both counts measured at 0 exceptions), and the
-- only grantees appearing on any function in public are PUBLIC, anon,
-- authenticated, postgres and service_role. No role loses its last path.
--
-- What was actually exposed
-- -------------------------
-- Most of the 78 survive scrutiny: ~20 are trigger functions (PostgreSQL does
-- not check EXECUTE when a trigger fires, and anon DML is RLS-blocked anyway),
-- ~40 are the thin *_command wrappers that delegate to insert/patch/delete_
-- scoped_command_row, and 20 carry a current_staff_agency_id / auth.uid /
-- 42501 guard that stops an anon caller at the door. That still leaves real
-- exposure, and it is reported in the commit rather than patched here, because
-- fixing it changes behaviour for authenticated callers too.
--
-- The keep-list
-- -------------
-- Only two functions in public are designed to be called with the anon key:
--
--   get_public_packages()                     -- the marketing catalogue;
--                                                src/hooks/usePublicPackages.ts:77
--   get_portal_reservation_data(text, text)   -- reference + normalised-phone
--                                                lookup, returns NULL on a miss
--                                                without disclosing whether the
--                                                reference exists, and never
--                                                echoes the phone back
--
-- Everything else the client calls, it calls as an authenticated staff user.
-- Verified by reading all 16 .rpc() names in src against the live catalogue.
--
-- A repair that fell out of that audit
-- ------------------------------------
-- public.create_reservation_request(jsonb) has the ACL
--
--   postgres=X/postgres | service_role=X/postgres
--
-- -- no anon, and no authenticated either. Its body opens with
-- `if not public.is_staff() then raise exception 'Unauthorized'` and derives
-- agency_id/branch_id from public.staff_agency_id(), so it is staff-only by
-- construction; but src/components/admin/NewReservationModal.tsx:71 calls it,
-- and with authenticated lacking EXECUTE that call can only ever return 42501.
-- The New Reservation modal is dead today. It is granted below, because the
-- grant restores an intended path and widens nothing: anon still cannot reach
-- it, and the function's own is_staff() guard is what authorises the caller.
--
-- What this migration does not claim
-- ----------------------------------
-- The default ACL is recorded twice, once by postgres and once by
-- supabase_admin. postgres is not a member of supabase_admin on this project
-- (pg_has_role -> false), so only the postgres-owned entry can be removed from
-- here; the supabase_admin one is beyond this role's reach and is left in
-- place. That is tolerable because migrations connect as postgres, so every
-- function this repo creates from now on is born without an anon grant -- but
-- an object created by supabase_admin itself would still receive one.
--
-- It also does not touch the relation or sequence default ACLs, which show the
-- same shape (r: anon=arwdDxtm, S: anon=rwU). Those are a separate sweep
-- against tables, deliberately not folded into a migration about functions.

-- 1. Stop the source. The first line removes anon from the default ACL, so the
--    next CREATE FUNCTION in public is no longer born anon-executable; without
--    it every later migration re-opens the hole it just closed. The second
--    changes nothing today -- PUBLIC is not a grantee of either default-ACL
--    row -- and is kept only so the intent is recorded in the catalogue and so
--    the shape is right if PostgreSQL's built-in EXECUTE-to-PUBLIC default ever
--    reappears in that row.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 2. Close the 78, then close the 72 that would have survived it. All 280
--    functions in public are owned by postgres, the role migrations connect
--    as, so both revokes apply to every one of them. public has no procedures
--    (prokind='p' -> 0), so ALL FUNCTIONS is complete.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- 3. Hand back the two that are meant to be public.
GRANT EXECUTE ON FUNCTION public.get_public_packages() TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_reservation_data(TEXT, TEXT) TO anon;

-- 4. Repair the staff path that had no grant at all.
GRANT EXECUTE ON FUNCTION public.create_reservation_request(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- Gate. REVOKE on an object the current role does not own emits a WARNING and
-- carries on -- it does not error. A migration that only issued the revokes
-- above would therefore report success whether or not a single privilege
-- changed. So the gate does not check that the statements ran; it checks the
-- resulting privilege state, which is the only thing that fails closed.
--
-- It asserts in both directions, because a revoke this broad is as dangerous
-- when it removes too much as when it removes too little: anon must hold
-- EXECUTE on exactly the keep-list and nothing else, and authenticated must
-- still hold EXECUTE on every RPC the client calls.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
    v_keep       TEXT[] := ARRAY['get_public_packages', 'get_portal_reservation_data'];
    v_client_rpc TEXT[] := ARRAY[
        'cancel_reservation_request', 'create_import_batch', 'create_reservation_request',
        'get_accounting_series', 'get_dashboard_analytics_snapshot',
        'get_dashboard_executive_snapshot', 'get_data_quality_snapshot',
        'get_export_view', 'get_group_readiness', 'get_payment_methods_series',
        'get_public_packages', 'get_recent_journal_entries', 'log_export',
        'record_payment_transaction', 'update_departure_setting'
    ];
    v_extra      TEXT;
    v_anon_count INT;
    v_missing    TEXT;
    v_export     OID;
    v_reserve    OID;
BEGIN
    -- (a) No function outside the keep-list may be anon-executable.
    SELECT string_agg(s.sig, ', ' ORDER BY s.sig)
      INTO v_extra
      FROM (
        SELECT p.oid::regprocedure::TEXT AS sig
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND has_function_privilege('anon', p.oid, 'EXECUTE')
           AND NOT (p.proname = ANY (v_keep))
      ) s;

    IF v_extra IS NOT NULL THEN
        RAISE EXCEPTION 'anon-revoke gate: anon still holds EXECUTE outside the keep-list: %', v_extra
            USING ERRCODE = '42501';
    END IF;

    -- (b) ...and the keep-list itself must be exactly two functions, so that a
    --     same-named overload cannot pass check (a) by borrowing the name.
    SELECT count(*) INTO v_anon_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND has_function_privilege('anon', p.oid, 'EXECUTE');

    IF v_anon_count <> 2 THEN
        RAISE EXCEPTION 'anon-revoke gate: expected exactly 2 anon-executable functions in public, found %', v_anon_count
            USING ERRCODE = '42501';
    END IF;

    -- (c) The revoke must not have cost authenticated anything the client needs.
    SELECT string_agg(DISTINCT p.oid::regprocedure::TEXT, ', ')
      INTO v_missing
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_client_rpc)
       AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'anon-revoke gate: authenticated lost EXECUTE on client RPCs: %', v_missing
            USING ERRCODE = '42501';
    END IF;

    -- (d) The function that started this: anon out, authenticated in.
    v_export := to_regprocedure('public.get_export_view(text, date, date, integer, integer)');
    IF v_export IS NULL THEN
        RAISE EXCEPTION 'anon-revoke gate: get_export_view absent at the 5-argument signature'
            USING ERRCODE = '42883';
    END IF;
    IF has_function_privilege('anon', v_export, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon-revoke gate: anon still holds EXECUTE on get_export_view'
            USING ERRCODE = '42501';
    END IF;
    IF NOT has_function_privilege('authenticated', v_export, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon-revoke gate: authenticated lacks EXECUTE on get_export_view'
            USING ERRCODE = '42501';
    END IF;

    -- (e) The repaired staff path: reachable by staff, still not by anon.
    v_reserve := to_regprocedure('public.create_reservation_request(jsonb)');
    IF v_reserve IS NULL THEN
        RAISE EXCEPTION 'anon-revoke gate: create_reservation_request(jsonb) absent'
            USING ERRCODE = '42883';
    END IF;
    IF NOT has_function_privilege('authenticated', v_reserve, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon-revoke gate: authenticated still lacks EXECUTE on create_reservation_request'
            USING ERRCODE = '42501';
    END IF;
    IF has_function_privilege('anon', v_reserve, 'EXECUTE') THEN
        RAISE EXCEPTION 'anon-revoke gate: create_reservation_request became anon-executable'
            USING ERRCODE = '42501';
    END IF;

    -- (f) No function in public may grant EXECUTE to PUBLIC. This is the check
    --     that would have caught the original defect: PUBLIC is not a role that
    --     exists today, it is every role that will ever exist, so a grant to it
    --     re-opens for anon the moment anon is re-created or a new role appears.
    SELECT string_agg(s.sig, ', ' ORDER BY s.sig)
      INTO v_extra
      FROM (
        SELECT p.oid::regprocedure::TEXT AS sig
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND EXISTS (
             SELECT 1 FROM aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
           )
      ) s;

    IF v_extra IS NOT NULL THEN
        RAISE EXCEPTION 'anon-revoke gate: PUBLIC still holds EXECUTE on: %', v_extra
            USING ERRCODE = '42501';
    END IF;

    -- (g) The default ACL this role owns grants EXECUTE to neither anon nor
    --     PUBLIC, so the next CREATE FUNCTION in public is born closed. Only
    --     the postgres row is checked: postgres is not a member of
    --     supabase_admin here, so that row cannot be altered from a migration.
    IF EXISTS (
        SELECT 1
          FROM pg_default_acl d
          JOIN pg_namespace n ON n.oid = d.defaclnamespace
         WHERE n.nspname = 'public'
           AND d.defaclobjtype = 'f'
           AND d.defaclrole = 'postgres'::regrole
           AND EXISTS (
             SELECT 1 FROM aclexplode(d.defaclacl) a
              WHERE a.privilege_type = 'EXECUTE'
                AND a.grantee IN (0, 'anon'::regrole::oid)
           )
    ) THEN
        RAISE EXCEPTION 'anon-revoke gate: postgres default ACL still grants EXECUTE to anon or PUBLIC'
            USING ERRCODE = '42501';
    END IF;

    RAISE NOTICE 'anon-revoke gate: 78 anon-executable functions reduced to 2 (get_public_packages, get_portal_reservation_data); 72 PUBLIC EXECUTE grants removed; 15 client RPC names retain authenticated EXECUTE; postgres default ACL no longer grants anon or PUBLIC.';
END;
$gate$;
