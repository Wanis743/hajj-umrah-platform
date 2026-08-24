-- 20260824090400_bank_agency_defaults.sql (V12 §19)
ALTER TABLE public.bank_statements ALTER COLUMN agency_id SET DEFAULT private.current_staff_agency_id();
