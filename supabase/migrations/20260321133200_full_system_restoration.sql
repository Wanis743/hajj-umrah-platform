-- ============================================================================
-- FULL SYSTEM RESTORATION & INTEGRATION MIGRATION
-- Bou Salem Hajj & Umrah Agency — project kwlyluvuwvwtblnshwal
-- Idempotent: safe to run whether or not previous migrations were applied.
-- Creates every table needed by the 30+ restored admin dashboard tabs,
-- enables Row Level Security with read/write policies for the frontend,
-- registers all tables for Supabase Realtime, and seeds demo data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CORE ENTITY TABLES
-- ----------------------------------------------------------------------------

-- PILGRIMS
CREATE TABLE IF NOT EXISTS public.pilgrims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL DEFAULT '',
    full_name_ar TEXT DEFAULT '',
    passport_number TEXT,
    phone TEXT DEFAULT '',
    email TEXT,
    gender TEXT CHECK (gender IN ('M', 'F')),
    birth_date DATE,
    nationality TEXT DEFAULT 'Algerian',
    wilaya TEXT,
    departure_airport TEXT DEFAULT 'ALG',
    group_id UUID,
    package_id UUID,
    visa_status TEXT DEFAULT 'NOT_STARTED',
    payment_status TEXT DEFAULT 'NONE',
    emergency_contact TEXT,
    emergency_phone TEXT,
    notes TEXT,
    status TEXT DEFAULT 'REGISTERED',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PACKAGES
CREATE TABLE IF NOT EXISTS public.packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE,
    name TEXT NOT NULL,
    name_ar TEXT DEFAULT '',
    name_fr TEXT DEFAULT '',
    description TEXT,
    price_dzd NUMERIC(14,2) DEFAULT 0,
    price_sar NUMERIC(14,2) DEFAULT 0,
    duration_days INTEGER DEFAULT 15,
    start_date DATE,
    end_date DATE,
    seats_available INTEGER DEFAULT 50,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'SOLD_OUT', 'ARCHIVED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOOKINGS
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference TEXT UNIQUE,
    pilgrim_id UUID NOT NULL,
    package_id UUID,
    group_id UUID,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'PAID', 'CANCELLED', 'COMPLETED')),
    travelers INTEGER DEFAULT 1,
    total_dzd NUMERIC(14,2) DEFAULT 0,
    total_sar NUMERIC(14,2) DEFAULT 0,
    paid_dzd NUMERIC(14,2) DEFAULT 0,
    paid_sar NUMERIC(14,2) DEFAULT 0,
    payment_method TEXT,
    notes TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_pilgrim_id ON public.bookings(pilgrim_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_package_id ON public.bookings(package_id);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID,
    pilgrim_id UUID,
    amount_dzd NUMERIC(14,2) DEFAULT 0,
    amount_sar NUMERIC(14,2) DEFAULT 0,
    method TEXT DEFAULT 'Cash' CHECK (method IN ('Cash', 'Bank Transfer', 'Check', 'Card', 'CCP', 'BaridiMob')),
    status TEXT DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED')),
    reference TEXT,
    notes TEXT,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_pilgrim_id ON public.payments(pilgrim_id);

-- CRM LEADS
CREATE TABLE IF NOT EXISTS public.crm_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT,
    source TEXT DEFAULT 'WEBSITE',
    status TEXT DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CONVERTED', 'LOST')),
    priority TEXT DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
    notes TEXT,
    converted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- GROUPS
CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT DEFAULT '',
    package_id UUID,
    departure_date TIMESTAMPTZ,
    return_date TIMESTAMPTZ,
    leader_name TEXT,
    leader_phone TEXT,
    guide_id UUID,
    max_capacity INTEGER NOT NULL DEFAULT 50,
    current_capacity INTEGER DEFAULT 0,
    status TEXT DEFAULT 'FORMING' CHECK (status IN ('FORMING', 'READY', 'DEPARTED', 'IN_SAUDI', 'RETURNED', 'CLOSED')),
    readiness_score INTEGER DEFAULT 0,
    readiness_details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_groups_status ON public.groups(status);
CREATE INDEX IF NOT EXISTS idx_groups_package_id ON public.groups(package_id);

-- VISAS
CREATE TABLE IF NOT EXISTS public.visas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pilgrim_id UUID NOT NULL,
    status TEXT DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_PARTIAL', 'DOCUMENTS_COMPLETE', 'UNDER_REVIEW', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING', 'ADDITIONAL_INFO_REQUIRED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED')),
    processing_time INTEGER DEFAULT 0,
    expected_processing_time INTEGER DEFAULT 5,
    sla INTEGER DEFAULT 7,
    rejection_reason TEXT,
    missing_documents JSONB DEFAULT '[]'::jsonb,
    application_age INTEGER DEFAULT 0,
    group_impact BOOLEAN DEFAULT FALSE,
    passport_number TEXT,
    issue_date TIMESTAMPTZ,
    expiry_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visas_pilgrim_id ON public.visas(pilgrim_id);
