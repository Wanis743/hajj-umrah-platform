#!/usr/bin/env bash
# Fresh-database replay: bring up a clean local Supabase stack, rebuild the schema
# from migrations alone, and run the SQL suites against it.
#
# Two things were wrong with this script, and both made it report success it had
# not earned:
#
#   1. Every suite ran as `psql -v ON_ERROR_STOP=1 -f …`. Six of them are written
#      as reports — `select 'x' as check_name, <bool> as pass;` — which print a
#      row and exit 0 whether `pass` is t or f. They now run through
#      scripts/run-sql-gate.mjs, which reads the `pass` column and fails on f.
#   2. When psql was absent it printed "migration replay passed, SQL integration
#      checks must run in CI image" and exited 0, so a machine without a psql
#      client turned the entire database gate into a pass. It now exits 127.
set -euo pipefail

command -v supabase >/dev/null 2>&1 || { echo 'Supabase CLI is required'; exit 127; }
command -v docker >/dev/null 2>&1 || { echo 'Docker is required'; exit 127; }
command -v psql >/dev/null 2>&1 || {
  echo 'psql is required: without it the SQL suites cannot run, and skipping them silently is what produced a VERIFIED manifest over unrun tests.' >&2
  exit 127
}

echo '[1/5] Starting local Supabase stack'
supabase start

echo '[2/5] Resetting database from migrations'
supabase db reset --yes

echo '[3/5] Verifying migration source'
npm run verify:migrations

echo '[4/5] Verifying architecture/source'
npm run verify:source
node scripts/verify-architecture.mjs
node scripts/verify-toolchain-config.mjs

echo '[5/5] Running database security checks against the fresh schema'
DB_URL=$(supabase status -o env | awk -F= '/DB_URL=/{print substr($0,index($0,"=")+1)}')
[[ -n "$DB_URL" ]] || { echo 'Could not read DB_URL from `supabase status`.' >&2; exit 1; }

# run-sql-gate.mjs reads SUPABASE_DB_URL, so point it at the throwaway stack —
# exported for this command only, never overwriting an ambient value.
#
# bola_idor_security_test.sql is deliberately not in this list. It reads across
# agencies as a staff user, and the local stack's psql superuser bypasses row
# security, so the suite's own preflight refuses to run and fail vacuously. It
# belongs to `npm run verify:bola` against a real database with a staff session.
#
# crm_lifecycle.sql is in the list, and safely: its Part 1 answers the RLS, grant
# and policy questions from the catalog, where a superuser session cannot make the
# answer wrong, and its Part 2 asserts triggers, constraints and command guards --
# never row visibility. It also creates its own staff profile and JWT claim inside
# `begin ... rollback`, so the authorization guards are satisfied by RBAC rows
# rather than by the superuser, and nothing it writes survives the suite.
#
# dms_lifecycle.sql, bi_studio_lifecycle.sql and modeling_engine_lifecycle.sql belong
# here on that same argument, and each states it in its own header rather than
# inheriting it. All three read the
# catalog in Part 1, drive their commands inside one `begin ... rollback` in Part 2
# with auth.users rows and JWT claims they create themselves, and assert refusals
# by SQLSTATE. A superuser connection cannot soften those refusals, because the
# guards that raise them ask has_permission() about seeded RBAC rows rather than
# about the connection -- which is also how the BI suite can prove that no role at
# all holds bi_datasets.publish, and how the modeling suite can prove that an agent
# holds no read on a model. None of the three asserts that a row is invisible.
SUPABASE_DB_URL="$DB_URL" node scripts/run-sql-gate.mjs \
  supabase/tests/security_rls.sql \
  supabase/tests/security_full_matrix.sql \
  supabase/tests/security_rbac_matrix.sql \
  supabase/tests/security_storage_and_audit.sql \
  supabase/tests/security_storage_runtime.sql \
  supabase/tests/finance_invariants.sql \
  supabase/tests/accounting_workflows.sql \
  supabase/tests/crm_lifecycle.sql \
  supabase/tests/dms_lifecycle.sql \
  supabase/tests/bi_studio_lifecycle.sql \
  supabase/tests/modeling_engine_lifecycle.sql \
  supabase/tests/final_enterprise_hardening.sql \
  supabase/tests/maintainability_contracts.sql

echo 'Fresh database replay completed.'
