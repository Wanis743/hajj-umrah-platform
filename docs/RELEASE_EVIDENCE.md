# Release Evidence

## Automated repository checks

These checks are designed to run locally or in GitHub Actions:

- `verify:source`
- `verify:migrations`
- `verify:integrations`
- `test:readiness`
- `verify-architecture`
- `verify-toolchain-config`
- `verify-canonical-docs`
- `typecheck`
- `lint`
- `npm audit --audit-level=high`
- `build`
- `verify:fresh-db`
- `verify:e2e`

## Evidence states

- **IMPLEMENTED**: source/migration/configuration exists.
- **VERIFIED**: check executed successfully in the current environment.
- **CI-VERIFIED**: check passed in the GitHub Actions release workflow.
- **PRODUCTION-VERIFIED**: check passed against the production project without mutating production data, or with an explicitly approved transactional test.
- **EXTERNAL-UAT**: provider behavior verified with real sandbox/production credentials.

## No-cost certification path

The repository now provides a no-cost CI path using `ubuntu-latest` Docker + local Supabase. It does not create a paid Supabase preview branch.

## External release gates

Provider UAT, PITR/restore drills, and production load tests remain separately labeled and are not claimed as passed until their real environments are exercised.

## 2026-08-14 static remediation pass

The maintainability/remediation pass also includes:
- fixed the Fresh DB workflow verifier to track the repository's pinned `supabase/setup-cli` action revision;
- split reservation summary primitives out of `ReservationPage.tsx`, bringing the controller/view file below the hard 600-line component limit;
- kept the existing architecture boundary checks and migration/schema verification active;
- verified 53 migration files and the canonical schema documentation from the current repository state.

These are repository/static verifications only. Runtime certification remains dependent on the target Supabase/staging environment and a complete dependency installation.
