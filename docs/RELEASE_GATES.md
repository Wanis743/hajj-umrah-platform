# Release Gates

1. `npm ci`
2. `npm run verify:source`
3. `npm run verify:migrations`
4. `npm run verify:enterprise`
5. `npm run typecheck`
6. `npm run lint`
7. `npm run build`
8. `npm run verify:fresh-db`
9. Execute `supabase/tests/security_rls.sql` against a fresh test DB with seeded role identities.
10. Execute `supabase/tests/finance_invariants.sql`.
11. Run external-provider UAT for email/SMS/WhatsApp/observability and any official API integrations.
12. Run staging restore drill and document RPO/RTO before production deployment.
