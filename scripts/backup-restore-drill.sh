#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_DRILL_ENABLE:?Set BACKUP_DRILL_ENABLE=1 in a controlled restore environment.}"
: "${BACKUP_DRILL_ENV:?Set BACKUP_DRILL_ENV=staging-restore.}"
[[ "$BACKUP_DRILL_ENV" == "staging-restore" ]] || { echo 'Refusing backup drill outside staging-restore.' >&2; exit 2; }
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required.}"
: "${RESTORE_DB_URL:?RESTORE_DB_URL is required.}"
command -v pg_dump >/dev/null || { echo 'pg_dump is required'; exit 127; }
command -v psql >/dev/null || { echo 'psql is required'; exit 127; }
DUMP_FILE="${DUMP_FILE:-/tmp/agency-restore-drill.dump}"
START=$(date +%s)
pg_dump --format=custom --no-owner --no-privileges "$SUPABASE_DB_URL" > "$DUMP_FILE"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DB_URL" "$DUMP_FILE"
psql "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -c "select count(*) from public.staff_permissions; select count(*) from public.journal_entries; select count(*) from public.audit_logs;"
END=$(date +%s)
echo "RESTORE_DRILL_PASS seconds=$((END-START))"