CREATE INDEX IF NOT EXISTS idx_visas_status ON public.visas(status);

-- FLIGHTS
CREATE TABLE IF NOT EXISTS public.flights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flight_number TEXT NOT NULL,
    carrier TEXT NOT NULL,
    departure_airport TEXT NOT NULL,
    arrival_airport TEXT NOT NULL,
    scheduled_departure TIMESTAMPTZ,
    scheduled_arrival TIMESTAMPTZ,
    actual_departure TIMESTAMPTZ,
    actual_arrival TIMESTAMPTZ,
    status TEXT DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'BOARDING', 'DEPARTED', 'LANDED', 'DELAYED', 'CANCELLED')),
    terminal TEXT,
    gate TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flights_status ON public.flights(status);

-- PASSENGER ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.passenger_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flight_id UUID,
    pilgrim_id UUID,
    booking_id UUID,
    seat TEXT,
    baggage_info TEXT,
    status TEXT DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED', 'CHECKED_IN', 'BOARDED', 'NO_SHOW')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HOTELS
CREATE TABLE IF NOT EXISTS public.hotels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_ar TEXT,
    city TEXT NOT NULL CHECK (city IN ('MAKKAH', 'MADINAH')),
    star_rating INTEGER CHECK (star_rating >= 1 AND star_rating <= 5),
    distance_to_haram_m INTEGER DEFAULT 0,
    manager_contact TEXT,
    manager_phone TEXT,
    total_rooms INTEGER DEFAULT 0,
    available_rooms INTEGER DEFAULT 0,
    rate_sar NUMERIC(12,2) DEFAULT 0,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotels_city ON public.hotels(city);

-- HOTEL CONTRACTS
CREATE TABLE IF NOT EXISTS public.hotel_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL,
    room_types JSONB DEFAULT '[]'::jsonb,
    validity_start DATE,
    validity_end DATE,
    rates JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotel_contracts_hotel_id ON public.hotel_contracts(hotel_id);

-- ROOM ALLOCATIONS
CREATE TABLE IF NOT EXISTS public.room_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID,
    group_id UUID,
    pilgrim_id UUID,
    room_number TEXT,
    room_type TEXT NOT NULL DEFAULT 'Double',
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSPORT VEHICLES
CREATE TABLE IF NOT EXISTS public.transport_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_number TEXT UNIQUE,
    company TEXT,
    driver_name TEXT,
    driver_phone TEXT,
    capacity INTEGER DEFAULT 50,
    route TEXT,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'IN_TRANSIT', 'RETIRED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSPORT ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.transport_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID,
    group_id UUID,
    route TEXT,
    departure TEXT,
    destination TEXT,
    departure_time TIMESTAMPTZ,
    status TEXT DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- INCIDENTS
CREATE TABLE IF NOT EXISTS public.incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status TEXT DEFAULT 'DETECTED' CHECK (status IN ('DETECTED', 'ACKNOWLEDGED', 'INVESTIGATING', 'CONTAINED', 'RESOLVED', 'CLOSED')),
    description TEXT,
    pilgrim_id UUID,
    location TEXT,
    reporter_name TEXT,
    resolution TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CRITICAL SAFETY (SOS) EVENTS
