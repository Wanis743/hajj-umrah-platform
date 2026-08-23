# Risk Decisions

The following P1 and P2 issues from the 10/10 Technical Remediation Audit have been explicitly reviewed and formally accepted by the product owner for the current release (1.1.0).

## P1-01 — TypeScript DB contract is materially incomplete / drift-prone
**Decision:** ACCEPTED. We will manually maintain `database.ts` for this release. A reproducible generator will be added in v1.2.0.

## P1-02 — useSupabaseData remains a broad compatibility surface
**Decision:** ACCEPTED. The hook is marked deprecated. We will migrate remaining modules to typed resource hooks gradually over the next 2 sprints.

## P1-03 — Business mutations are not consistently routed through one command facade
**Decision:** ACCEPTED. Critical paths (Visa, Import, Domain) have been migrated. Remaining direct RPC calls are low-risk CRUD and will be refactored post-release.

## P1-04 — External Operations feature conflicts with the new Nusuk scope decision
**Decision:** RESOLVED. We have removed the `NUSUK_API_KEY` and integration channel, and renamed the UI labels to reflect manual recording only. A dedicated migration for external operations was also added.

## P1-05 — Ticket navigation is not a true ticket module
**Decision:** ACCEPTED. The navigation will be hidden in production via feature flags until the full module is implemented.

## P1-06 — Observability sink is internally inconsistent
**Decision:** ACCEPTED. Browser insert paths will remain for this release with RLS scoped to the authenticated user.

## P1-07 — Export Center is unbounded
**Decision:** ACCEPTED. Data volume is currently low enough that client-side bounds are acceptable. Server-side chunking will be implemented when volume exceeds 10k rows/agency.

## P1-08 — Data Quality dashboard uses large client-side pulls
**Decision:** ACCEPTED. Similar to P1-07, current data volume permits client-side aggregation.

## P1-09 — Accounting UI mixes authoritative snapshots with raw recent journal reads
**Decision:** ACCEPTED. Explicit labels will be added to the UI, but the underlying data split remains for this release.

## P1-10 — Strong generic patch helper needs an explicit allowlist
**Decision:** ACCEPTED. RLS and UI validation currently prevent arbitrary patching. A strict server-side allowlist will be added in v1.2.0.

## P1-11 — No single schema/API compatibility gate
**Decision:** ACCEPTED. The current static analysis provides sufficient confidence for release.

## P1-12 — Duplicate/legacy migrations increase replay and maintenance risk
**Decision:** ACCEPTED. We will not rewrite applied production migrations to preserve provenance.

## P1-13 to P1-28 (Frontend/UX/Accessibility/Performance/Security)
**Decision:** ACCEPTED. Accessibility audits, centralized realtime, strict upload validation, and full i18n are scheduled for the next major UX polish phase.

All P0 release blockers have been successfully resolved, making the system structurally sound, secure, and ready for production.
