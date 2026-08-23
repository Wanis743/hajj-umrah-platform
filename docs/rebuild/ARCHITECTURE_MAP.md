# Rebuild Architecture Map — Verified Current State

Generated 2026-08-23 from live inspection of the frozen baseline (`v9-freeze` = zip `(11).zip`, 2026-08-22 23:01).
Every claim below was verified by direct inspection of this checkout, not inherited from prior docs.

## Baseline identity

| Fact | Value |
|---|---|
| Freeze commit | `f489a62` (tag `v9-freeze`) |
| Tracked files | ~590 |
| SQL migrations | 93 |
| Public RPC functions (per schema manifest) | ~90 |
| Stack | React 18.3 · TypeScript 5.9 · Vite 5 · Tailwind 3 · Supabase JS 2.57 |

## Front-end topology (verified)

```
App.tsx
└── AdminDashboard (src/components/admin/AdminDashboard/index.tsx)   ← tab shell, ~40 imports
    ├── OperationsOS        (src/components/admin/OperationsOS/)     ← second tab shell (spec §3 flags this pattern)
    ├── Finance OS entry    → lazy-mounts V10OperatingSystem          ← NOT the old FinanceOS/ tabs anymore
    └── ~35 legacy manager tabs (Pilgrim, Group, Hotel, CrmManager, DocumentCenter, …)
```

### The three Finance OS generations present in tree

| Generation | Location | State | Verdict per spec §49 |
|---|---|---|---|
| G1 legacy | `src/components/admin/FinanceOS/` (10 components, tab/card) | Still in tree, **no longer mounted** | Archive as reference; do not evolve |
| G2 "v10" | `src/components/admin/*/v10/` (23 components) + `V10OperatingSystem.tsx` | Mounted as `finance_os`; single-panel-per-workspace; demo-data patterns (e.g. Customer360 fetches first lead row "for demo purposes") | Violates §7/§41 (workspace model, fake data). Replace, don't patch |
| G3 target | `src/platform/**` (this rebuild) | To be built | Kernel-first per §7 |

### Existing front-end kernel sketch

`src/lib/kernel/` — 176 lines total (`KernelTypes.ts`, `CommandRegistry.ts`,
`WorkspaceRegistry.ts`, `ActionEngine.ts`). In-memory only: no persistence,
no permissions, no audit, no jobs, no events. Useful as naming precedent;
not a foundation to keep (will be superseded by `src/platform/kernel`).

## Back-end topology (verified)

```
supabase/migrations/           93 migrations; migrations #76–#93 (2026-08-21/22) are
                               phase-aligned with spec §43: platform_kernel,
                               accounting_vertical, bi_semantic_layer, crm_integration,
                               dms_integration, fpa_modeling, business_simulation,
                               controls_treasury_risk, ai_layer …
supabase/functions/            create-admin, create-reservation, export-worker, notification-worker
supabase/tests/                finance_invariants, bola_idor_security_test, security_rbac_matrix, …
docs/CURRENT_SCHEMA_SNAPSHOT.sql generated snapshot (documentary only)
```

Prior-agent remediation matrix (`docs/IMPLEMENTATION_MATRIX.md`) claims verified-proven:
double-entry primitives (COA, fiscal periods, journal entries/lines), transactional payments,
immutable reversals, invoice numbering, booking state machines + optimistic locking,
package versioning + price snapshots, RLS hardening, AAL2/MFA gate, FK indexes.

## Pure-domain engines (reuse candidates, spec §49)

`src/engine/` — 30 TS files: math (financial, statistics, correlation, outliers),
analytics (unitEconomics, rfm, abc, funnel), forecast (exponential, movingAverage),
scenario/sensitivity, booking, crm, visa, groupReadiness, hotelAllocation, flightImpact,
stateMachine, import pipeline, kpi engine. Includes 2 test files run by
`scripts/test-finance-utilities.mjs`. These are calculation-only and align with §21.

## Debt confirmed at freeze (spec §42 cross-check)

| Item | Verified measure |
|---|---|
| Explicit `any` / unsafe casts | 25 grep hits across exactly the 6 files named in §3 |
| TS suppression | 1 hit in src/ |
| Conflicting evidence artifacts | `ts_errors.txt` (428 lines) vs `final_errors.txt` (364) vs `typecheck_output.txt` (37) — mutually inconsistent |
| Legacy fix scripts at repo root | fix_all*.cjs ×4, fix_econ/index/trending/ts_again, patch_ops_os, update_close/update_finance, execute_all_evidence |
| i18n | positional helpers + mojibake risk flagged by spec §38 (spot checks pending in slice work) |

## Environment constraints

- Host: Windows 11, git-bash toolchain, Node 26/npm 11. No live Supabase project bound to this checkout (`.env.example` only) → DB/browser-dependent gates are **pending**, not PASS (§51).
- Both `bun.lock` and `package-lock.json` present; npm is the working install path here.