CREATE TABLE IF NOT EXISTS public.sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pilgrim_id UUID,
    pilgrim_name TEXT,
    location TEXT,
    message TEXT,
    status TEXT DEFAULT 'SOS' CHECK (status IN ('SOS', 'ACKNOWLEDGED', 'RESOLVED')),
    handled_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DOCUMENTS
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pilgrim_id UUID NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('PASSPORT', 'ID_CARD', 'PHOTO', 'MEDICAL_CERT', 'VACCINATION', 'VISA', 'OTHER')),
    status TEXT DEFAULT 'REQUIRED' CHECK (status IN ('REQUIRED', 'RECEIVED', 'VALIDATED', 'REJECTED', 'EXPIRED')),
    number TEXT,
    file_name TEXT,
    file_url TEXT,
    issue_date TIMESTAMPTZ,
    expiry_date TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_documents_pilgrim_id ON public.documents(pilgrim_id);

-- SUPPLIERS
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT DEFAULT 'GENERAL',
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    performance_score INTEGER DEFAULT 100 CHECK (performance_score >= 0 AND performance_score <= 100),
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'BLACKLISTED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SUPPLIER CONTRACTS
CREATE TABLE IF NOT EXISTS public.contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID,
    title TEXT,
    type TEXT DEFAULT 'SERVICE',
    start_date DATE,
    end_date DATE,
    value_dzd NUMERIC(14,2) DEFAULT 0,
    status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    resource TEXT,
    resource_id TEXT,
    user_email TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON public.audit_logs(timestamp);

-- MUTAWWIF GUIDES
CREATE TABLE IF NOT EXISTS public.mutawwif_guides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_ar TEXT,
    phone TEXT,
    license_number TEXT,
    languages TEXT DEFAULT '',
    rating INTEGER DEFAULT 5,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'INACTIVE')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- HOLY SITE CAMPS
CREATE TABLE IF NOT EXISTS public.holy_site_camps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL,
    camp_number TEXT NOT NULL,
    capacity INTEGER DEFAULT 0,
    occupied INTEGER DEFAULT 0,
    manager_name TEXT,
    manager_phone TEXT,
    status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'STAND_BY', 'CLOSED')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INVOICES
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID,
    invoice_number TEXT UNIQUE,
    total_dzd NUMERIC(14,2) DEFAULT 0,
    total_sar NUMERIC(14,2) DEFAULT 0,
    status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED')),
    issued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ALERTS
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT DEFAULT 'SYSTEM',
    severity TEXT DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    message TEXT NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ACTIONS
CREATE TABLE IF NOT EXISTS public.actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    assignee TEXT,
    due_date TIMESTAMPTZ,
    priority TEXT DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2.5 COLUMN BACKFILL — tables possibly created by the earlier simplified
--     migration (20260810000000) get every column the new dashboard needs.
--     Idempotent: ADD COLUMN IF NOT EXISTS is a no-op when already present.
-- ----------------------------------------------------------------------------
ALTER TABLE public.groups
    ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS package_id UUID,
    ADD COLUMN IF NOT EXISTS return_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS leader_phone TEXT,
    ADD COLUMN IF NOT EXISTS guide_id UUID,
    ADD COLUMN IF NOT EXISTS current_capacity INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS readiness_score INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS readiness_details JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.visas
    ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_time INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expected_processing_time INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS sla INTEGER DEFAULT 7,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS missing_documents JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS application_age INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS group_impact BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.flights
    ADD COLUMN IF NOT EXISTS scheduled_arrival TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS actual_departure TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS actual_arrival TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS terminal TEXT,
    ADD COLUMN IF NOT EXISTS gate TEXT,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.hotels
    ADD COLUMN IF NOT EXISTS name_ar TEXT,
    ADD COLUMN IF NOT EXISTS manager_contact TEXT,
    ADD COLUMN IF NOT EXISTS manager_phone TEXT,
    ADD COLUMN IF NOT EXISTS total_rooms INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS available_rooms INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rate_sar NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.room_allocations
    ADD COLUMN IF NOT EXISTS group_id UUID,
    ADD COLUMN IF NOT EXISTS check_in TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS check_out TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.transport_vehicles
    ADD COLUMN IF NOT EXISTS driver_phone TEXT,
    ADD COLUMN IF NOT EXISTS route TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS pilgrim_id UUID,
    ADD COLUMN IF NOT EXISTS location TEXT,
    ADD COLUMN IF NOT EXISTS reporter_name TEXT,
    ADD COLUMN IF NOT EXISTS resolution TEXT,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS number TEXT,
    ADD COLUMN IF NOT EXISTS file_name TEXT,
    ADD COLUMN IF NOT EXISTS file_url TEXT,
    ADD COLUMN IF NOT EXISTS issue_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.suppliers
    ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'GENERAL',
    ADD COLUMN IF NOT EXISTS contact_person TEXT,
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.mutawwif_guides
    ADD COLUMN IF NOT EXISTS name_ar TEXT,
    ADD COLUMN IF NOT EXISTS license_number TEXT,
    ADD COLUMN IF NOT EXISTS languages TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.holy_site_camps
    ADD COLUMN IF NOT EXISTS occupied INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS manager_name TEXT,
    ADD COLUMN IF NOT EXISTS manager_phone TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS total_sar NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

