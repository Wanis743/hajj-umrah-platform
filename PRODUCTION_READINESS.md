# Production Readiness

## Maintainability
- Architecture boundaries enforced by `scripts/verify-maintainability.mjs`.
- Protected layers contain no explicit `any`.
- Critical state changes use business commands/RPCs.
- Legacy `useSupabaseData` is a compatibility adapter; new modules use resource hooks.
- Realtime subscriptions are centralized by domain.
- Client never contains provider API keys.

## Release gates
Static source/migration/architecture/toolchain/document/UI safety gates must pass.
Full typecheck/build/fresh-database/provider UAT are environment-dependent and must be executed in CI/release infrastructure.

## Runtime gates
- Fresh Supabase migration replay.
- Security/RBAC/BOLA/IDOR tests.
- Financial invariant tests.
- Provider sandbox UAT.
- Browser E2E/accessibility/RTL/mobile QA.
- Performance/load evidence.
