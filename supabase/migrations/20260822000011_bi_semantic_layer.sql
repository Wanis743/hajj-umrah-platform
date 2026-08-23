-- 20260822000011_bi_semantic_layer.sql

-- 1. Create bi_datasets table
CREATE TABLE public.bi_datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    schema_def JSONB NOT NULL DEFAULT '{}'::jsonb, -- holds governed dimensions
    owner UUID,
    status TEXT DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create bi_metrics table
CREATE TABLE public.bi_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    dataset_id UUID NOT NULL REFERENCES public.bi_datasets(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    formula TEXT NOT NULL,
    grain TEXT,
    owner UUID,
    status TEXT DEFAULT 'DRAFT',
    lineage JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agency_id, key)
);

-- 3. Create bi_reports table
CREATE TABLE public.bi_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    layout JSONB NOT NULL DEFAULT '{}'::jsonb,
    owner UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create bi_visualizations table
CREATE TABLE public.bi_visualizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID NOT NULL,
    report_id UUID REFERENCES public.bi_reports(id) ON DELETE SET NULL,
    dataset_id UUID REFERENCES public.bi_datasets(id) ON DELETE CASCADE,
    chart_type TEXT NOT NULL,
    measures JSONB NOT NULL DEFAULT '[]'::jsonb,
    dimensions JSONB NOT NULL DEFAULT '[]'::jsonb,
    filters JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add updated_at triggers
CREATE OR REPLACE FUNCTION public.set_bi_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_bi_datasets_updated_at BEFORE UPDATE ON public.bi_datasets FOR EACH ROW EXECUTE FUNCTION public.set_bi_updated_at();
CREATE TRIGGER set_bi_metrics_updated_at BEFORE UPDATE ON public.bi_metrics FOR EACH ROW EXECUTE FUNCTION public.set_bi_updated_at();
CREATE TRIGGER set_bi_reports_updated_at BEFORE UPDATE ON public.bi_reports FOR EACH ROW EXECUTE FUNCTION public.set_bi_updated_at();
CREATE TRIGGER set_bi_visualizations_updated_at BEFORE UPDATE ON public.bi_visualizations FOR EACH ROW EXECUTE FUNCTION public.set_bi_updated_at();

-- RLS Policies
ALTER TABLE public.bi_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bi_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bi_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bi_visualizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bi_datasets_isolation" ON public.bi_datasets
    FOR ALL USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "bi_metrics_isolation" ON public.bi_metrics
    FOR ALL USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "bi_reports_isolation" ON public.bi_reports
    FOR ALL USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "bi_visualizations_isolation" ON public.bi_visualizations
    FOR ALL USING (agency_id = public.current_staff_agency_id());

-- Audit Triggers
CREATE OR REPLACE FUNCTION public.log_bi_audit()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.audit_events (
        actor,
        object_type,
        object_id,
        action,
        source,
        agency_scope,
        changes
    ) VALUES (
        COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        TG_OP,
        'bi_semantic_layer',
        COALESCE((NEW.agency_id)::text, (OLD.agency_id)::text, 'SYSTEM'),
        jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
    );
    RETURN NULL; -- AFTER trigger
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_bi_datasets AFTER INSERT OR UPDATE OR DELETE ON public.bi_datasets FOR EACH ROW EXECUTE FUNCTION public.log_bi_audit();
CREATE TRIGGER audit_bi_metrics AFTER INSERT OR UPDATE OR DELETE ON public.bi_metrics FOR EACH ROW EXECUTE FUNCTION public.log_bi_audit();
CREATE TRIGGER audit_bi_reports AFTER INSERT OR UPDATE OR DELETE ON public.bi_reports FOR EACH ROW EXECUTE FUNCTION public.log_bi_audit();
CREATE TRIGGER audit_bi_visualizations AFTER INSERT OR UPDATE OR DELETE ON public.bi_visualizations FOR EACH ROW EXECUTE FUNCTION public.log_bi_audit();
