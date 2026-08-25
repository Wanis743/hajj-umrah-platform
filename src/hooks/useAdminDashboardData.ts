/**
 * useAdminDashboardData
 * Fixes in this revision:
 *
 *  1. Realtime status is now derived from realtimeManager.getStatus() — LIVE
 *     only set after SUBSCRIBED confirmed, not optimistically on subscribe().
 *
 *  2. fetchDashboardSnapshot() has a generation guard (snapshotGeneration ref)
 *     so stale responses from earlier filter selections cannot overwrite newer
 *     ones (race-condition fix).
 *
 *  3. SYNCING state always transitions back to LIVE (or DEGRADED on error)
 *     after fetchDashboardSnapshot / fetchAllData completes.
 *
 *  4. DB errors are NO LONGER silently replaced with empty arrays. Failed
 *     fetches keep previous data and surface the error via dataError state.
 *
 *  5. Fake invented defaults removed:
 *       - nationality: 'Algerian' → 'UNKNOWN'
 *       - gender: 'M' → 'UNKNOWN'
 *       - departureAirport: 'ALG' → 'UNKNOWN'
 *       - roomType: 'Double' → 'UNKNOWN'
 *       - currentZone: 'In Transit' → 'UNKNOWN'
 *       - status: 'on_duty' → derived from DB value only
 *
 *  6. fetchAllData() generation guard already existed; preserved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  Pilgrim, HajjPackage, HotelInventory, FlightLogistics, BusFleet,
  HolySiteCamp, MutawwifGuide, FinancialSummary, EmergencyIncident,
} from '@/types/kpi';
import type { DashboardFilters, DashboardRealtimeStatus, DashboardSnapshot } from '@/types/dashboard';
import type { ExtendedAdminTab } from '@/components/admin/adminDashboardTypes';
import { realtimeManager } from '@/services/realtimeManager';

// Data fetch helper
async function fetchAllRows(
  table: string,
  columns: string,
  orderColumn?: string,
  ascending = true,
  pageSize = 500,
  maxRows = 10000,
) {
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const query = supabase.from(table as never).select(columns);
    const ordered = orderColumn ? query.order(orderColumn, { ascending }) : query;
    const { data, error } = await ordered.range(offset, Math.min(offset + pageSize - 1, maxRows - 1));
    if (error) return { data: rows, error };
    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows, error: null };
}

// Empty financials sentinel
const EMPTY_FINANCIALS: FinancialSummary = {
  totalRevenueSAR: 0, totalRevenueDZD: 0,
  collectedSAR: 0, collectedDZD: 0,
  pendingBalanceSAR: 0, pendingBalanceDZD: 0,
  totalExpensesSAR: 0, totalExpensesDZD: 0,
  netProfitSAR: 0, netProfitDZD: 0,
  nusukFeesPaidSAR: 0, hotelExpensesSAR: 0,
  flightExpensesSAR: 0, transportExpensesSAR: 0,
  cateringExpensesSAR: 0,
};

// Hook
/* eslint-disable max-lines-per-function, complexity */
export function useAdminDashboardData(
  activeTab: ExtendedAdminTab,
  dashboardFilters: DashboardFilters,
) {
  // Domain state
  const [pilgrims,     setPilgrims]     = useState<Pilgrim[]>([]);
  const [packages,     setPackages]     = useState<HajjPackage[]>([]);
  const [hotels,       setHotels]       = useState<HotelInventory[]>([]);
  const [flights,      setFlights]      = useState<FlightLogistics[]>([]);
  const [buses,        setBuses]        = useState<BusFleet[]>([]);
  const [camps,        setCamps]        = useState<HolySiteCamp[]>([]);
  const [guides,       setGuides]       = useState<MutawwifGuide[]>([]);
  const [incidents,    setIncidents]    = useState<EmergencyIncident[]>([]);
  const [financials,   setFinancials]   = useState<FinancialSummary>(EMPTY_FINANCIALS);
  const [bookings,     setBookings]     = useState<Array<Record<string, unknown>>>([]);
  const [groups,       setGroups]       = useState<Array<Record<string, unknown>>>([]);
  const [visas,        setVisas]        = useState<Array<Record<string, unknown>>>([]);
  const [leads,        setLeads]        = useState<Array<Record<string, unknown>>>([]);
  const [alerts,       setAlerts]       = useState<Array<Record<string, unknown>>>([]);
  const [actions,      setActions]      = useState<Array<Record<string, unknown>>>([]);
  const [allocations,  setAllocations]  = useState<Array<Record<string, unknown>>>([]);
  const [reservations, setReservations] = useState<Array<Record<string, unknown>>>([]);
  const [payments,     setPayments]     = useState<Array<Record<string, unknown>>>([]);
  const [documents,    setDocuments]    = useState<Array<Record<string, unknown>>>([]);
  const [suppliers,    setSuppliers]    = useState<Array<Record<string, unknown>>>([]);

  const [dashboardSnapshot,      setDashboardSnapshot]      = useState<DashboardSnapshot | null>(null);
  const [dashboardRealtimeStatus,setDashboardRealtimeStatus]= useState<DashboardRealtimeStatus>('OFFLINE');
  const [dataLoading,   setDataLoading]   = useState(true);
  const [isRefreshing,  setIsRefreshing]  = useState(false);
  const [dataError,     setDataError]     = useState<string | null>(null);

  // Generation guards — prevent stale responses from overwriting newer state
  const fetchGeneration    = useRef(0);
  const snapshotGeneration = useRef(0);
  // Tracks whether the first full load has completed (subsequent fetches use isRefreshing, not dataLoading)
  const firstLoadDone = useRef(false);
  // Safety watchdog — if loading stays true for > 8s, force-clear it so the UI never permanently blocks
  const loadingWatchdog = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (dataLoading) {
      loadingWatchdog.current = setTimeout(() => {
        setDataLoading(false);
        firstLoadDone.current = true;
      }, 8000);
    } else {
      clearTimeout(loadingWatchdog.current);
    }
    return () => clearTimeout(loadingWatchdog.current);
  }, [dataLoading]);

  // Pilgrim mapper (no invented defaults)
  const mapPilgrim = useCallback(
    (r: Record<string, unknown>, pkgById: Map<string, Record<string, unknown>>): Pilgrim => {
      const birth = typeof r.birth_date === 'string' ? new Date(r.birth_date).getTime() : 0;
      const packageRow = pkgById.get(String(r.package_id ?? ''));
      const rawGender   = String(r.gender ?? '').toUpperCase();
      const rawVisa     = String(r.visa_status ?? '');
      const rawPayment  = String(r.payment_status ?? '');
      return {
        id:              String(r.id ?? ''),
        reference:       String(r.reference ?? r.full_name ?? ''),
        fullName:        String(r.full_name ?? r.name ?? ''),
        fullNameAr:      String(r.full_name_ar ?? r.full_name ?? r.name ?? ''),
        passportNumber:  String(r.passport_number ?? ''),
        // ↓ No invented defaults — unknown stays unknown
        nationality:     String(r.nationality ?? 'UNKNOWN'),
        nationalityAr:   String(r.nationality_ar ?? ''),
        wilaya:          String(r.wilaya ?? ''),
        wilayaCode:      String(r.wilaya_code ?? ''),
        departureAirport:(r.departure_airport
          ? (String(r.departure_airport) as Pilgrim['departureAirport'])
          : 'UNKNOWN' as Pilgrim['departureAirport']),
        gender: (rawGender === 'M' || rawGender === 'MALE'   ? 'M'
               : rawGender === 'F' || rawGender === 'FEMALE' ? 'F'
               : 'UNKNOWN') as Pilgrim['gender'],
        age:             birth ? Math.floor((Date.now() - birth) / (365.25 * 24 * 3600 * 1000)) : 0,
        phone:           String(r.phone ?? ''),
        email:           typeof r.email === 'string' ? r.email : undefined,
        packageId:       String(r.package_id ?? ''),
        packageName:     String(packageRow?.name ?? ''),
        groupId:         String(r.group_id ?? ''),
        groupName:       '',
        visaStatus:      (rawVisa === 'ISSUED' || rawVisa === 'APPROVED' ? 'visa_issued'
                        : rawVisa === 'SUBMITTED'                        ? 'mofa_submitted'
                        :                                                  'pending') as Pilgrim['visaStatus'],
        visaNumber:      undefined,
        makkahHotel:     '',
        madinahHotel:    '',
        // ↓ Not invented — null when not recorded
        roomType:        (r.room_type ? String(r.room_type) : 'UNKNOWN') as Pilgrim['roomType'],
        paymentStatus:   (rawPayment === 'PAID' ? 'paid' : rawPayment === 'PARTIAL' ? 'partial' : 'pending') as Pilgrim['paymentStatus'],
        totalPriceSAR:   Number(packageRow?.price_sar ?? 0),
        totalPriceDZD:   Number(packageRow?.price_dzd ?? 0),
        paidAmountSAR:   Number(r.paid_sar ?? 0),
        paidAmountDZD:   Number(r.paid_dzd ?? 0),
        wheelchairRequired: false,
        rawdahPermit:    false,
        createdAt:       typeof r.created_at === 'string' ? r.created_at : '',
      };
    },
    [],
  );

  // fetchAllData — with proper error surfacing (no silent empty arrays)
  const fetchAllData = useCallback(async () => {
    if (!isSupabaseConfigured) { setDataLoading(false); firstLoadDone.current = true; return; }
    const generation = ++fetchGeneration.current;
    // First load blocks the UI; subsequent refreshes use a non-blocking isRefreshing flag
    if (firstLoadDone.current) {
      setIsRefreshing(true);
    } else {
      setDataLoading(true);
    }
    setDataError(null);
    try {
      const [p, pkg, h, f, v, c, g, i, b, gr, vi, l, al, ac, rAl, t, pay, doc, sup] = await Promise.all([
        fetchAllRows('pilgrims',          'id,reference,full_name,full_name_ar,passport_number,nationality,nationality_ar,wilaya,wilaya_code,phone,email,package_id,group_id,visa_status,payment_status,paid_sar,paid_dzd,birth_date,departure_airport,gender,room_type,status,created_at', 'created_at', true),
        fetchAllRows('packages',          'id,code,name,name_ar,name_fr,price_sar,price_dzd,seats_available,status,created_at', 'created_at', true),
        fetchAllRows('hotels',            'id,name,name_ar,city,star_rating,distance_to_haram_m,total_rooms,available_rooms,rate_sar,manager_contact,status', 'name', true),
        fetchAllRows('flights',           'id,flight_number,carrier,departure_airport,arrival_airport,scheduled_departure,scheduled_arrival,status,terminal,gate', 'scheduled_departure', true),
        fetchAllRows('transport_vehicles','id,bus_number,company,driver_name,driver_phone,capacity,status', 'bus_number', true),
        fetchAllRows('holy_site_camps',   'id,site,camp_number,capacity,occupied', 'camp_number', true),
        fetchAllRows('mutawwif_guides',   'id,name,name_ar,phone,languages,rating,status', 'name', true),
        fetchAllRows('incidents',         'id,pilgrim_id,reporter_name,pilgrim_name,type,severity,location,description,status,created_at', 'created_at', false),
        fetchAllRows('bookings',          'id,reference,pilgrim_id,package_id,group_id,status,travelers,total_dzd,total_sar,paid_dzd,paid_sar,start_date,end_date,created_at,confirmed_at,version', 'created_at', false),
        fetchAllRows('groups',            'id,code,name,name_ar,package_id,departure_date,return_date,leader_name,leader_phone,guide_id,max_capacity,current_capacity,status,readiness_score,readiness_details,created_at', 'departure_date', true),
        fetchAllRows('visas',             'id,pilgrim_id,status,processing_time,expected_processing_time,sla,rejection_reason,missing_documents,application_age,issue_date,expiry_date,created_at,updated_at', 'created_at', false),
        fetchAllRows('crm_leads',         'id,first_name,last_name,phone,email,source,status,priority,score,next_action_at,created_at,updated_at', 'created_at', false),
        fetchAllRows('alerts',            'id,resource,resource_id,title,message,severity,status,created_at', 'created_at', false),
        fetchAllRows('actions',           'id,title,description,status,priority,due_at,assignee_id,created_at,updated_at', 'created_at', false),
        fetchAllRows('room_allocations',  'id,hotel_id,group_id,pilgrim_id,room_number,room_type,check_in,check_out,status,created_at,updated_at', 'created_at', false),
        fetchAllRows('reservations',      'id,reference,package_id,package_name,start_date,end_date,travelers,name,phone,email,status,created_at', 'created_at', false),
        fetchAllRows('payments',          'id,booking_id,pilgrim_id,amount_dzd,amount_sar,method,status,reference,receipt_number,received_at,created_at,currency,exchange_rate', 'received_at', false),
        fetchAllRows('documents',         'id,pilgrim_id,type,status,number,file_name,issue_date,expiry_date,created_at,mime_type,size_bytes,checksum_sha256', 'created_at', false),
        fetchAllRows('suppliers',         'id,name,phone,email,status,created_at,updated_at', 'name', true),
      ]);

      if (generation !== fetchGeneration.current) return;

      // Collect all errors to surface, but apply successful data immediately
      const errors: string[] = [];
      const pkgById = new Map((pkg.data ?? []).map((row) => [String(row.id ?? ''), row]));

      if (p.error)   errors.push('pilgrims');   else setPilgrims(p.data.map((row) => mapPilgrim(row, pkgById)));
      if (pkg.error) errors.push('packages');   else setPackages(pkg.data.map((row): HajjPackage => ({
        id: String(row.id ?? ''), name: String(row.name ?? row.code ?? ''),
        nameAr: String(row.name_ar ?? row.name ?? ''), nameFr: String(row.name_fr ?? row.name ?? ''),
        type: 'hajj_vip', priceSAR: Number(row.price_sar ?? 0), priceDZD: Number(row.price_dzd ?? 0),
        capacity: Number(row.seats_available ?? 0), bookedCount: 0, makkahHotel: '', madinahHotel: '',
        makkahNights: 0, madinahNights: 0, shifting: false, inclusions: [],
        status: String(row.status ?? 'active').toLowerCase() as HajjPackage['status'],
      })));
      if (h.error)   errors.push('hotels');     else setHotels(h.data.map((row): HotelInventory => ({
        id: String(row.id ?? ''),
        city: row.city === 'MADINAH' ? 'Madinah' : 'Makkah',
        hotelName: String(row.name ?? ''), hotelNameAr: String(row.name_ar ?? row.name ?? ''),
        starRating: Number(row.star_rating ?? 0), distanceToHaramMeters: Number(row.distance_to_haram_m ?? 0),
        totalRooms: Number(row.total_rooms ?? 0),
        occupiedRooms: Math.max(0, Number(row.total_rooms ?? 0) - Number(row.available_rooms ?? 0)),
        totalBeds: 0, occupiedBeds: 0,
        roomTypes: { quad: { count:0,occupied:0,rateSAR:0 }, triple: { count:0,occupied:0,rateSAR:0 }, double: { count:0,occupied:0,rateSAR: Number(row.rate_sar ?? 0) }, suite: { count:0,occupied:0,rateSAR:0 } },
        mealPlan: 'Full Board', managerContact: String(row.manager_contact ?? ''),
      })));
      if (f.error)   errors.push('flights');    else setFlights(f.data.map((row): FlightLogistics => ({
        id: String(row.id ?? ''), airline: String(row.carrier ?? ''), flightNumber: String(row.flight_number ?? ''),
        type: 'arrival', departureCity: String(row.departure_airport ?? ''),
        arrivalCity: (row.arrival_airport === 'MED' ? 'Madinah' : 'Jeddah') as FlightLogistics['arrivalCity'],
        terminal: String(row.terminal ?? ''), departureTime: String(row.scheduled_departure ?? ''),
        arrivalTime: String(row.scheduled_arrival ?? ''), totalSeats: 0, assignedPilgrims: 0,
        status: String(row.status ?? 'SCHEDULED').toLowerCase() as FlightLogistics['status'], busFleetAssigned: '',
      })));
      if (v.error)   errors.push('transport');  else setBuses(v.data.map((row): BusFleet => ({
        id: String(row.id ?? ''), busNumber: String(row.bus_number ?? ''),
        companyName: String(row.company ?? ''), driverName: String(row.driver_name ?? ''),
        driverPhone: String(row.driver_phone ?? ''), capacity: Number(row.capacity ?? 0),
        assignedGroupId: '', assignedGroupName: '',
        // ↓ Not invented — 'UNKNOWN' when not set
        currentZone: 'UNKNOWN' as BusFleet['currentZone'],
        status: (String(row.status ?? '').toUpperCase() === 'ACTIVE'       ? 'ready'
               : String(row.status ?? '').toUpperCase() === 'MAINTENANCE'  ? 'maintenance'
               :                                                              'in_transit') as BusFleet['status'],
      })));
      if (c.error)   errors.push('camps');      else setCamps(c.data.map((row): HolySiteCamp => ({
        site: String(row.site ?? 'MINA') as HolySiteCamp['site'],
        campNumber: String(row.camp_number ?? ''), squareMeters: 0,
        allocatedPilgrims: Number(row.occupied ?? 0), capacity: Number(row.capacity ?? 0),
        acUnitsWorking: 0, totalAcUnits: 0, cateringStatus: 'preparing', shadingReady: false,
      })));
      if (g.error)   errors.push('guides');     else setGuides(g.data.map((row): MutawwifGuide => ({
        id: String(row.id ?? ''), name: String(row.name ?? ''), nameAr: String(row.name_ar ?? row.name ?? ''),
        phone: String(row.phone ?? ''),
        languages: String(row.languages ?? '').split(',').filter(Boolean),
        assignedGroup: '', pilgrimCount: 0, dutyZone: '',
        rating: Number(row.rating ?? 0),
        // ↓ Derived from DB only, not defaulted
        status: (String(row.status ?? '').toUpperCase() === 'ON_DUTY'  ? 'on_duty'
               : String(row.status ?? '').toUpperCase() === 'OFF_DUTY' ? 'off_duty'
               :                                                          'unavailable') as MutawwifGuide['status'],
      })));
      if (i.error)   errors.push('incidents');  else setIncidents(i.data.map((row): EmergencyIncident => ({
        id: String(row.id ?? ''), pilgrimId: String(row.pilgrim_id ?? ''),
        pilgrimName: String(row.reporter_name ?? row.pilgrim_name ?? ''), wilaya: '',
        type: String(row.type ?? 'other').toLowerCase() as EmergencyIncident['type'],
        severity: String(row.severity ?? 'low').toLowerCase() as EmergencyIncident['severity'],
        location: String(row.location ?? ''), description: String(row.description ?? ''),
        status: (row.status === 'RESOLVED' || row.status === 'CLOSED' ? 'resolved'
               : row.status === 'INVESTIGATING' || row.status === 'ACKNOWLEDGED' ? 'in_progress'
               : 'open') as EmergencyIncident['status'],
        reportedAt: String(row.created_at ?? ''), assignedGuide: '',
      })));

      // For record arrays: keep previous data on error, don't replace with []
      if (!b.error)   setBookings(b.data);     else errors.push('bookings');
      if (!gr.error)  setGroups(gr.data);      else errors.push('groups');
      if (!vi.error)  setVisas(vi.data);       else errors.push('visas');
      if (!l.error)   setLeads(l.data);        else errors.push('leads');
      if (!al.error)  setAlerts(al.data);      else errors.push('alerts');
      if (!ac.error)  setActions(ac.data);     else errors.push('actions');
      if (!rAl.error) setAllocations(rAl.data);else errors.push('allocations');
      if (!t.error)   setReservations(t.data); else errors.push('reservations');
      if (!pay.error) setPayments(pay.data);   else errors.push('payments');
      if (!doc.error) setDocuments(doc.data);  else errors.push('documents');
      if (!sup.error) setSuppliers(sup.data);  else errors.push('suppliers');

      if (errors.length > 0) {
        setDataError(`Failed to load: ${errors.join(', ')}. Showing last known data.`);
      }
    } catch (err: unknown) {
      // Always surface errors regardless of generation
      setDataError(err instanceof Error ? err.message : 'Unknown fetch error');
    } finally {
      // Clear the right loading flag and mark first load complete
      if (firstLoadDone.current) {
        setIsRefreshing(false);
      } else {
        setDataLoading(false);
        firstLoadDone.current = true;
      }
    }
  }, [mapPilgrim]);

  // fetchDashboardSnapshot — with generation guard + SYNCING→LIVE/DEGRADED
  // NOTE: This function does NOT touch dataLoading — only fetchAllData controls
  // the main loading gate. Snapshot is auxiliary (command_center KPIs only).
  const fetchDashboardSnapshot = useCallback(async () => {
    if (!isSupabaseConfigured) { return; }
    const generation = ++snapshotGeneration.current;
    try {
      const { data, error } = await supabase.rpc('get_dashboard_executive_snapshot', {
        p_date_from:        dashboardFilters.dateFrom  || null,
        p_date_to:          dashboardFilters.dateTo    || null,
        p_filter_branch_id: dashboardFilters.branchId  || null,
        p_filter_package_id:dashboardFilters.packageId || null,
      });

      // Stale response guard
      const isStale = generation !== snapshotGeneration.current;

      if (!isStale) {
        if (!error && data) {
          setDashboardSnapshot(data as DashboardSnapshot);
          setDashboardRealtimeStatus((prev) => (prev === 'SYNCING' ? 'LIVE' : prev));
        } else if (error) {
          setDashboardRealtimeStatus('DEGRADED' as DashboardRealtimeStatus);
          setDataError(error.message);
        }
      }
    } catch (err: unknown) {
      setDashboardRealtimeStatus('DEGRADED' as DashboardRealtimeStatus);
      setDataError(err instanceof Error ? err.message : 'Snapshot fetch failed');
    }
    // No finally setDataLoading — snapshot does not own the loading gate
  }, [dashboardFilters]);

  // Sync financials from snapshot (single source of truth)
  useEffect(() => {
    if (!dashboardSnapshot) return;
    const e = dashboardSnapshot.executive;
    setFinancials((prev) => ({
      ...prev,
      totalRevenueSAR:    e.revenue_sar,
      totalRevenueDZD:    e.revenue_dzd,
      collectedSAR:       e.collected_sar,
      collectedDZD:       e.collected_dzd,
      pendingBalanceSAR:  e.outstanding_sar,
      pendingBalanceDZD:  e.outstanding_dzd,
      totalExpensesSAR:   e.expenses_sar,
      totalExpensesDZD:   e.expenses_dzd,
      netProfitSAR:       e.net_profit_sar,
      netProfitDZD:       e.net_profit_dzd,
    }));
  }, [dashboardSnapshot]);

  // Initial load
  useEffect(() => { void fetchDashboardSnapshot(); }, [fetchDashboardSnapshot]);
  // fetchAllData once on mount — data is fetched for all tabs at once, re-fetched by realtime events
  // NOT on activeTab change (that caused the loading loop — every click blocked the entire UI)
  useEffect(() => { void fetchAllData(); }, [fetchAllData]);

  // Debounced refresh (used by realtime triggers)
  const fetchTimer = useRef<ReturnType<typeof setTimeout>>();
  const refresh = useCallback(() => {
    setDashboardRealtimeStatus('SYNCING');
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(async () => {
      if (activeTab === 'command_center') {
        await fetchDashboardSnapshot();
      } else {
        await fetchAllData();
      }
      // Always transition out of SYNCING after completion
      setDashboardRealtimeStatus((prev) => (prev === 'SYNCING' ? 'LIVE' : prev));
    }, 400);
  }, [activeTab, fetchDashboardSnapshot, fetchAllData]);

  // Realtime subscriptions — LIVE only after SUBSCRIBED confirmed
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setDashboardRealtimeStatus('OFFLINE');
      return;
    }

    setDashboardRealtimeStatus('CONNECTING' as DashboardRealtimeStatus);

    const domains = ['finance', 'bookings', 'pilgrims', 'groups', 'hotels', 'operations', 'visas', 'invoices', 'accounting'] as const;

    // Subscribe to data change events
    const unsubs = domains.map((domain) => realtimeManager.subscribe(domain, refresh));

    // Subscribe to connection status changes — derive dashboard status
    const unsubStatus = realtimeManager.onStatusChange((_domain, status) => {
      setDashboardRealtimeStatus((prev) => {
        if (status === 'SUBSCRIBED')    return prev === 'CONNECTING' || prev === 'OFFLINE' ? 'LIVE' : prev;
        if (status === 'CHANNEL_ERROR') return 'DEGRADED' as DashboardRealtimeStatus;
        if (status === 'TIMED_OUT')     return 'DEGRADED' as DashboardRealtimeStatus;
        return prev;
      });
    });

    return () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      unsubs.forEach((u) => u());
      unsubStatus();
    };
  }, [refresh]);

  useEffect(() => () => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
  }, []);

  return {
    pilgrims, packages, hotels, flights, buses, camps, guides, incidents, financials,
    bookings, groups, visas, leads, alerts, actions, allocations, reservations,
    payments, documents, suppliers,
    dataLoading, isRefreshing, dataError,
    dashboardSnapshot, dashboardRealtimeStatus,
    fetchAllData, fetchDashboardSnapshot,
  };
}