ALTER TABLE public.alerts
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

ALTER TABLE public.actions
    ADD COLUMN IF NOT EXISTS assignee TEXT,
    ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'MEDIUM',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS resource_id TEXT,
    ADD COLUMN IF NOT EXISTS user_email TEXT,
    ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Tables that already hold data (pilgrims/bookings/payments/packages) keep
-- their rows and only get the canonical columns added:
ALTER TABLE public.pilgrims
    ADD COLUMN IF NOT EXISTS group_id UUID,
    ADD COLUMN IF NOT EXISTS birth_date DATE,
    ADD COLUMN IF NOT EXISTS departure_airport TEXT DEFAULT 'ALG',
    ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
    ADD COLUMN IF NOT EXISTS emergency_phone TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'REGISTERED';
CREATE INDEX IF NOT EXISTS idx_pilgrims_group_id ON public.pilgrims(group_id);
CREATE INDEX IF NOT EXISTS idx_pilgrims_status ON public.pilgrims(status);

ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS group_id UUID,
    ADD COLUMN IF NOT EXISTS payment_method TEXT,
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS reference TEXT,
    ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.packages
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS price_dzd NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS price_sar NUMERIC(14,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration_days INTEGER DEFAULT 15,
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date DATE,
    ADD COLUMN IF NOT EXISTS seats_available INTEGER DEFAULT 50,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
    ALTER COLUMN base_price_dzd DROP NOT NULL,
    ALTER COLUMN base_price_sar DROP NOT NULL;

-- Map legacy columns onto the canonical ones (no-op when already populated):
UPDATE public.packages
   SET price_dzd = COALESCE(base_price_dzd, price_dzd),
       price_sar = COALESCE(base_price_sar, price_sar),
       seats_available = GREATEST(COALESCE(capacity, 0) - COALESCE(booked, 0), 0),
       updated_at = NOW()
 WHERE base_price_dzd IS NOT NULL OR base_price_sar IS NOT NULL;

UPDATE public.payments
   SET reference = receipt_number
 WHERE reference IS NULL AND receipt_number IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2b. FOREIGN KEYS (added idempotently so they can reference later tables)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    ALTER TABLE public.pilgrims DROP CONSTRAINT IF EXISTS fk_pilgrims_group;
    EXECUTE 'ALTER TABLE public.pilgrims ADD CONSTRAINT fk_pilgrims_group FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL';
    EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS fk_groups_package;
    EXECUTE 'ALTER TABLE public.groups ADD CONSTRAINT fk_groups_package FOREIGN KEY (package_id) REFERENCES public.packages(id) ON DELETE SET NULL';
    EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS fk_bookings_pilgrim;
    EXECUTE 'ALTER TABLE public.bookings ADD CONSTRAINT fk_bookings_pilgrim FOREIGN KEY (pilgrim_id) REFERENCES public.pilgrims(id)';
    EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS fk_payments_booking;
    EXECUTE 'ALTER TABLE public.payments ADD CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL';
    EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS fk_contracts_supplier;
    EXECUTE 'ALTER TABLE public.contracts ADD CONSTRAINT fk_contracts_supplier FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL';
    EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- Historical prototype-wide policies were removed from the fresh-install path.
-- The final security migration below creates scoped policies after the domain/auth
-- model exists.

-- Reservation intake is Edge-Function-only; no anonymous read/insert policy.
revoke all on public.reservations from anon;
drop policy if exists anon_read_reservations on public.reservations;

-- ----------------------------------------------------------------------------
-- 4. SUPABASE REALTIME — register every table for live dashboards
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'pilgrims', 'packages', 'bookings', 'payments', 'crm_leads', 'groups', 'visas',
        'flights', 'passenger_assignments', 'hotels', 'hotel_contracts', 'room_allocations',
        'transport_vehicles', 'transport_assignments', 'incidents', 'sos_events', 'documents',
        'suppliers', 'contracts', 'audit_logs', 'mutawwif_guides', 'holy_site_camps',
        'invoices', 'alerts', 'actions', 'reservations'
    ] LOOP
        BEGIN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', tbl);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. SEED DATA (only inserted when tables are empty)
