-- Migration: DMS Integration
-- Creates documents, document_versions, evidence_packages, extraction_jobs

-- 1. Create Enums
CREATE TYPE document_status AS ENUM ('draft', 'active', 'archived');
CREATE TYPE extraction_job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- 2. Create tables
CREATE TABLE public.documents (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    status document_status NOT NULL DEFAULT 'draft',
    title TEXT NOT NULL,
    document_type TEXT NOT NULL,
    polymorphic_id UUID,
    polymorphic_type TEXT,
    workspace_id TEXT NOT NULL
);

CREATE TABLE public.document_versions (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE public.evidence_packages (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    polymorphic_id UUID,
    polymorphic_type TEXT,
    workspace_id TEXT NOT NULL
);

CREATE TABLE public.evidence_package_documents (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    evidence_package_id UUID NOT NULL REFERENCES public.evidence_packages(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (evidence_package_id, document_id)
);

CREATE TABLE public.extraction_jobs (
    agency_id UUID DEFAULT public.current_staff_agency_id(),
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    status extraction_job_status NOT NULL DEFAULT 'pending',
    extracted_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_package_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_jobs ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies
CREATE POLICY "Authenticated users can read documents" ON public.documents FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can insert documents" ON public.documents FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can update documents" ON public.documents FOR UPDATE TO authenticated USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "Authenticated users can read document_versions" ON public.document_versions FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can insert document_versions" ON public.document_versions FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());

CREATE POLICY "Authenticated users can read evidence_packages" ON public.evidence_packages FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can insert evidence_packages" ON public.evidence_packages FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can update evidence_packages" ON public.evidence_packages FOR UPDATE TO authenticated USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "Authenticated users can read evidence_package_documents" ON public.evidence_package_documents FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can insert evidence_package_documents" ON public.evidence_package_documents FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can delete evidence_package_documents" ON public.evidence_package_documents FOR DELETE TO authenticated USING (agency_id = public.current_staff_agency_id());

CREATE POLICY "Authenticated users can read extraction_jobs" ON public.extraction_jobs FOR SELECT TO authenticated USING (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can insert extraction_jobs" ON public.extraction_jobs FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_staff_agency_id());
CREATE POLICY "Authenticated users can update extraction_jobs" ON public.extraction_jobs FOR UPDATE TO authenticated USING (agency_id = public.current_staff_agency_id());

-- 5. Add triggers for updated_at (if function exists, use it, else create)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        CREATE FUNCTION public.update_updated_at_column()
        RETURNS TRIGGER AS $func$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
    END IF;
END
$$;

CREATE TRIGGER handle_updated_at_documents BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER handle_updated_at_evidence_packages BEFORE UPDATE ON public.evidence_packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER handle_updated_at_extraction_jobs BEFORE UPDATE ON public.extraction_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
