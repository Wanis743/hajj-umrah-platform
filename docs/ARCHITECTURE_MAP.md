# Current Architecture Map

Generated from `supabase/migrations` and the source tree.

## Schema authority

`supabase/migrations` is the only authoritative schema history. Snapshot SQL under `docs/` is generated/documentary.

For the exact number of migrations, tables, and functions, see docs/generated/schema-summary.md.
- Public functions discovered: **90**

## Layering

```text
components/
  presentation only
       ↓
hooks/
  resource/query/cache adapters
       ↓
services/
  business commands + orchestration
       ↓
engine/
  pure domain calculations
       ↓
supabase/functions + Postgres RPC
  authoritative transactions/state machines
       ↓
Postgres
  RLS + constraints + audit
```

## High-risk mutation boundary

Critical writes must use named command functions and state transitions. Generic direct mutations are forbidden in `domainCommands.ts` and blocked by the legacy resource hook for protected tables.

## Realtime

`src/services/realtimeManager.ts` owns domain subscriptions and debounces events. Legacy resource hooks consume the manager instead of opening their own channels.

## Finance

`src/services/financeSummary.ts` is the client repository for finance summaries. Official totals come from `get_finance_summary()` and accounting/RPC sources, never from the paginated payment list.

## Maintainability gates

- `scripts/verify-maintainability.mjs`
- `scripts/verify-migrations.mjs`
- `scripts/verify-architecture.mjs`
- `scripts/verify-ui-safety.mjs`
- `scripts/verify-toolchain-config.mjs`

## Decomposition status

The previous `AdminDashboard` controller has been split from its rendering view and sidebar. The remaining large modules are tracked as explicit refactor targets. The release gate must fail when a touched component exceeds the configured size/complexity budget; legacy debt is not hidden with lint exceptions.

Current large modules:
- `src/components/admin/AdminDashboard.tsx`
- `src/components/ReservationPage.tsx`
- `src/components/admin/BookingManager.tsx`
- `src/components/admin/PilgrimManager.tsx`

No new module may increase the existing baseline without an architecture review.
