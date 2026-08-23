# E2E Certification

The full browser E2E suite is split into safe read/navigation coverage and explicit mutation coverage.

## Safe certification

Required:
- `E2E_BASE_URL`
- `E2E_TEST_EMAIL`
- `E2E_TEST_PASSWORD`
- `E2E_RUN_MUTATIONS=0`

This verifies authenticated login, primary ERP surfaces, browser console health, and failed-request detection.

## Mutation certification

Required:
- a non-production staging/test environment
- `E2E_RUN_MUTATIONS=1`
- `E2E_ALLOW_MUTATIONS=1`

The mutation suite creates a uniquely named test pilgrim and refuses to run unless explicitly enabled.

## Production safety

Mutation E2E must not be run against the production URL. CI should inject a dedicated staging URL for mutation jobs.
