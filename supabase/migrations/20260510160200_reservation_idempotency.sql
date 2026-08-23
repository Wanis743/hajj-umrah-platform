ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_idempotency_key ON public.reservations(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_request_hash ON public.reservations(request_hash) WHERE request_hash IS NOT NULL;
