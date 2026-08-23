# Disaster Recovery Runbook

1. Enable Supabase PITR/backups for the production project.
2. Before schema migrations, capture a backup/export and record the migration version.
3. Validate migration on staging/ephemeral DB where available.
4. Apply production migration.
5. Run scripts/db-preflight.sql and the RLS/ledger checks.
6. Verify Vercel deployment and Edge Function health.
7. For recovery, restore to a timestamp immediately before the incident, validate counts and scope, then promote/switch according to the hosting plan.

Target RPO/RTO should be explicitly agreed by the agency; the repository does not invent those values.
