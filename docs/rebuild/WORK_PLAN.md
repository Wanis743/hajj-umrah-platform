# Rebuild Work Plan — Dependency-Ordered, Risk-Annotated

Owner: rebuild agent · Baseline: `v9-freeze` (`f489a62`) · Spec: Master Rebuild Spec v1.0 (2026-08-22)

## Guiding decisions (from verified current state)

1. **DB primitives stay.** The Aug 21–22 migration series (platform_kernel → accounting_vertical
   → … → ai_layer) is phase-aligned with spec §43 and sits on top of proven accounting
   primitives. Rebuilding the DB from zero would violate §4 NO BLIND REWRITES.
2. **The G2 "v10" UI layer is replaced, not patched** — it repeats the page-per-feature shell
   pattern (§3/§41) and contains demo-data patterns (§4 ZERO FAKE BUSINESS DATA).
3. **One kernel, one vertical slice at a time** (§44). No new tabs until the kernel is real.
4. **Gates after every slice:** typecheck · lint · repo-wide any-gate · unit tests · fresh evidence
   log (§47). Browser/DB gates marked PENDING until a Supabase project is bound.

## Phase plan

| # | Slice | Depends on | Key deliverables | Gate | Risk |
|---|---|---|---|---|---|
| 0 | Freeze & inventory ✅ | — | git freeze tag; architecture map; this plan | committed | done |
| 1 | Kernel core | 0 | `src/platform/kernel`: types (branded IDs, Result), object registry + lifecycle state machine, command registry (confirmation rules), permission engine (resource+action+scope), audit event log | kernel unit tests green | low |
| 2 | Kernel services | 1 | event bus (typed domain events §71), job engine (idempotent jobs w/ progress+retry), workspace registry persistence (localStorage→Supabase when bound), semantic metric registry skeleton | unit tests green; no-any | medium |
| 3 | Accounting vertical slice | 2 | Journal Workbench as first true workspace: balanced-entry editor → validate → permission check → post via existing `post_journal_entry` RPC → audit trail; ledger drill-through; period guard surfaced from real fiscal_period state | E2E manual vs local supabase = PENDING if unbound | high |
| 4 | Zero-any remediation | 1–3 | Fix the 25 hits in the 6 named files with real contracts (generated DB types / discriminated unions); add `scripts/gate-no-any.mjs` to CI + test:maintainability chain; remove TS suppression debt | ANY COUNT = 0 artifact | low |
| 5 | Evidence hygiene | 0 | Quarantine conflicting artifacts (ts_errors/final_errors/typecheck_output) into docs/evidence/archive; single fresh evidence log per gate run; delete legacy fix_*.cjs after confirming no references | fresh evidence commit-bound | low |
| 6 | i18n consolidation | 4 | Replace positional translation helpers with keyed lookups; fix mojibake in Finance surfaces; RTL spot-check list | typecheck + visual check PENDING | medium |
| 7 | CRM/DMS promotion | 2 | Real Customer 360 on customer object graph (no demo rows); document object + expiry workflow on existing storage primitives | lead-to-cash traceability test | high |
| 8 | BI semantic layer | 2 | Metric registry wired to certified SQL views; chart objects per §59 contract; drill-through to objects | certified metrics only | high |
| 9 | Modeling/planning/simulation | 8 | Formula engine + dependency graph; scenario inheritance; planning cycle states; sandbox isolation | model certification checks | high |
| 10 | Controls/treasury/risk + AI layer | 9 | Continuous controls, cash/liquidity, risk register; AI only over governed commands with confirmation+audit | no fabricated facts | medium |

## Immediate next actions (this session)

1. Slice 1 — build kernel core under `src/platform/kernel/` with tests.
2. Slice 2 — events/jobs/persistence.
3. Slices 4–5 in parallel where independent.
4. Re-run all runnable gates; record evidence honestly (PENDING where environment missing).

## Explicit non-goals during slices 1–5

- No new navigation entries or tabs (§41).
- No changes to mounted legacy managers except the 6 zero-any files' type contracts.
- No deletion of G1/G2 UI until slice replacements are E2E-verified (§74 step 33).
