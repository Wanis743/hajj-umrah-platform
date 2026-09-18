-- 20260916130000_the_portal_lookup_nobody_wrote.sql
--
-- What is actually wrong
-- ----------------------
-- public.get_portal_reservation_data(text, text) exists in the live database and
-- is one of the two functions the anon key is meant to reach. No migration in
-- this directory creates it. It was typed into a SQL editor once and never
-- written down -- the same class of drift that left public.current_staff_agency_id()
-- with 142 call sites and no definition, and the reason
-- scripts/verify-migrations.mjs exists at all.
--
-- The drift stayed invisible until 20260916140000 tried to grant on it:
--
--   20260916140000_the_default_that_kept_granting_anon.sql:136:
--     public.get_portal_reservation_data() is invoked by DDL but no migration
--     ever creates it
--
-- That failure is not cosmetic. `GRANT EXECUTE ON FUNCTION` naming a function no
-- earlier migration created raises 42883, so a fresh replay of this directory
-- stops dead at that line. The live database is correct; the repository cannot
-- reproduce it. This file closes that gap by writing down what is already there.
--
-- Why this file is timestamped 20260916130000
-- -------------------------------------------
-- Between 20260916120000 and 20260916140000, deliberately. The verifier is
-- order-aware: it records each function's first definition as
-- `index * 1e6 + line` over the lexically sorted file list and fails a call site
-- whose own order is smaller. A later timestamp -- 20260916160000, say -- would
-- have satisfied "is it authored anywhere?" while replacing one failure with
-- another ("... is invoked by DDL before <file> creates it"), and the replay
-- would still raise 42883. The constraint is real, not a lint: the CREATE has to
-- precede the GRANT.
--
-- The consequence is that this file is older than the newest ledger entry, so it
-- applies with `supabase db push --include-all` rather than a plain push.
--
-- What the body is
-- ----------------
-- A verbatim transcription of the live definition, read back through
-- pg_get_functiondef rather than reconstructed from intent: SECURITY DEFINER,
-- search_path pinned to public + pg_catalog, phone normalised to digits on both
-- sides of the comparison so stored formatting does not matter, and NULL on a
-- miss so a caller cannot learn whether a reference exists by probing it. The
-- SELECT reads eleven columns; the returned object carries eight. id, package_id
-- and the caller's own phone number are read and deliberately not echoed back.
--
-- The one thing worth noting about a transcription: it is still an unverified
-- body. plpgsql compiles lazily, so this CREATE would succeed against a
-- reservations table shaped nothing like the one the body assumes, and the 42703
-- would surface in front of a portal visitor instead. The gate below therefore
-- resolves all eleven column references against the live catalogue first -- the
-- same stand-in 20260916120000 used for the export contract, and for the same
-- reason.
--
-- What this migration does not claim
-- ----------------------------------
-- It does not prove the function runs. No psql and no Docker here, so nothing
-- executes it, and no fresh replay confirms the ordering argument above
-- empirically -- the argument rests on reading the verifier and on how PostgreSQL
-- resolves a GRANT, not on a replay that was actually performed.
--
-- It also asserts nothing about authenticated's access. On this database the
-- function is authenticated-executable because the schema's default ACL granted
-- it at birth, and a migration should not assert state it did not establish.
-- Only anon is asserted, because only anon is granted here.

