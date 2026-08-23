# Final Release Gates

## Implemented
- ES2021 TypeScript target and library.
- Strict release verifier with no local-toolchain bypass.
- Generic critical mutation architecture checks.
- Edge-only reservation intake with idempotency.
- RLS/RBAC, finance, storage, audit, readiness and integration test harnesses.
- Private SECURITY DEFINER implementations with public SECURITY INVOKER wrappers.
- Safe-by-default reservation load test.
- Browser E2E harness with explicit test credentials.

## Verified in this environment
- `verify:source`
- `verify:migrations`
- `verify:integrations`
- `test:readiness`
- `verify:architecture`
- `verify-toolchain-config`
- Production: no exposed SECURITY DEFINER functions callable by `authenticated`.
- Production: `staff_permissions` has RLS enabled and client privileges denied.
- Production: Security Advisor has no remaining critical findings.

## Requires CI/staging execution
- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm run security:audit`
- `npm run build`
- Fresh DB replay with Supabase CLI/Docker.
- Full authenticated RLS matrix against seeded role identities.
- Full browser workflow with test credentials and seeded test data.
- Storage authenticated E2E.
- Controlled reservation concurrency/load test.
- Backup/PITR restore drill.
- External provider UAT: Email/SMS/WhatsApp/Push/Airline/Bank/Sentry.
- Accessibility/RTL/multilingual browser QA.

## Production-only configuration still required
Supabase Auth leaked-password protection MUST be manually enabled by the operational team via the Supabase Dashboard prior to final production sign-off. Supabase documents this as an Auth dashboard setting available on Pro and above; it is intentionally not changed by database migrations.

## Required runtime gates
- Accounting invariant/workflow execution against a real test database.
- Storage security runtime execution.
- Browser E2E execution.
- Fresh database replay with migrations, RLS, RBAC, and accounting.
- Typecheck, lint, npm audit, and production build.
