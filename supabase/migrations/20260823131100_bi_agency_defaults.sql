-- 20260823131100_bi_agency_defaults.sql (rebuild-authored)
-- BI tables require agency_id for RLS; stamp it server-side from staff context
-- instead of trusting client payloads (spec section 72).
ALTER TABLE public.bi_datasets       ALTER COLUMN agency_id SET DEFAULT public.current_staff_agency_id();
ALTER TABLE public.bi_metrics        ALTER COLUMN agency_id SET DEFAULT public.current_staff_agency_id();
ALTER TABLE public.bi_reports        ALTER COLUMN agency_id SET DEFAULT public.current_staff_agency_id();
ALTER TABLE public.bi_visualizations ALTER COLUMN agency_id SET DEFAULT public.current_staff_agency_id();