CREATE OR REPLACE FUNCTION public.get_portal_reservation_data(
    p_reference TEXT,
    p_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_res RECORD;
  v_norm_phone text;
BEGIN
  -- Normalize phone: keep digits only
  v_norm_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');

  SELECT
    r.id, r.reference, r.status, r.package_name, r.package_id,
    r.start_date, r.end_date, r.travelers, r.name, r.phone,
    r.created_at
  INTO v_res
  FROM reservations r
  WHERE r.reference = p_reference
    AND regexp_replace(r.phone, '[^0-9]', '', 'g') = v_norm_phone
  LIMIT 1;

  IF NOT FOUND THEN
    -- Return null result (don't leak whether reference exists)
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'reference', v_res.reference,
    'status', v_res.status,
    'package_name', v_res.package_name,
    'start_date', v_res.start_date,
    'end_date', v_res.end_date,
    'travelers', v_res.travelers,
    'name', v_res.name,
    'created_at', v_res.created_at
  );
END;
$$;

-- The grant pair this function is supposed to carry. It is genuinely anon-facing:
-- the portal lookup is the one write-free path a visitor with no account uses,
-- and it is one of the two names on 20260916140000's keep-list.
REVOKE ALL ON FUNCTION public.get_portal_reservation_data(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_reservation_data(TEXT, TEXT) TO anon;

-- ---------------------------------------------------------------------------
-- Gate. "The function exists" is not a gate here -- CREATE OR REPLACE above
-- guarantees it, so a check for it could never fail. What can fail is the
-- assumption the body rests on, so that is what is checked: every column it
-- reads must resolve, and the privileges this file sets must actually be set.
-- ---------------------------------------------------------------------------
DO $gate$
DECLARE
    v_missing TEXT;
    v_oid     OID;
    v_secdef  BOOLEAN;
    v_path    BOOLEAN;
    v_count   INT;
BEGIN
    -- (a) The eleven columns the SELECT reads. plpgsql will not check these
    --     until the function is called, so they are checked here instead.
    SELECT string_agg(format('reservations.%s', r.col), ', ' ORDER BY r.col)
      INTO v_missing
      FROM (VALUES
        ('id'), ('reference'), ('status'), ('package_name'), ('package_id'),
        ('start_date'), ('end_date'), ('travelers'), ('name'), ('phone'),
        ('created_at')
      ) AS r(col)
     WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name   = 'reservations'
           AND c.column_name  = r.col
     );

    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'portal-lookup gate: body reads columns that do not exist: %', v_missing
            USING ERRCODE = '42703';
    END IF;

    -- (b) Resolve by oid on types alone: pg_get_function_identity_arguments()
    --     renders parameter names, so it never matches a bare type list.
    v_oid := to_regprocedure('public.get_portal_reservation_data(text, text)');

    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'portal-lookup gate: function absent at the (text, text) signature'
            USING ERRCODE = '42883';
    END IF;

    -- (c) Exactly one function may carry this name. This one guards the file two
    --     steps ahead: 20260916140000's gate asserts that public holds exactly
    --     two anon-executable functions, so an overload picking up an anon grant
    --     would abort that migration rather than this one -- a long way from the
    --     line that caused it.
    SELECT count(*) INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_portal_reservation_data';

    IF v_count <> 1 THEN
        RAISE EXCEPTION 'portal-lookup gate: expected exactly 1 get_portal_reservation_data in public, found %', v_count
            USING ERRCODE = '42723';
    END IF;

    -- (d) Definer and pinned. A definer function reachable by the anon key is a
    --     hole in the shape of its own body, so the search_path it runs under is
    --     part of its security, not a style preference.
    SELECT p.prosecdef,
           EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                    WHERE cfg LIKE 'search_path=%')
      INTO v_secdef, v_path
      FROM pg_proc p
     WHERE p.oid = v_oid;

    IF NOT v_secdef THEN
        RAISE EXCEPTION 'portal-lookup gate: function is not SECURITY DEFINER'
            USING ERRCODE = '42501';
    END IF;

    IF NOT v_path THEN
        RAISE EXCEPTION 'portal-lookup gate: function has no pinned search_path'
            USING ERRCODE = '42501';
    END IF;

    -- (e) The two privileges this file sets: anon in by name, PUBLIC out. PUBLIC
    --     is not a role that exists today, it is every role that will ever
    --     exist, so leaving EXECUTE there re-opens the function for anything
    --     added later.
    IF NOT has_function_privilege('anon', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'portal-lookup gate: anon lacks EXECUTE on the portal lookup'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid = v_oid), '{}'::aclitem[])) a
         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'portal-lookup gate: PUBLIC still holds EXECUTE on the portal lookup'
            USING ERRCODE = '42501';
    END IF;

    RAISE NOTICE 'portal-lookup gate: 11 reservations column references resolved; one definer function, pinned search_path, anon granted, PUBLIC revoked.';
END;
$gate$;
