export type HajjSeason = 'hajj_1447' | 'hajj_1446' | 'umrah_ramadan_1447' | 'umrah_rajab_1447' | 'all';
export type ReportLang = 'ar' | 'fr' | 'en';

export interface Pilgrim {
  id: string;
  reference: string;
  fullName: string;
  fullNameAr: string;
  passportNumber: string;
  nationality: string;
  nationalityAr: string;
  wilaya: string;
  wilayaCode: string;
  departureAirport: 'ALG' | 'ORN' | 'CZL' | 'AAE' | 'QSF';
  gender: 'M' | 'F';
  age: number;
  phone: string;
  email?: string;
  packageId: string;
  packageName: string;
  groupId: string;
  groupName: string;
  visaStatus: 'pending' | 'biometric_done' | 'mofa_submitted' | 'nusuk_status_manual' | 'visa_issued' | 'rejected';
  visaNumber?: string;
  hajjLottoNumber?: string;
  mahramName?: string;
  mahramRelation?: string;
  makkahHotel: string;
  madinahHotel: string;
  roomNumber?: string;
  roomType: 'Quad' | 'Triple' | 'Double' | 'Suite';
  paymentStatus: 'paid' | 'partial' | 'pending';
  totalPriceSAR: number;
  totalPriceDZD: number;
  paidAmountSAR: number;
  paidAmountDZD: number;
  healthAlerts?: string[];
  wheelchairRequired: boolean;
  rawdahPermit: boolean;
  createdAt: string;
}

export interface HajjPackage {
  id: string;
  name: string;
  nameAr: string;
  nameFr: string;
  type: 'hajj_vip' | 'hajj_premium' | 'hajj_economy' | 'umrah_ramadan' | 'umrah_standard';
  priceSAR: number;
  priceDZD: number;
  capacity: number;
  bookedCount: number;
  makkahHotel: string;
  madinahHotel: string;
  makkahNights: number;
  madinahNights: number;
  shifting: boolean;
  inclusions: string[];
  status: 'active' | 'sold_out' | 'upcoming';
}

export interface HotelInventory {
  id: string;
  city: 'Makkah' | 'Madinah';
  hotelName: string;
  hotelNameAr: string;
  starRating: number;
  distanceToHaramMeters: number;
  totalRooms: number;
  occupiedRooms: number;
  totalBeds: number;
  occupiedBeds: number;
  roomTypes: {
    quad: { count: number; occupied: number; rateSAR: number };
    triple: { count: number; occupied: number; rateSAR: number };
    double: { count: number; occupied: number; rateSAR: number };
    suite: { count: number; occupied: number; rateSAR: number };
  };
  mealPlan: 'Full Board' | 'Half Board' | 'Breakfast Only';
  managerContact: string;
}

export interface FlightLogistics {
  id: string;
  airline: string;
  flightNumber: string;
  type: 'arrival' | 'departure';
  departureCity: string;
  arrivalCity: 'Jeddah' | 'Madinah';
  terminal: string;
  departureTime: string;
  arrivalTime: string;
  totalSeats: number;
  assignedPilgrims: number;
  status: 'on_schedule' | 'delayed' | 'boarding' | 'landed';
  busFleetAssigned: string;
}

export interface BusFleet {
  id: string;
  busNumber: string;
  companyName: string;
  driverName: string;
  driverPhone: string;
  capacity: number;
  assignedGroupId: string;
  assignedGroupName: string;
  currentZone: 'Airport JED' | 'Makkah Hotel' | 'Madinah Hotel' | 'Mina Camp' | 'Arafat' | 'Muzdalifah' | 'In Transit';
  status: 'ready' | 'in_transit' | 'maintenance';
}

export interface HolySiteCamp {
  site: 'Mina' | 'Arafat' | 'Muzdalifah';
  campNumber: string;
  squareMeters: number;
  allocatedPilgrims: number;
  capacity: number;
  acUnitsWorking: number;
  totalAcUnits: number;
  cateringStatus: 'ready' | 'preparing' | 'delivered';
  shadingReady: boolean;
  jamaratSlot?: string;
}

export interface MutawwifGuide {
  id: string;
  name: string;
  nameAr: string;
  phone: string;
  languages: string[];
  assignedGroup: string;
  pilgrimCount: number;
  dutyZone: string;
  rating: number;
  status: 'on_duty' | 'break' | 'standby';
}

export interface FinancialSummary {
  totalRevenueSAR: number;
  totalRevenueDZD: number;
  collectedSAR: number;
  collectedDZD: number;
  pendingBalanceSAR: number;
  pendingBalanceDZD: number;
  totalExpensesSAR: number;
  totalExpensesDZD: number;
  netProfitSAR: number;
  netProfitDZD: number;
  nusukFeesPaidSAR: number;
  hotelExpensesSAR: number;
  flightExpensesSAR: number;
  transportExpensesSAR: number;
  cateringExpensesSAR: number;
}

export interface EmergencyIncident {
  id: string;
  pilgrimId: string;
  pilgrimName: string;
  wilaya: string;
  type: 'medical' | 'lost' | 'passport_issue' | 'transport_delay' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  location: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved';
  reportedAt: string;
  assignedGuide: string;
}

export interface RealTimeKpiData {
  totalPilgrims: number;
  confirmedReservations: number;
  pendingReservations: number;
  cancelledReservations: number;
  totalRevenueSAR: number;
  totalRevenueDZD: number;
  occupancyRatePercent: number;
  visaApprovalRatePercent: number;
  transportReadinessPercent: number;
  slaIncidentResolutionRatePercent: number;
  pilgrimSatisfactionNPS: number;
  genderBreakdown: { male: number; female: number };
  ageBreakdown: { seniors: number; adults: number; youth: number; children: number };
  wheelchairCount: number;
  rawdahPermitsIssued: number;
  liveActivityFeed: Array<{
    id: string;
    timestamp: string;
    type: 'booking' | 'visa' | 'payment' | 'hotel' | 'flight' | 'sos';
    message: string;
    messageAr: string;
    messageFr: string;
  }>;
}

export interface PdfExportOptions {
  title: string;
  titleAr: string;
  titleFr: string;
  lang: ReportLang;
  season: HajjSeason;
  includeExecutiveSummary: boolean;
  includePilgrimManifest: boolean;
  includeHotelHousing: boolean;
  includeTransport: boolean;
  includeFinancials: boolean;
  includeIncidents: boolean;
  watermark: boolean;
}
