-- ============================================================
-- BOLA/IDOR Security Certification Test Suite
-- منصة وكالة الحج والعمرة — Single Agency ERP
-- ============================================================
-- Run as an authenticated staff user, via:
--     node scripts/run-sql-gate.mjs supabase/tests/bola_idor_security_test.sql
-- (`npm run verify:bola`). All tests should return 0 rows — no cross-agency data
-- leakage — and the summary RAISEs EXCEPTION if any did not, so a leak fails the
-- process. It used to RAISE WARNING, which psql reports and then exits 0 with:
-- the suite printed "❌ TEST(S) FAILED" and the release manifest recorded the
-- gate as VERIFIED.
-- ============================================================

-- ── SETUP: create test fixtures ────────────────────────────────────────────
-- We use a disposable second agency UUID that does NOT exist in the DB.
-- Any RLS policy that properly checks agency_id should return 0 rows.

DO $$
DECLARE
  fake_agency_id  uuid := '00000000-dead-beef-0000-000000000001';
  fake_pilgrim_id uuid := '00000000-dead-beef-0000-000000000002';
  fake_booking_id uuid := '00000000-dead-beef-0000-000000000003';
  fake_payment_id uuid := '00000000-dead-beef-0000-000000000004';
  fake_group_id   uuid := '00000000-dead-beef-0000-000000000005';
  fake_visa_id    uuid := '00000000-dead-beef-0000-000000000006';
  v_count         int;
  v_passed        int := 0;
  v_failed        int := 0;
  v_total         int := 0;
  v_bypasses_rls  boolean;
BEGIN

  RAISE NOTICE '=== BOLA/IDOR Security Test Suite ===';
  RAISE NOTICE 'Testing cross-agency data isolation...';
  RAISE NOTICE '';

  -- ── PREFLIGHT: the session must actually be subject to RLS ──────────────
  -- Every cross-agency test below reads 0 rows for a role that bypasses row
  -- security too — because the fake agency has no data, not because a policy
  -- stopped anything. Run as the service role or a superuser and this suite
  -- passes fifteen out of fifteen while proving nothing at all.
  SELECT rolbypassrls OR rolsuper INTO v_bypasses_rls
  FROM pg_roles WHERE rolname = current_user;
  IF coalesce(v_bypasses_rls, false) THEN
    RAISE EXCEPTION 'BOLA suite must run as a role subject to RLS; % bypasses it, so every test would pass vacuously.', current_user;
  END IF;

  -- ── T01: Direct SELECT on pilgrims with fake agency_id ─────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM pilgrims
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T01 PASS: pilgrims — no rows for fake agency (%)' , fake_agency_id;
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T01 FAIL: pilgrims — leaked % rows for fake agency!', v_count;
  END IF;

  -- ── T02: Direct SELECT on bookings with fake agency_id ─────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM bookings
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T02 PASS: bookings — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T02 FAIL: bookings — leaked % rows!', v_count;
  END IF;

  -- ── T03: Direct SELECT on payments with fake agency_id ─────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM payments
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T03 PASS: payments — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T03 FAIL: payments — leaked % rows!', v_count;
  END IF;

  -- ── T04: Direct SELECT on groups with fake agency_id ───────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM groups
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T04 PASS: groups — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T04 FAIL: groups — leaked % rows!', v_count;
  END IF;

  -- ── T05: Direct SELECT on packages with fake agency_id ─────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM packages
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T05 PASS: packages — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T05 FAIL: packages — leaked % rows!', v_count;
  END IF;

  -- ── T06: IDOR on pilgrim by fake ID ────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM pilgrims
  WHERE id = fake_pilgrim_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T06 PASS: pilgrim IDOR — fake ID returned 0 rows';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T06 FAIL: pilgrim IDOR — % rows leaked!', v_count;
  END IF;

  -- ── T07: IDOR on booking by fake ID ────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM bookings
  WHERE id = fake_booking_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T07 PASS: booking IDOR — fake ID returned 0 rows';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T07 FAIL: booking IDOR — % rows leaked!', v_count;
  END IF;

  -- ── T08: IDOR on payment by fake ID ────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM payments
  WHERE id = fake_payment_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T08 PASS: payment IDOR — fake ID returned 0 rows';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T08 FAIL: payment IDOR — % rows leaked!', v_count;
  END IF;

  -- ── T09: Audit log isolation ────────────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM audit_log
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T09 PASS: audit_log — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T09 FAIL: audit_log — leaked % entries!', v_count;
  END IF;

  -- ── T10: Visa records isolation ─────────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM visa_applications
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T10 PASS: visa_applications — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T10 FAIL: visa_applications — leaked % rows!', v_count;
  END IF;

  -- ── T11: Journal entries isolation ─────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM journal_entries
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T11 PASS: journal_entries — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T11 FAIL: journal_entries — leaked % rows!', v_count;
  END IF;

  -- ── T12: Import batch isolation ─────────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM import_batches
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T12 PASS: import_batches — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T12 FAIL: import_batches — leaked % rows!', v_count;
  END IF;

  -- ── T13: Export history isolation ───────────────────────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM export_history
  WHERE agency_id = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T13 PASS: export_history — no rows for fake agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T13 FAIL: export_history — leaked % rows!', v_count;
  END IF;

  -- ── T14: current_staff_agency_id() must return real agency ─────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM (SELECT current_staff_agency_id() AS aid) sub
  WHERE aid IS NULL OR aid = fake_agency_id;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T14 PASS: current_staff_agency_id() returns valid real agency';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T14 FAIL: current_staff_agency_id() returned NULL or fake agency!';
  END IF;

  -- ── T15: is_staff() returns TRUE for current user ───────────────────────
  v_total := v_total + 1;
  SELECT count(*) INTO v_count
  FROM (SELECT is_staff() AS s) sub
  WHERE NOT s;
  IF v_count = 0 THEN
    v_passed := v_passed + 1;
    RAISE NOTICE 'T15 PASS: is_staff() returns TRUE for current session';
  ELSE
    v_failed := v_failed + 1;
    RAISE WARNING 'T15 FAIL: is_staff() returned FALSE — auth issue!';
  END IF;

  -- ── SUMMARY ─────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '=== RESULTS: % / % tests passed ===', v_passed, v_total;
  IF v_failed = 0 THEN
    RAISE NOTICE '✅ ALL TESTS PASSED — No BOLA/IDOR vulnerabilities detected.';
  ELSE
    RAISE EXCEPTION '❌ % of % BOLA/IDOR test(s) FAILED — review RLS policies immediately.', v_failed, v_total;
  END IF;

END $$;

-- ── INFORMATIONAL: RLS Status Check ────────────────────────────────────────
-- Shows which tables have RLS enabled
SELECT
  schemaname,
  tablename,
  rowsecurity,
  CASE WHEN rowsecurity THEN '✅ RLS ON' ELSE '❌ RLS OFF' END AS status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY
  rowsecurity ASC,  -- show unprotected tables first
  tablename;
