#!/usr/bin/env bash
set -euo pipefail

command -v supabase >/dev/null 2>&1 || { echo 'Supabase CLI is required'; exit 127; }
command -v docker >/dev/null 2>&1 || { echo 'Docker is required'; exit 127; }

echo '[1/5] Starting local Supabase stack'
supabase start

echo '[2/5] Resetting database from migrations'
supabase db reset --yes

echo '[3/5] Verifying migration source'
npm run verify:migrations

echo '[4/5] Verifying architecture/source'
npm run verify:source
npm run verify:migrations
node scripts/verify-architecture.mjs
node scripts/verify-toolchain-config.mjs

echo '[5/5] Running database security checks'
if command -v psql >/dev/null 2>&1; then
  DB_URL=$(supabase status -o env | awk -F= '/DB_URL=/{print substr($0,index($0,"=")+1)}')
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_rls.sql
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_full_matrix.sql
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_rbac_matrix.sql
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_storage_and_audit.sql
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/finance_invariants.sql
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/accounting_workflows.sql
else
  echo 'psql is unavailable; migration replay passed, SQL integration checks must run in CI image.'
fi

echo 'Fresh database replay completed.'