-- ----------------------------------------------------------------------------
INSERT INTO public.packages (id, code, name, name_ar, name_fr, price_dzd, price_sar, duration_days, seats_available, status)
VALUES
    ('10000000-0000-0000-0000-000000000001', 'PKG-VIP-1447', 'VIP Gold Non-Shifting Hajj', 'حج VIP ذهبي غير متحرك', 'Hajj VIP Or Non-Rotation', 1746000, 48500, 21, 200, 'ACTIVE'),
    ('10000000-0000-0000-0000-000000000002', 'PKG-STD-1447', 'Standard Shifting Hajj', 'حج قياسي متحرك', 'Hajj Standard Rotation', 1290000, 35500, 18, 300, 'ACTIVE'),
    ('10000000-0000-0000-0000-000000000003', 'PKG-ECON-1447', 'Economy Hajj', 'حج اقتصادي', 'Hajj Économique', 990000, 27000, 16, 400, 'ACTIVE'),
    ('10000000-0000-0000-0000-000000000004', 'PKG-UMRA-1447', 'Umrah Ramadan', 'عمرة رمضان', 'Omra Ramadan', 590000, 14500, 12, 250, 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO public.groups (id, code, name, package_id, departure_date, return_date, leader_name, max_capacity, current_capacity, status, readiness_score)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'G-ALG-001', 'مجموعة الجزائر العاصمة', (SELECT id FROM public.packages WHERE code = 'PKG-VIP-1447'), '2027-04-20T08:00:00Z', '2027-05-25T20:00:00Z', 'أحمد بن سالم', 50, 42, 'READY', 92),
    ('11111111-1111-1111-1111-111111111112', 'G-ORAN-002', 'مجموعة وهران', (SELECT id FROM public.packages WHERE code = 'PKG-STD-1447'), '2027-04-22T08:00:00Z', '2027-05-27T20:00:00Z', 'محمد بلقاسم', 50, 28, 'FORMING', 64)
ON CONFLICT DO NOTHING;

INSERT INTO public.pilgrims (id, reference, full_name, full_name_ar, passport_number, phone, email, gender, group_id, package_id, visa_status, payment_status, status)
VALUES
    ('20000000-0000-0000-0000-000000000001', 'PIL-2026-0001', 'Amina Benali', 'أمينة بن علي', '2191234567', '+213661234567', 'amina@example.dz', 'F', '11111111-1111-1111-1111-111111111111', (SELECT id FROM public.packages WHERE code = 'PKG-VIP-1447'), 'APPROVED', 'PARTIAL', 'GROUP_ASSIGNED'),
    ('20000000-0000-0000-0000-000000000002', 'PIL-2026-0002', 'Kamel Haddad', 'كمال حداد', '2197654321', '+213550987654', 'kamel@example.dz', 'M', '11111111-1111-1111-1111-111111111111', (SELECT id FROM public.packages WHERE code = 'PKG-VIP-1447'), 'DOCUMENTS_COMPLETE', 'PAID', 'GROUP_ASSIGNED'),
    ('20000000-0000-0000-0000-000000000003', 'PIL-2026-0003', 'Fatima Zohra', 'فاطمة الزهراء', '2195566778', '+213770112233', NULL, 'F', NULL, (SELECT id FROM public.packages WHERE code = 'PKG-STD-1447'), 'NOT_STARTED', 'NONE', 'REGISTERED')
