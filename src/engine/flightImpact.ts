export type FlightImpactReport = { affected_passengers: string[]; affected_groups: string[]; hotel_arrival_changes: string[]; transport_dependencies: string[]; operational_impact_score: number; recommended_actions: string[]; alerts_to_create: string[] };
export type FlightContext = { passengerIds?: string[]; groupIds?: string[]; hotelNames?: string[]; vehicleIds?: string[] };
export function analyzeFlightChange(flightId: string, changeType: 'DELAY' | 'CANCELLATION' | 'EQUIPMENT_CHANGE', newDetails: { delayHours?: number; context?: FlightContext } = {}): FlightImpactReport {
  const ctx = newDetails.context ?? {}; const passengers = ctx.passengerIds ?? []; const groups = ctx.groupIds ?? []; const hotels = ctx.hotelNames ?? []; const vehicles = ctx.vehicleIds ?? [];
  const delay = Math.max(0, newDetails.delayHours ?? 0); const score = changeType === 'CANCELLATION' ? 100 : changeType === 'DELAY' ? Math.min(100, delay * 12.5) : 35;
  const actions: string[] = [], alerts: string[] = [];
  if (changeType === 'CANCELLATION') { actions.push('Rebook affected passengers on an available alternative flight', 'Reconcile hotel and transport reservations'); alerts.push(`CRITICAL: Flight ${flightId} cancelled`); }
  else if (changeType === 'DELAY') { if (delay >= 2) actions.push('Notify hotels of revised arrival', 'Reschedule airport transfers'); alerts.push(`WARNING: Flight ${flightId} delayed by ${delay} hours`); }
  else { actions.push('Review passenger manifest and aircraft-specific constraints'); alerts.push(`WARNING: Flight ${flightId} equipment changed`); }
  return { affected_passengers: passengers, affected_groups: groups, hotel_arrival_changes: hotels.map(h => `${h}: review arrival/check-in time`), transport_dependencies: vehicles.map(v => `${v}: review transfer timing`), operational_impact_score: score, recommended_actions: actions, alerts_to_create: alerts };
}
