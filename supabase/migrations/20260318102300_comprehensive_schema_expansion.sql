-- Comprehensive Schema Expansion for Hajj/Umrah Travel Agency
-- Generated: 2026-08-10

CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    departure_date TIMESTAMPTZ,
    leader_name TEXT,
    max_capacity INTEGER DEFAULT 50,
    status TEXT DEFAULT 'FORMING',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.visas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pilgrim_id UUID NOT NULL,
    status TEXT DEFAULT 'NOT_STARTED',
    passport_number TEXT,
    issue_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.flights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flight_number TEXT NOT NULL,
    carrier TEXT NOT NULL,
    departure_airport TEXT NOT NULL,
    arrival_airport TEXT NOT NULL,
    scheduled_departure TIMESTAMPTZ,
    status TEXT DEFAULT 'SCHEDULED',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.hotels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    star_rating INTEGER,
    distance_to_haram_m INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.room_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID REFERENCES public.hotels(id),
    pilgrim_id UUID,
    room_number TEXT,
    room_type TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.transport_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_number TEXT UNIQUE,
    company TEXT,
    driver_name TEXT,
    capacity INTEGER,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'LOW',
    status TEXT DEFAULT 'DETECTED',
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pilgrim_id UUID NOT NULL,
    type TEXT NOT NULL,
    status TEXT DEFAULT 'REQUIRED',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    performance_score INTEGER DEFAULT 100,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    resource TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mutawwif_guides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT,
    status TEXT DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.holy_site_camps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL,
    camp_number TEXT NOT NULL,
    capacity INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID,
    invoice_number TEXT UNIQUE,
    total_dzd NUMERIC(12,2) DEFAULT 0,
    status TEXT DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'INFO',
    message TEXT NOT NULL,
    acknowledged BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all" ON public.groups FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "Enable all" ON public.visas FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY "Enable all" ON public.flights FOR ALL USING (false) WITH CHECK (false);

INSERT INTO public.groups (id, code, leader_name) VALUES 
('11111111-1111-1111-1111-111111111111', 'G-ALG-001', 'Ahmad') 
ON CONFLICT DO NOTHING;

INSERT INTO public.hotels (id, name, city, star_rating) VALUES 
('22222222-2222-2222-2222-222222222222', 'Swissotel', 'MAKKAH', 5) 
ON CONFLICT DO NOTHING;