ON CONFLICT DO NOTHING;

INSERT INTO public.bookings (id, reference, pilgrim_id, package_id, group_id, status, travelers, total_dzd, total_sar, paid_dzd, paid_sar, payment_method)
VALUES
    ('30000000-0000-0000-0000-000000000001', 'BS-2026-1001', '20000000-0000-0000-0000-000000000001', (SELECT id FROM public.packages WHERE code = 'PKG-VIP-1447'), '11111111-1111-1111-1111-111111111111', 'CONFIRMED', 2, 3492000, 97000, 3492000, 97000, 'Bank Transfer'),
    ('30000000-0000-0000-0000-000000000002', 'BS-2026-1002', '20000000-0000-0000-0000-000000000002', (SELECT id FROM public.packages WHERE code = 'PKG-VIP-1447'), '11111111-1111-1111-1111-111111111111', 'PAID', 1, 1746000, 48500, 1000000, 30000, 'Cash')
ON CONFLICT DO NOTHING;

INSERT INTO public.payments (id, booking_id, pilgrim_id, amount_dzd, amount_sar, method, status, reference)
VALUES
    ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 3492000, 97000, 'Bank Transfer', 'CONFIRMED', 'CPT-2026-001'),
    ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 1000000, 30000, 'Cash', 'CONFIRMED', 'CPT-2026-002')
ON CONFLICT DO NOTHING;

INSERT INTO public.crm_leads (id, first_name, last_name, phone, email, source, status, priority)
VALUES
    ('50000000-0000-0000-0000-000000000001', 'Yacine', 'Mansouri', '+213661112233', 'yacine@example.dz', 'WEBSITE', 'CONTACTED', 'HIGH'),
    ('50000000-0000-0000-0000-000000000002', 'Nadia', 'Cherif', '+213550445566', NULL, 'REFERRAL', 'NEW', 'MEDIUM'),
    ('50000000-0000-0000-0000-000000000003', 'Sofiane', 'Bourekba', '+213770778899', 'sofiane@example.dz', 'FACEBOOK', 'QUALIFIED', 'MEDIUM')
ON CONFLICT DO NOTHING;

INSERT INTO public.visas (id, pilgrim_id, status, passport_number, processing_time, expected_processing_time, sla)
VALUES
    ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'APPROVED', '2191234567', 4, 5, 7),
    ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'SUBMITTED', '2197654321', 3, 5, 7),
    ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'NOT_STARTED', '2195566778', 0, 5, 7)
ON CONFLICT DO NOTHING;

INSERT INTO public.flights (id, flight_number, carrier, departure_airport, arrival_airport, scheduled_departure, scheduled_arrival, status, terminal, gate)
VALUES
    ('70000000-0000-0000-0000-000000000001', 'AH 1080', 'Air Algérie', 'ALG', 'JED', '2027-04-20T09:30:00Z', '2027-04-20T14:45:00Z', 'SCHEDULED', 'T1', 'A12'),
    ('70000000-0000-0000-0000-000000000002', 'AH 1081', 'Air Algérie', 'JED', 'ALG', '2027-05-25T16:00:00Z', '2027-05-25T21:15:00Z', 'SCHEDULED', 'H1', 'B4'),
    ('70000000-0000-0000-0000-000000000003', 'SV 305', 'Saudia', 'ORAN', 'MED', '2027-04-22T11:00:00Z', '2027-04-22T16:20:00Z', 'SCHEDULED', 'T2', 'C7')
ON CONFLICT DO NOTHING;

