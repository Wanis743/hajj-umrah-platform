# Maintainability Architecture

## Boundaries

```text
UI components
  -> domain hooks
     -> repositories / RPC clients
        -> Supabase/Postgres
```

Business rules live in `src/engine` as pure functions. Transactional authority lives in Postgres RPC/state-transition functions. UI components must not mutate critical tables directly.

## Data access

`useSupabaseData` is a compatibility adapter only. New code should use the resource hooks:
- `useQueryResource`
- `usePaginatedResource`
- `useRealtimeResource`
- `useResourceMutation`
- `useResourceSearch`

Realtime is owned by `src/services/realtimeManager.ts` and is deduplicated by domain.

## Commands

`src/services/domainCommands.ts` is a business command facade. Command names describe business intent (`transition*`, `verify*`, `allocate*`, `create*`) and call authorized database functions. Generic direct table mutation is prohibited for protected domains.

## Types

`src/types/database.ts` is the central application DB contract. The canonical schema is `supabase/migrations`. Generated/derived artifacts must never become a second schema source.

## Error model

All service/domain errors are normalized to `AppError` codes. UI code may display `AppError.message`; SQL/driver messages must not be leaked.

## Logging

Application logging must go through the structured logger with PII redaction and correlation IDs. Domain/service code must not use `console.*`.

## File-size discipline

Existing legacy components may remain large until touched, but all new code must keep components under the configured ESLint line budget. New domain behavior belongs in hooks/services/engine rather than component files.

## Release hygiene

Development-only directories such as `.agents`, `.kiro`, scratch reports and local prompts are excluded from the release package. Migration history, audit evidence, security tests, checksums and architecture documentation are retained because they are part of product provenance and due diligence.
