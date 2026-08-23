import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { normalizeError } from '@/lib/errors';
import type { FlightRow, TransportAssignmentRow, TransportVehicleRow, VisaRow, PilgrimRow } from '@/types/database';

/**
 * Dedicated, read-only resource hooks for protected (critical) domain tables.
 *
 * These hooks are intentionally separate from the deprecated generic data layer:
 * they expose SELECT only. Every write for these resources must go through the
 * domain command layer in `@/services/domainCommands` (Supabase RPC).
 */
export interface DomainResource<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const FLIGHT_COLUMNS =
  'id,flight_number,carrier,departure_airport,arrival_airport,scheduled_departure,scheduled_arrival,actual_departure,actual_arrival,status,terminal,gate,created_at,updated_at';
const VEHICLE_COLUMNS = 'id,bus_number,company,driver_name,driver_phone,capacity,route,status,created_at,updated_at';
const ASSIGNMENT_COLUMNS =
  'id,vehicle_id,group_id,route,departure,destination,departure_time,arrival_time,status,created_at,updated_at';
const VISA_COLUMNS =
  'id,pilgrim_id,status,processing_time,expected_processing_time,sla,rejection_reason,missing_documents,application_age,issue_date,expiry_date,created_at,updated_at';
const PILGRIM_DIRECTORY_COLUMNS = 'id,full_name,full_name_ar,passport_number,visa_status';

function useReadResource<T>(
  resource: string,
  columns: string,
  options?: { limit?: number; order?: string; fallback?: T[] },
): DomainResource<T> {
  const { limit = 100, order = 'created_at', fallback } = options ?? {};
  const [data, setData] = useState<T[]>(fallback ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refetch = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError('Supabase is not configured');
      return;
    }
    const current = ++generation.current;
    setLoading(true);
    try {
      const { data: rows, error: queryError } = await supabase
        .from(resource)
        .select(columns)
        .order(order, { ascending: false })
        .range(0, Math.min(Math.max(limit, 1), 200) - 1);
      if (queryError) throw queryError;
      if (current !== generation.current) return;
      setData((rows as T[]) ?? []);
      setError(null);
    } catch (err) {
      // Always surface error; stale guard only prevents data clobber below
      setError(normalizeError(err).message);
    } finally {
      // Always clear loading — generation guard only applies to data updates
      setLoading(false);
    }
  }, [resource, columns, order, limit]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

export const useFlights = (limit = 100): DomainResource<FlightRow> =>
  useReadResource<FlightRow>('flights', FLIGHT_COLUMNS, { limit });

export const useTransportVehicles = (limit = 100): DomainResource<TransportVehicleRow> =>
  useReadResource<TransportVehicleRow>('transport_vehicles', VEHICLE_COLUMNS, { limit });

export const useTransportAssignments = (limit = 200): DomainResource<TransportAssignmentRow> =>
  useReadResource<TransportAssignmentRow>('transport_assignments', ASSIGNMENT_COLUMNS, { limit });

export const useVisas = (limit = 200): DomainResource<VisaRow> =>
  useReadResource<VisaRow>('visas', VISA_COLUMNS, { limit });

export const usePilgrimDirectory = (limit = 200): DomainResource<PilgrimRow> =>
  useReadResource<PilgrimRow>('pilgrims', PILGRIM_DIRECTORY_COLUMNS, { limit });
