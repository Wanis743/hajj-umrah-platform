# External Integration Readiness

The application is provider-agnostic by design. No vendor credential is hard-coded.

## Email / SMS / WhatsApp / Push

The database writes notification intents to `notification_queue`. Delivery workers are expected to consume queued jobs and call the configured provider adapter.

Required production secrets are provider-specific and must never use `VITE_` prefixes:

- `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`
- `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_FROM`
- `WHATSAPP_PROVIDER`, `WHATSAPP_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`
- `PUSH_PROVIDER`, `PUSH_API_KEY`

Workers must implement retries with exponential backoff and a dead-letter state.

## Observability

Set a server-side Sentry DSN (or another approved provider) in the deployment environment and route unhandled Edge Function/server failures through it. Client code must not contain secret DSNs with privileged write access.

## Airline / Bank

Only enable adapters after receiving an approved official API contract and credentials. The UI may track workflow status, but must not claim an official integration until the actual API adapter is deployed and verified.

## Turnstile

`TURNSTILE_SECRET` is server-only and is validated inside the public reservation Edge Function.

## Acceptance criteria

An integration is considered production-ready only after:

1. credentials exist in the secret manager,
2. provider health check succeeds,
3. one sandbox transaction completes,
4. retry/dead-letter handling is verified,
5. audit correlation is present,
6. production runbook is updated.