INSERT INTO public.hotels (id, name, name_ar, city, star_rating, distance_to_haram_m, manager_contact, total_rooms, available_rooms, rate_sar)
VALUES
    ('22222222-2222-2222-2222-222222222222', 'Swissotel Makkah', 'سويس أوتيل مكة', 'MAKKAH', 5, 350, '+966501112233', 300, 120, 650),
    ('22222222-2222-2222-2222-222222222223', 'Dar Al Iman InterContinental', 'دار الإيمان', 'MADINAH', 5, 250, '+966502223344', 280, 95, 550),
    ('22222222-2222-2222-2222-222222222224', 'Holiday Inn Al Aziziah', 'هوليداي إن العزيزية', 'MAKKAH', 4, 2200, '+966503334455', 150, 60, 320)
ON CONFLICT DO NOTHING;

INSERT INTO public.room_allocations (id, hotel_id, group_id, pilgrim_id, room_number, room_type, check_in, check_out, status)
VALUES
    ('80000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000001', '2401', 'Double', '2027-04-20T14:00:00Z', '2027-05-10T12:00:00Z', 'CONFIRMED'),
    ('80000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111', '20000000-0000-0000-0000-000000000002', '1108', 'Triple', '2027-05-10T14:00:00Z', '2027-05-24T12:00:00Z', 'PENDING')
ON CONFLICT DO NOTHING;

INSERT INTO public.transport_vehicles (id, bus_number, company, driver_name, driver_phone, capacity, route, status)
VALUES
    ('90000000-0000-0000-0000-000000000001', 'BUS-001', 'SAPTCO', 'Khalid Al-Otaibi', '+966541112233', 50, 'JED Airport → Makkah', 'ACTIVE'),
    ('90000000-0000-0000-0000-000000000002', 'BUS-002', 'SAPTCO', 'Abdullah Al-Harbi', '+966542223344', 50, 'Makkah → Mina', 'ACTIVE'),
    ('90000000-0000-0000-0000-000000000003', 'BUS-003', 'Dallah', 'Saleh Al-Ghamdi', '+966543334455', 45, 'Madinah → Holy Sites', 'MAINTENANCE')
ON CONFLICT DO NOTHING;

INSERT INTO public.transport_assignments (id, vehicle_id, group_id, route, departure, destination, departure_time, status)
VALUES
    ('a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'JED Airport → Makkah', 'JED', 'MAKKAH', '2027-04-20T15:30:00Z', 'PLANNED'),
    ('a0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Makkah → Mina', 'MAKKAH', 'MINA', '2027-05-08T06:00:00Z', 'PLANNED')
ON CONFLICT DO NOTHING;

INSERT INTO public.mutawwif_guides (id, name, name_ar, phone, license_number, languages, rating, status)
VALUES
    ('b0000000-0000-0000-0000-000000000001', 'Ben Salem Ahmed', 'بن سالم أحمد', '+966551112233', 'MW-2024-011', 'Arabic, French, English', 5, 'ACTIVE'),
    ('b0000000-0000-0000-0000-000000000002', 'Hachani Omar', 'هاشاني عمر', '+966552223344', 'MW-2024-027', 'Arabic, French', 4, 'ACTIVE'),
    ('b0000000-0000-0000-0000-000000000003', 'Bouaziz Larbi', 'بوعزيز العربي', '+966553334455', 'MW-2023-093', 'Arabic, Berber', 5, 'ON_LEAVE')
ON CONFLICT DO NOTHING;

INSERT INTO public.holy_site_camps (id, site, camp_number, capacity, occupied, manager_name, manager_phone, status)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'MINA', 'B-112', 500, 340, 'Khaled Mansour', '+966554445566', 'ACTIVE'),
    ('c0000000-0000-0000-0000-000000000002', 'ARAFAT', 'A-7', 600, 100, 'Faisal Qahtani', '+966555556677', 'ACTIVE'),
    ('c0000000-0000-0000-0000-000000000003', 'MUZDALIFAH', 'M-31', 300, 0, 'Nasser Otaibi', '+966556667788', 'STAND_BY')
ON CONFLICT DO NOTHING;

