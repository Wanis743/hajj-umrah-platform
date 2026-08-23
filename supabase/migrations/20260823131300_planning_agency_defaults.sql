-- 20260823131300_planning_agency_defaults.sql (rebuild-authored, slice 8)
-- Stamp planning tables' agency_id server-side from staff context
-- instead of trusting client payloads (spec section 72).
ALTER TABLE public.fiscal_budgets ALTER COLUMN agency_id SET DEFAULT public.current_staff_agency_id();
