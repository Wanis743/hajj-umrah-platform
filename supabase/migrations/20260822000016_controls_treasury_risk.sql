-- Migration: 20260822000016_controls_treasury_risk.sql
-- Phase 7: Controls, Treasury & Risk (Backend)

-- 1. financial_controls
CREATE TABLE IF NOT EXISTS public.financial_controls (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    control_code TEXT NOT NULL UNIQUE,
    description TEXT,
    test_population TEXT,
    exceptions TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. close_tasks
CREATE TABLE IF NOT EXISTS public.close_tasks (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_name TEXT NOT NULL,
    dependencies TEXT[],
    certification_status TEXT DEFAULT 'pending',
    owner_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. cash_positions
CREATE TABLE IF NOT EXISTS public.cash_positions (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_portfolio TEXT NOT NULL,
    expected_inflows NUMERIC DEFAULT 0,
    expected_outflows NUMERIC DEFAULT 0,
    net_position NUMERIC GENERATED ALWAYS AS (expected_inflows - expected_outflows) STORED,
    report_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. risk_events
CREATE TABLE IF NOT EXISTS public.risk_events (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    probability NUMERIC CHECK (probability >= 0 AND probability <= 100),
    impact TEXT,
    expected_exposure NUMERIC,
    mitigations TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Enforcement
ALTER TABLE public.financial_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.close_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;

-- Zero ANY RLS Policies
CREATE POLICY "Zero ANY on financial_controls" ON public.financial_controls FOR ALL USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Zero ANY on close_tasks" ON public.close_tasks FOR ALL USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Zero ANY on cash_positions" ON public.cash_positions FOR ALL USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Zero ANY on risk_events" ON public.risk_events FOR ALL USING (agency_id = public.current_staff_agency_id());

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_financial_controls_updated_at ON public.financial_controls;
CREATE TRIGGER update_financial_controls_updated_at BEFORE UPDATE ON public.financial_controls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_close_tasks_updated_at ON public.close_tasks;
CREATE TRIGGER update_close_tasks_updated_at BEFORE UPDATE ON public.close_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_cash_positions_updated_at ON public.cash_positions;
CREATE TRIGGER update_cash_positions_updated_at BEFORE UPDATE ON public.cash_positions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_risk_events_updated_at ON public.risk_events;
CREATE TRIGGER update_risk_events_updated_at BEFORE UPDATE ON public.risk_events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit Function setup
CREATE OR REPLACE FUNCTION public.audit_financial_action()
RETURNS TRIGGER AS $$
BEGIN
        INSERT INTO public.audit_events (
        actor, timestamp, agency_scope, branch_scope, object_type,
        object_id, correlation_id, reason, source, action, changes
    ) VALUES (
        auth.uid(), now(), public.current_staff_agency_id(), NULL, TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id), NULL, NULL, 'database_trigger', TG_OP,
        CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb ELSE row_to_json(NEW)::jsonb END
    );
    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN undefined_table THEN
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_financial_controls ON public.financial_controls;
CREATE TRIGGER trg_audit_financial_controls AFTER INSERT OR UPDATE OR DELETE ON public.financial_controls FOR EACH ROW EXECUTE FUNCTION public.audit_financial_action();

DROP TRIGGER IF EXISTS trg_audit_close_tasks ON public.close_tasks;
CREATE TRIGGER trg_audit_close_tasks AFTER INSERT OR UPDATE OR DELETE ON public.close_tasks FOR EACH ROW EXECUTE FUNCTION public.audit_financial_action();

DROP TRIGGER IF EXISTS trg_audit_cash_positions ON public.cash_positions;
CREATE TRIGGER trg_audit_cash_positions AFTER INSERT OR UPDATE OR DELETE ON public.cash_positions FOR EACH ROW EXECUTE FUNCTION public.audit_financial_action();

DROP TRIGGER IF EXISTS trg_audit_risk_events ON public.risk_events;
CREATE TRIGGER trg_audit_risk_events AFTER INSERT OR UPDATE OR DELETE ON public.risk_events FOR EACH ROW EXECUTE FUNCTION public.audit_financial_action();
