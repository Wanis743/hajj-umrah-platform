-- Migration: duplicate_payment_protection

ALTER TABLE public.journal_entries 
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_idempotency_key 
ON public.journal_entries (agency_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.payments 
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key 
ON public.payments (agency_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;
