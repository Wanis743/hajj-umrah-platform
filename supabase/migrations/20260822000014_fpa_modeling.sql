-- Migration: 20260822000014_fpa_modeling.sql
-- Description: Phase 5 Modeling & Planning Tables

-- 1. fpa_models
CREATE TABLE fpa_models (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    model_type TEXT NOT NULL CHECK (model_type IN ('variable', 'constant')),
    data_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 2. fpa_formulas
CREATE TABLE fpa_formulas (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES fpa_models(id) ON DELETE CASCADE,
    expression TEXT NOT NULL,
    dependencies UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 3. fpa_scenarios
CREATE TABLE fpa_scenarios (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_version_id UUID REFERENCES fpa_scenarios(id),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 4. fpa_planning_cycles
CREATE TABLE fpa_planning_cycles (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    scenario_id UUID REFERENCES fpa_scenarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE fpa_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa_planning_cycles ENABLE ROW LEVEL SECURITY;

-- Revoke public access (Zero ANY)
REVOKE ALL ON fpa_models FROM PUBLIC;
REVOKE ALL ON fpa_formulas FROM PUBLIC;
REVOKE ALL ON fpa_scenarios FROM PUBLIC;
REVOKE ALL ON fpa_planning_cycles FROM PUBLIC;

-- RLS Policies (Authenticated Users Only)
CREATE POLICY "Allow authenticated users full access to fpa_models" ON fpa_models FOR ALL TO authenticated USING (agency_id = public.current_staff_agency_id()) WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Allow authenticated users full access to fpa_formulas" ON fpa_formulas FOR ALL TO authenticated USING (agency_id = public.current_staff_agency_id()) WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Allow authenticated users full access to fpa_scenarios" ON fpa_scenarios FOR ALL TO authenticated USING (agency_id = public.current_staff_agency_id()) WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Allow authenticated users full access to fpa_planning_cycles" ON fpa_planning_cycles FOR ALL TO authenticated USING (agency_id = public.current_staff_agency_id()) WITH CHECK (agency_id = public.current_staff_agency_id());

-- Audit Triggers (updated_at)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_fpa_models_updated_at BEFORE UPDATE ON fpa_models FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fpa_formulas_updated_at BEFORE UPDATE ON fpa_formulas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fpa_scenarios_updated_at BEFORE UPDATE ON fpa_scenarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fpa_planning_cycles_updated_at BEFORE UPDATE ON fpa_planning_cycles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
