-- 20260823120300_audit_logs_actor.sql (rebuild-authored, slice-3 support)
--
-- The reviewed accounting RPCs write actor_id to audit_logs; that column was
-- added on the previous dev database by a migration absent from this repo's
-- history. Add it idempotently (spec section 64: audit events carry the actor).

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS actor_id UUID;
