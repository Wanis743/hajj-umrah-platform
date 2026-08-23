# Current Enterprise Architecture

## Source of truth
- PostgreSQL schema: `supabase/migrations/` only.
- Transactional business authority: PostgreSQL RPC/functions.
- TypeScript data contract: `src/types/database.ts`.
- Financial authority: accounting journal + finance summary RPCs.
- UI: presentation only; no financial or state-machine authority.

## Layers
- UI/components: rendering, user interaction, view models.
- Hooks: resource access, cache, pagination, realtime lifecycle.
- Services: domain command orchestration.
- Engine: pure deterministic domain validation.
- Database/RPC: authoritative transactional rules.

## Realtime
`src/services/realtimeManager.ts` owns one subscription per domain and debounces invalidation.

## Release
Development tooling is excluded from delivery packages. Provenance, migrations, security tests and release evidence remain preserved.
