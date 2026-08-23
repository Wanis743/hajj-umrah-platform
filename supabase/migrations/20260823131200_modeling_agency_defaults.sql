-- 20260823131200_modeling_agency_defaults.sql (rebuild-authored, slice 7)
-- Stamp modeling root table's agency_id server-side from staff context
-- instead of trusting client payloads (spec section 72). Child tables
-- (model_scenarios/model_assumptions/model_projections) have no agency_id
-- column; they inherit scope through model_id -> financial_models.
ALTER TABLE public.financial_models ALTER COLUMN agency_id SET DEFAULT public.current_staff_agency_id();
