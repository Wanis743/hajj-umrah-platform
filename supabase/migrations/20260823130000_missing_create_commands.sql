-- 20260823130000_missing_create_commands.sql (rebuild-authored, slice 4 support)
--
-- The mounted UI (CrmManager and other managers) calls create_*_command RPCs
-- that were never defined in any migration -- 9 dead create buttons across
-- production screens (spec section 4: buttons either work or do not exist;
-- section 51: build the capability rather than faking the UI).
--
-- Fix: one generic SECURITY DEFINER insert helper in the exact style of the
-- existing patch_scoped_command_row / delete_scoped_command_row helpers
-- (20260630134500_business_command_adapters), plus thin named wrappers with
-- stable business names. Agency/branch scope is stamped server-side from the
-- caller's staff context (never trusted from the client payload); RLS-style
-- scope predicates are enforced inside the dynamic INSERT.
--
-- Payload keys that don't match real columns are ignored; NOT NULL columns
-- without defaults will still fail loudly (correct behavior).

CREATE OR REPLACE FUNCTION public.insert_scoped_command_row(
    p_table REGCLASS,
    p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
    v_table_name TEXT;
    v_has_agency BOOLEAN;
    v_has_branch BOOLEAN;
    v_cols       TEXT;
    v_values     TEXT;
    v_using      TEXT;
    v_sql        TEXT;
    v_row        JSONB;
BEGIN
    IF p_payload IS NULL OR p_payload = '{}'::JSONB THEN
        RAISE EXCEPTION 'Command payload is empty' USING ERRCODE = '22023';
    END IF;

    v_table_name := regexp_replace(p_table::text, '^.*\.', '');

    SELECT exists(SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name=v_table_name AND column_name='agency_id')
      INTO v_has_agency;
    SELECT exists(SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name=v_table_name AND column_name='branch_id')
      INTO v_has_branch;

    -- Build explicit column/value list from payload keys that match real columns,
    -- excluding server-owned columns.
    SELECT string_agg(quote_ident(column_name), ', '),
           string_agg(format('($1 ->> %L)::%s', column_name, data_type::regtype::text), ', ')
      INTO v_cols, v_values
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = v_table_name
      AND column_name  = ANY (ARRAY(SELECT jsonb_object_keys(p_payload)))
      AND column_name NOT IN ('id', 'agency_id', 'branch_id', 'created_at', 'updated_at');

    IF v_cols IS NULL THEN
        RAISE EXCEPTION 'No valid insert columns for command table %', v_table_name USING ERRCODE = '22023';
    END IF;

    IF v_has_agency THEN
        v_cols := v_cols || ', agency_id';
        v_values := v_values || ', public.current_staff_agency_id()';
    END IF;
    IF v_has_branch THEN
        v_cols := v_cols || ', branch_id';
        v_values := v_values || ', public.staff_branch_id()';
    END IF;

    v_sql := format('insert into %s (%s) values (%s) returning to_jsonb(%s.*)', p_table, v_cols, v_values, p_table);

    EXECUTE v_sql INTO v_row USING p_payload;
    RETURN v_row;
END;
$fn$;

-- Thin named wrappers (stable business names; UI contract unchanged)

CREATE OR REPLACE FUNCTION public.create_crm_lead_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.crm_leads'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_incident_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.incidents'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_sos_event_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.sos_events'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_transport_vehicle_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.transport_vehicles'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_transport_assignment_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.transport_assignments'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_hotel_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.hotels'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_package_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.packages'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_flight_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.flights'::REGCLASS, p_payload);
$w$;

CREATE OR REPLACE FUNCTION public.create_camp_command(p_payload JSONB)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path=public,pg_catalog AS $w$
  SELECT public.insert_scoped_command_row('public.holy_site_camps'::REGCLASS, p_payload);
$w$;

REVOKE ALL ON FUNCTION public.insert_scoped_command_row(REGCLASS, JSONB) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_crm_lead_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_incident_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sos_event_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transport_vehicle_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transport_assignment_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_hotel_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_package_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_flight_command(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_camp_command(JSONB) TO authenticated;
