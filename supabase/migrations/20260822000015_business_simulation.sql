-- Migration: 20260822000015_business_simulation.sql
-- Description: Tables for Phase 6: Business Simulation (Backend)

CREATE TABLE simulation_jobs (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('monte_carlo', 'sensitivity', 'scenario')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g., seed, version, iterations
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE simulation_results (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES simulation_jobs(id) ON DELETE CASCADE,
    result_data JSONB NOT NULL DEFAULT '{}'::jsonb, -- distributions, percentiles, probability outputs
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE optimization_jobs (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    objective_function JSONB NOT NULL DEFAULT '{}'::jsonb,
    feasible_solutions JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE optimization_constraints (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES optimization_jobs(id) ON DELETE CASCADE,
    constraint_type VARCHAR(100) NOT NULL, -- resource allocation, scheduling, etc.
    constraint_expression JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE simulation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_constraints ENABLE ROW LEVEL SECURITY;

-- Zero ANY (deny by default, only allow authenticated owners)
CREATE POLICY "Users can manage their own simulation_jobs" ON simulation_jobs
    FOR ALL TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can manage their simulation_results via jobs" ON simulation_results
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM simulation_jobs j WHERE j.id = simulation_results.job_id AND j.created_by = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM simulation_jobs j WHERE j.id = simulation_results.job_id AND j.created_by = auth.uid()));

CREATE POLICY "Users can manage their own optimization_jobs" ON optimization_jobs
    FOR ALL TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can manage optimization_constraints via jobs" ON optimization_constraints
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM optimization_jobs j WHERE j.id = optimization_constraints.job_id AND j.created_by = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM optimization_jobs j WHERE j.id = optimization_constraints.job_id AND j.created_by = auth.uid()));

-- Audit Triggers (Assuming a common update_updated_at_column function exists, or we recreate it)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_simulation_jobs_updated_at
    BEFORE UPDATE ON simulation_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_simulation_results_updated_at
    BEFORE UPDATE ON simulation_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_optimization_jobs_updated_at
    BEFORE UPDATE ON optimization_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_optimization_constraints_updated_at
    BEFORE UPDATE ON optimization_constraints
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
