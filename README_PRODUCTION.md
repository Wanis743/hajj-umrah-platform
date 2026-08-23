# Hajj & Umrah Agency — Production Hardening Runbook

This repository is now split conceptually into two paths:

- **Single schema authority:** `supabase/migrations/` is the only authoritative schema history.
- **Fresh install:** replay all migrations from an empty PostgreSQL/Supabase database.
- **Derived artifacts:** `docs/generated/schema-manifest.json`, `docs/generated/schema-summary.md`, and `src/types/database.ts` are generated/derived and must never become a second schema source.

Historical migration files are kept for upgrade compatibility. They are not the recommended fresh-install source of truth.

## Implemented in this hardened pass

- Anonymous operational CRUD closed.
- Granular role/permission layer added (`ADMIN`, `OPERATIONS_MANAGER`, `VISA_AGENT`, `FINANCE`, `GUIDE`, `CRM`, `AGENT`).
- Agency + branch scope added to operational entities, with automatic branch stamping.
- Reservation reference generation is server-only.
- Public reservation intake moved behind an Edge Function with server validation and a database-backed rate limiter.
- Optional Cloudflare Turnstile verification is supported through `TURNSTILE_SECRET`.
- Booking confirmation is one atomic database RPC: pilgrim + booking + payment + capacity update + reservation status.
- Booking cancellation is atomic and releases package capacity.
- Financial entries become immutable after confirmation; reversals should be new transactions.
- Audit logs are generated server-side by database triggers and are not client-writable.
- Foreign keys and non-negative financial/capacity constraints were strengthened.
- Public package display is sourced from the database via `get_public_packages()`, rather than a second hard-coded catalog.
- Production error states no longer silently replace backend failures with fallback/demo data.
- Development sample data is isolated in `supabase/seed.dev.sql`.
- A fresh-install canonical schema is provided.

## Still requires real environment verification

The source hardening is implemented, but these require an actual Supabase/Vercel/CI environment and cannot honestly be marked passed from this offline packaging runtime:

1. `npm ci` / dependency resolution
2. `npm run typecheck`
3. `npm run lint`
4. `npm run build`
5. Supabase migration application against a real PostgreSQL instance
6. RLS integration tests with `anon`, each staff role, and multiple branches
7. End-to-end browser tests
8. Real SMS/WhatsApp/email integrations
9. Production backup/PITR restore drill
10. MFA enrollment/enforcement policy at the tenant level

## Required environment

### Frontend

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Edge Functions / server-only

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESERVATION_ALLOWED_ORIGINS` (comma-separated exact browser origins permitted to call `create-reservation`)
- `ADMIN_PROVISIONING_SECRET`
- `ADMIN_PROVISIONING_ORIGIN`
- `TURNSTILE_SECRET` (recommended for production; enables mandatory CAPTCHA verification)

Never expose a service-role key in `VITE_*` variables or client JavaScript.

## Deployment sequence

### New environment

1. Create the Supabase project.
2. Run `supabase db push` to apply the migration history.
3. Configure Auth and the first `staff_profiles` admin account.
4. Deploy `supabase/functions/create-reservation`.
5. Set the required Edge Function secrets.
6. Configure the frontend environment variables.
7. Run the verification/test suite in CI.

### Existing environment

1. Back up the database.
2. Apply the active migrations.
3. Confirm the enterprise hardening migration completed without constraint errors.
4. Verify every existing staff account has the correct agency/branch and role.
5. Re-test public reservation intake and every staff role.

## Security acceptance tests

The production gate should include: anonymous users cannot read pilgrims/payments/visas/documents/incidents/audit logs; staff from branch A cannot access branch B; finance cannot mutate confirmed payments; public reservations can only be submitted through the controlled intake path; references are never client-supplied; and a booking confirmation either completes all its required state changes or none of them.

## Build verification

Run in CI or a machine with network access and a complete dependency cache:

```bash
npm ci
npm run verify
```

The current packaging environment has no complete dependency cache; therefore a failed local `tsc` in this environment is not treated as proof of a source-level TypeScript failure.

## Critical credential note

Rotate all credentials from previous builds before production deployment, especially Supabase service-role keys and any admin password that may have appeared in older artifacts.


## Certification discipline

A release is not considered certified because a script is present. Every mandatory gate follows:

`NOT_STARTED → IMPLEMENTED → EXECUTED → PASSED`

A failed or blocked mandatory gate blocks production certification. Runtime evidence is required for fresh database replay, security/RLS/RBAC, accounting, storage, browser E2E, backup/restore, provider UAT, and transfer certification.

Schema metadata is generated with:

```bash
npm run schema:generate
npm run schema:verify
```
