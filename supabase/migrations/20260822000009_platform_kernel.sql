-- Migration: 20260822000009_platform_kernel.sql

-- Set search_path
SET search_path TO public, pg_catalog;

-- Enable UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-------------------------------------------------------------------------------
-- 1. OBJECT REGISTRY
-------------------------------------------------------------------------------
CREATE TABLE object_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_type TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE object_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY object_registry_read ON object_registry FOR SELECT USING (true);

-------------------------------------------------------------------------------
-- 2. AUDIT EVENTS
-------------------------------------------------------------------------------
CREATE TABLE audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor UUID NOT NULL, -- references auth.users
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agency_scope TEXT,
    branch_scope TEXT,
    object_type TEXT NOT NULL,
    object_id UUID NOT NULL,
    correlation_id UUID,
    reason TEXT,
    source TEXT NOT NULL,
    action TEXT NOT NULL,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_read ON audit_events FOR SELECT USING (auth.uid() = actor);
CREATE POLICY audit_events_insert ON audit_events FOR INSERT WITH CHECK (auth.uid() = actor);

-------------------------------------------------------------------------------
-- 3. EVENT BUS
-------------------------------------------------------------------------------
CREATE TABLE event_bus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    publisher_id UUID NOT NULL
);

ALTER TABLE event_bus ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_bus_read ON event_bus FOR SELECT USING (true);
CREATE POLICY event_bus_insert ON event_bus FOR INSERT WITH CHECK (auth.uid() = publisher_id);

-------------------------------------------------------------------------------
-- 4. JOBS
-------------------------------------------------------------------------------
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id UUID,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress FLOAT NOT NULL DEFAULT 0.0 CHECK (progress >= 0.0 AND progress <= 100.0),
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    actor UUID NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    logs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_read ON jobs FOR SELECT USING (auth.uid() = actor);
CREATE POLICY jobs_update ON jobs FOR UPDATE USING (auth.uid() = actor);
CREATE POLICY jobs_insert ON jobs FOR INSERT WITH CHECK (auth.uid() = actor);

-------------------------------------------------------------------------------
-- 5. WORKSPACES
-------------------------------------------------------------------------------
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    name TEXT NOT NULL,
    layout JSONB NOT NULL DEFAULT '{}'::jsonb,
    views JSONB NOT NULL DEFAULT '[]'::jsonb,
    tabs JSONB NOT NULL DEFAULT '[]'::jsonb,
    pinned_objects JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspaces_read ON workspaces FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY workspaces_update ON workspaces FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY workspaces_insert ON workspaces FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY workspaces_delete ON workspaces FOR DELETE USING (auth.uid() = owner_id);

-------------------------------------------------------------------------------
-- RPCs
-------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION log_audit_event(
    p_object_type TEXT,
    p_object_id UUID,
    p_action TEXT,
    p_source TEXT,
    p_reason TEXT DEFAULT NULL,
    p_correlation_id UUID DEFAULT NULL,
    p_agency_scope TEXT DEFAULT NULL,
    p_branch_scope TEXT DEFAULT NULL,
    p_changes JSONB DEFAULT '{}'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_event_id UUID;
    v_actor UUID;
BEGIN
    v_actor := auth.uid();
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    INSERT INTO audit_events (
        actor,
        object_type,
        object_id,
        action,
        source,
        reason,
        correlation_id,
        agency_scope,
        branch_scope,
        changes
    ) VALUES (
        v_actor,
        p_object_type,
        p_object_id,
        p_action,
        p_source,
        p_reason,
        p_correlation_id,
        p_agency_scope,
        p_branch_scope,
        p_changes
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;
