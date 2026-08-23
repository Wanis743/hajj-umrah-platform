
-- Create an RPC to calculate a group's operational readiness score based on actual data
CREATE OR REPLACE FUNCTION get_group_readiness(p_group_id UUID)
RETURNS TABLE (
    total_pax INT,
    visas_approved INT,
    flights_ticketed INT,
    hotels_assigned INT,
    readiness_score NUMERIC
) AS $$
DECLARE
    v_total_pax INT := 0;
    v_visas INT := 0;
    v_flights INT := 0;
    v_hotels INT := 0;
    v_score NUMERIC := 0;
    v_has_transport BOOLEAN := false;
BEGIN
    -- 1. Total Pax
    SELECT COUNT(*) INTO v_total_pax FROM pilgrims WHERE group_id = p_group_id;
    
    IF v_total_pax = 0 THEN
        RETURN QUERY SELECT 0, 0, 0, 0, 0.0::NUMERIC;
        RETURN;
    END IF;

    -- 2. Visas Approved
    SELECT COUNT(*) INTO v_visas FROM pilgrims WHERE group_id = p_group_id AND visa_status = 'APPROVED';

    -- 3. Flights (Transport Assignments)
    SELECT EXISTS(SELECT 1 FROM transport_assignments WHERE group_id = p_group_id AND status = 'CONFIRMED') INTO v_has_transport;
    IF v_has_transport THEN
        v_flights := v_total_pax;
    ELSE
        v_flights := 0;
    END IF;

    -- 4. Hotels Assigned
    SELECT COUNT(DISTINCT pilgrim_id) INTO v_hotels FROM room_allocations WHERE group_id = p_group_id AND status = 'CONFIRMED' AND pilgrim_id IS NOT NULL;

    -- 5. Calculate Score (Average of the 3 metrics out of total pax)
    v_score := ((v_visas + v_flights + v_hotels)::NUMERIC / (v_total_pax * 3)::NUMERIC) * 100.0;

    RETURN QUERY SELECT 
        v_total_pax,
        v_visas,
        v_flights,
        v_hotels,
        ROUND(v_score, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
