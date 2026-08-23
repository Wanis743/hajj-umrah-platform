export interface PilgrimSummary {
  id: string;
  full_name: string;
  reference?: string;
  passport_number?: string;
}

export interface PackageSummary {
  id: string;
  name: string;
  name_ar?: string;
  name_fr?: string;
}

export interface BookingWorkspaceData {
  id: string;
  reference?: string;
  status?: string;
  payment_status?: string;
  created_at?: string;
  pilgrims?: PilgrimSummary;
  packages?: PackageSummary;
  total_dzd?: number;
  paid_dzd?: number;
  travelers?: number;
}

export interface GroupWorkspaceData {
  id: string;
  code?: string;
  name?: string;
  status?: string;
  departure_date?: string;
  current_capacity?: number;
  max_capacity?: number;
  readiness_score?: number;
  created_at?: string;
  // enriched fields
  members?: number;
  missing_visas?: number;
}

export interface InvoiceWorkspaceData {
  id: string;
  invoice_number?: string;
  status?: string;
  due_date?: string;
  total_amount?: number;
  paid_amount?: number;
  currency?: string;
  created_at?: string;
  // enriched fields
  balance?: number;
  customer?: string;
}

export interface FlightWorkspaceData {
  id: string;
  flight_number?: string;
  carrier?: string;
  departure_airport?: string;
  arrival_airport?: string;
  status?: string;
  capacity?: number;
  created_at?: string;
  // enriched fields
  manifest_count?: number;
}

export interface HotelWorkspaceData {
  id: string;
  hotelName?: string;
  city?: string;
  starRating?: number;
  status?: string;
  created_at?: string;
  // enriched fields
  allocated_rooms?: number;
  occupancy?: number;
}

export interface SupplierWorkspaceData {
  id: string;
  name?: string;
  category?: string;
  status?: string;
  created_at?: string;
  // enriched fields
  balance?: number;
  active_contracts?: number;
}
