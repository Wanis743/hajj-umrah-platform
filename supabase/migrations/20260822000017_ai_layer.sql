-- Migration: 20260822000017_ai_layer.sql
-- Phase 8: AI Layer (Backend)

-- 1. ai_sessions
CREATE TABLE IF NOT EXISTS public.ai_sessions (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name TEXT NOT NULL,
    context TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. ai_intents
CREATE TABLE IF NOT EXISTS public.ai_intents (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
    intent_description TEXT NOT NULL,
    confidence NUMERIC,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. ai_tool_calls
CREATE TABLE IF NOT EXISTS public.ai_tool_calls (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.ai_sessions(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    arguments JSONB,
    status TEXT DEFAULT 'requires_confirmation',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Enforcement
ALTER TABLE public.ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tool_calls ENABLE ROW LEVEL SECURITY;

-- Zero ANY RLS Policies
CREATE POLICY "Zero ANY on ai_sessions" ON public.ai_sessions FOR ALL USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Zero ANY on ai_intents" ON public.ai_intents FOR ALL USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Zero ANY on ai_tool_calls" ON public.ai_tool_calls FOR ALL USING (agency_id = public.current_staff_agency_id());

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_ai_sessions_updated_at ON public.ai_sessions;
CREATE TRIGGER update_ai_sessions_updated_at BEFORE UPDATE ON public.ai_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_intents_updated_at ON public.ai_intents;
CREATE TRIGGER update_ai_intents_updated_at BEFORE UPDATE ON public.ai_intents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_tool_calls_updated_at ON public.ai_tool_calls;
CREATE TRIGGER update_ai_tool_calls_updated_at BEFORE UPDATE ON public.ai_tool_calls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit Function setup
DROP TRIGGER IF EXISTS trg_audit_ai_sessions ON public.ai_sessions;
CREATE TRIGGER trg_audit_ai_sessions AFTER INSERT OR UPDATE OR DELETE ON public.ai_sessions FOR EACH ROW EXECUTE FUNCTION public.audit_financial_action();

DROP TRIGGER IF EXISTS trg_audit_ai_intents ON public.ai_intents;
CREATE TRIGGER trg_audit_ai_intents AFTER INSERT OR UPDATE OR DELETE ON public.ai_intents FOR EACH ROW EXECUTE FUNCTION public.audit_financial_action();

DROP TRIGGER IF EXISTS trg_audit_ai_tool_calls ON public.ai_tool_calls;
CREATE TRIGGER trg_audit_ai_tool_calls AFTER INSERT OR UPDATE OR DELETE ON public.ai_tool_calls FOR EACH ROW EXECUTE FUNCTION public.audit_financial_action();
