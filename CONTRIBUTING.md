# Contributing

## Architecture rule

UI components do presentation. Domain hooks own data access and cache interaction. Services orchestrate business commands. `src/engine` contains pure deterministic rules. PostgreSQL functions/state machines are authoritative for transactional mutations and financial truth.

## Required checks

Before opening a PR:

```bash
npm ci
npm run verify:static
npm run typecheck
npm run lint
npm run build
```

For database changes:

```bash
supabase db reset
npm run verify:security
npm run verify:accounting
```

## Maintainability rules

- Do not add direct `supabase.from()` calls to components.
- Do not add generic CRUD to `domainCommands`.
- Do not add `any` to domain/service/finance/security layers.
- Do not add `console.*` outside the structured logger.
- New components should stay below the configured line budget.
- Financial and official KPI values must come from an authoritative repository/RPC.
- New state transitions must be implemented as explicit database commands.
