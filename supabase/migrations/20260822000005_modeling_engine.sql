-- P2: Modeling Engine

CREATE TABLE IF NOT EXISTS public.financial_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SIMULATED', 'APPROVED', 'ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.model_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id UUID NOT NULL REFERENCES public.financial_models(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_baseline BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.model_assumptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NOT NULL REFERENCES public.model_scenarios(id) ON DELETE CASCADE,
    variable_key TEXT NOT NULL,
    variable_value NUMERIC(14,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scenario_id, variable_key)
);

CREATE TABLE IF NOT EXISTS public.model_projections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NOT NULL REFERENCES public.model_scenarios(id) ON DELETE CASCADE,
    projected_revenue NUMERIC(14,2) NOT NULL,
    projected_cost NUMERIC(14,2) NOT NULL,
    projected_margin NUMERIC(14,2) NOT NULL,
    projected_margin_percent NUMERIC(5,2) NOT NULL,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scenario_id)
);

-- Row Level Security
ALTER TABLE public.financial_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_all ON public.financial_models FOR ALL TO authenticated USING (public.row_in_staff_scope(agency_id, NULL)) WITH CHECK (public.row_in_staff_scope(agency_id, NULL));
CREATE POLICY staff_all ON public.model_scenarios FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.financial_models m WHERE m.id = model_id AND public.row_in_staff_scope(m.agency_id, NULL)));
CREATE POLICY staff_all ON public.model_assumptions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.model_scenarios s JOIN public.financial_models m ON m.id = s.model_id WHERE s.id = scenario_id AND public.row_in_staff_scope(m.agency_id, NULL)));
CREATE POLICY staff_all ON public.model_projections FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.model_scenarios s JOIN public.financial_models m ON m.id = s.model_id WHERE s.id = scenario_id AND public.row_in_staff_scope(m.agency_id, NULL)));

-- Simulation RPC
CREATE OR REPLACE FUNCTION public.simulate_scenario(p_scenario_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $body
DECLARE
    v_target_pilgrims NUMERIC := 0;
    v_price NUMERIC := 0;
    v_flight NUMERIC := 0;
    v_hotel NUMERIC := 0;
    v_visa NUMERIC := 0;
    v_other NUMERIC := 0;
    
    v_rev NUMERIC;
    v_cost NUMERIC;
    v_margin NUMERIC;
    v_margin_pct NUMERIC;
BEGIN
    -- Extract assumptions, fallback to 0
    SELECT COALESCE(MAX(variable_value), 0) INTO v_target_pilgrims FROM public.model_assumptions WHERE scenario_id = p_scenario_id AND variable_key = 'target_pilgrims';
    SELECT COALESCE(MAX(variable_value), 0) INTO v_price FROM public.model_assumptions WHERE scenario_id = p_scenario_id AND variable_key = 'price_per_pilgrim';
    SELECT COALESCE(MAX(variable_value), 0) INTO v_flight FROM public.model_assumptions WHERE scenario_id = p_scenario_id AND variable_key = 'flight_cost_per_pilgrim';
    SELECT COALESCE(MAX(variable_value), 0) INTO v_hotel FROM public.model_assumptions WHERE scenario_id = p_scenario_id AND variable_key = 'hotel_cost_per_pilgrim';
    SELECT COALESCE(MAX(variable_value), 0) INTO v_visa FROM public.model_assumptions WHERE scenario_id = p_scenario_id AND variable_key = 'visa_cost_per_pilgrim';
    SELECT COALESCE(MAX(variable_value), 0) INTO v_other FROM public.model_assumptions WHERE scenario_id = p_scenario_id AND variable_key = 'other_cost_per_pilgrim';

    v_rev := v_target_pilgrims * v_price;
    v_cost := v_target_pilgrims * (v_flight + v_hotel + v_visa + v_other);
    v_margin := v_rev - v_cost;
    
    IF v_rev > 0 THEN
        v_margin_pct := (v_margin / v_rev) * 100;
    ELSE
        v_margin_pct := 0;
    END IF;

    -- Upsert Projection
    INSERT INTO public.model_projections (scenario_id, projected_revenue, projected_cost, projected_margin, projected_margin_percent, calculated_at)
    VALUES (p_scenario_id, v_rev, v_cost, v_margin, v_margin_pct, NOW())
    ON CONFLICT (scenario_id) DO UPDATE SET
        projected_revenue = EXCLUDED.projected_revenue,
        projected_cost = EXCLUDED.projected_cost,
        projected_margin = EXCLUDED.projected_margin,
        projected_margin_percent = EXCLUDED.projected_margin_percent,
        calculated_at = EXCLUDED.calculated_at;

    UPDATE public.financial_models SET status = 'SIMULATED' WHERE id = (SELECT model_id FROM public.model_scenarios WHERE id = p_scenario_id);

    RETURN jsonb_build_object(
        'projected_revenue', v_rev,
        'projected_cost', v_cost,
        'projected_margin', v_margin,
        'projected_margin_percent', v_margin_pct
    );
END;
$body;