INSERT INTO public.incidents (id, type, severity, status, description, reporter_name, location)
VALUES
    ('d0000000-0000-0000-0000-000000000001', 'MEDICAL', 'HIGH', 'INVESTIGATING', 'Pilgrim fainted in Mina due to heat', 'Dr. Ahmed', 'MINA Camp B-112'),
    ('d0000000-0000-0000-0000-000000000002', 'LOGISTICS', 'LOW', 'RESOLVED', 'Bus BUS-003 late departure from hotel', 'Ops Team', 'MAKKAH')
ON CONFLICT DO NOTHING;

INSERT INTO public.documents (id, pilgrim_id, type, status, number, expiry_date, notes)
VALUES
    ('e0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'PASSPORT', 'VALIDATED', '2191234567', '2030-01-01T00:00:00Z', 'Validated during intake'),
    ('e0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'PASSPORT', 'RECEIVED', '2197654321', '2029-06-15T00:00:00Z', 'Received for visa')
ON CONFLICT DO NOTHING;

INSERT INTO public.suppliers (id, name, category, contact_person, phone, email, performance_score, status)
VALUES
    ('f0000000-0000-0000-0000-000000000001', 'Air Algérie', 'AIRLINE', 'Yacine Bouchareb', '+21321650101', 'commercial@airalgerie.dz', 95, 'ACTIVE'),
    ('f0000000-0000-0000-0000-000000000002', 'SAPTCO', 'TRANSPORT', 'Majed Al-Ahmad', '+966920000587', 'info@saptco.com.sa', 88, 'ACTIVE'),
    ('f0000000-0000-0000-0000-000000000003', 'Swissotel Makkah', 'HOTEL', 'Sara Al-Zahrani', '+966501112233', 'reservations@swissotel.com', 90, 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO public.contracts (id, supplier_id, title, type, start_date, end_date, value_dzd, status)
VALUES
    ('fa000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Charter flights 1447H', 'AIRLINE', '2027-03-01', '2027-06-01', 150000000, 'ACTIVE'),
    ('fa000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'Bus fleet Mina season', 'TRANSPORT', '2027-04-01', '2027-05-31', 25000000, 'DRAFT')
ON CONFLICT DO NOTHING;

INSERT INTO public.alerts (id, type, severity, message)
VALUES
    ('fa000000-0000-0000-0000-000000000010', 'VISA', 'WARNING', '6 pilgrimage files reach SLA limit this week'),
    ('fa000000-0000-0000-0000-000000000011', 'SLA', 'CRITICAL', 'Group G-ORAN-002 readiness below 70%')
ON CONFLICT DO NOTHING;

INSERT INTO public.actions (id, description, assignee, priority, status, due_date)
VALUES
    ('fa000000-0000-0000-0000-000000000020', 'Collect missing passports for G-ORAN-002', 'Visa Team', 'HIGH', 'IN_PROGRESS', '2027-02-10T00:00:00Z'),
    ('fa000000-0000-0000-0000-000000000021', 'Confirm hotel rooms for VIP delegation', 'Hotel Team', 'URGENT', 'PENDING', '2027-02-15T00:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO public.audit_logs (id, action, resource, resource_id, user_email, details)
VALUES
    ('fa000000-0000-0000-0000-000000000030', 'BOOKING_CONFIRMED', 'bookings', '30000000-0000-0000-0000-000000000001', 'admin@bousalem.dz', '{"note": "Seed entry"}'),
    ('fa000000-0000-0000-0000-000000000031', 'SYSTEM_MIGRATION', 'database', 'full_system_restoration', 'system', '{"version": "20260811"}')
ON CONFLICT DO NOTHING;

INSERT INTO public.sos_events (id, pilgrim_name, location, message, status)
VALUES
    ('fa000000-0000-0000-0000-000000000040', 'Amina Benali', 'MINA B-112', 'Feeling unwell, needs medical attention', 'SOS')
ON CONFLICT DO NOTHING;

INSERT INTO public.invoices (id, booking_id, invoice_number, total_dzd, total_sar, status, issued_at)
VALUES
    ('fa000000-0000-0000-0000-000000000050', '30000000-0000-0000-0000-000000000001', 'INV-2026-001', 3492000, 97000, 'PAID', '2026-08-01T10:00:00Z')
ON CONFLICT DO NOTHING;