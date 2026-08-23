# Integration Certification

An adapter implementation is not integration certification.

For every external provider, UAT must record:
- health/authentication
- successful delivery/callback
- timeout
- retry
- provider rejection
- dead-letter behavior
- idempotency replay
- provider response persistence
- reconciliation

Providers include email, SMS, WhatsApp, Push, payment/bank callbacks, airline APIs.
