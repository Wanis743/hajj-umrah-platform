# Final UAT Checklist

## Auth
- Login / logout
- TOTP enrollment/challenge
- Admin sensitive action blocked at AAL1

## Reservations
- Public browser -> Edge Function -> reservation
- Direct PostgREST anon insert denied
- Rate limit and Turnstile rejection

## Booking
- Confirm reservation
- Package capacity atomicity
- State transition enforcement
- Concurrent edit conflict

## Finance
- Invoice creation/numbering
- Payment posting
- Reversal posting
- Journal balance per currency
- AR/AP aging
- Bank reconciliation

## Operations
- Visa status workflow
- Room allocation collision
- Transport compliance
- Group readiness
- Manifest snapshot
- Missing pilgrim escalation

## Data / Governance
- Duplicate pilgrim detection
- Document access logging
- Audit immutability
- Export/reporting
