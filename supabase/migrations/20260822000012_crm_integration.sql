-- CRM Integration Migration

-- 1. Create Leads table
CREATE TABLE leads (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'NEW', -- NEW, CONTACTED, QUALIFIED, LOST
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create Opportunities table
CREATE TABLE opportunities (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'PROSPECTING', -- PROSPECTING, PROPOSAL, NEGOTIATION, CLOSED_WON, CLOSED_LOST
    amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    expected_close_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Quotes table
CREATE TABLE quotes (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    quote_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, SENT, ACCEPTED, REJECTED
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    valid_until DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create Sales Activities table
CREATE TABLE sales_activities (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL, -- CALL, EMAIL, MEETING, NOTE
    description TEXT NOT NULL,
    activity_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_activity_parent CHECK (lead_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER set_opportunities_updated_at
BEFORE UPDATE ON opportunities
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

CREATE TRIGGER set_quotes_updated_at
BEFORE UPDATE ON quotes
FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for authenticated users on leads" ON leads FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable insert access for authenticated users on leads" ON leads FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable update access for authenticated users on leads" ON leads FOR UPDATE TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable delete access for authenticated users on leads" ON leads FOR DELETE TO authenticated USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "Enable read access for authenticated users on opportunities" ON opportunities FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable insert access for authenticated users on opportunities" ON opportunities FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable update access for authenticated users on opportunities" ON opportunities FOR UPDATE TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable delete access for authenticated users on opportunities" ON opportunities FOR DELETE TO authenticated USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "Enable read access for authenticated users on quotes" ON quotes FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable insert access for authenticated users on quotes" ON quotes FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable update access for authenticated users on quotes" ON quotes FOR UPDATE TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable delete access for authenticated users on quotes" ON quotes FOR DELETE TO authenticated USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "Enable read access for authenticated users on sales_activities" ON sales_activities FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable insert access for authenticated users on sales_activities" ON sales_activities FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable update access for authenticated users on sales_activities" ON sales_activities FOR UPDATE TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Enable delete access for authenticated users on sales_activities" ON sales_activities FOR DELETE TO authenticated USING (agency_id = public.current_staff_agency_id());

-- 5. Audit Logging to audit_events kernel table
CREATE OR REPLACE FUNCTION audit_crm_action()
RETURNS TRIGGER AS $$
DECLARE
    v_row JSONB;
BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    INSERT INTO audit_events (
        actor, object_type, object_id, action, source, agency_scope, changes
    ) VALUES (
        auth.uid(),
        TG_TABLE_NAME,
        COALESCE(v_row->>'id', '')::UUID,
        TG_OP,
        'crm_integration',
        public.current_staff_agency_id()::TEXT,
        v_row
    );
    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN undefined_table THEN
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_leads
AFTER INSERT OR UPDATE OR DELETE ON leads
FOR EACH ROW EXECUTE FUNCTION audit_crm_action();

CREATE TRIGGER trg_audit_opportunities
AFTER INSERT OR UPDATE OR DELETE ON opportunities
FOR EACH ROW EXECUTE FUNCTION audit_crm_action();

CREATE TRIGGER trg_audit_quotes
AFTER INSERT OR UPDATE OR DELETE ON quotes
FOR EACH ROW EXECUTE FUNCTION audit_crm_action();

CREATE TRIGGER trg_audit_sales_activities
AFTER INSERT OR UPDATE OR DELETE ON sales_activities
FOR EACH ROW EXECUTE FUNCTION audit_crm_action();
