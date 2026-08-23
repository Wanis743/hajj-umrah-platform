export type AllocationResult = { success: boolean; allocations?: Array<{ allocationId: string; hotelId: string; groupId: string; roomType: string; count: number }>; error?: string };
export type HotelInventorySnapshot = { hotelId: string; totalRooms: number; occupiedRooms: number; availabilityByType?: Record<string, number> };
export function checkAvailability(hotel: HotelInventorySnapshot, roomType: string) {
  const available = hotel.availabilityByType?.[roomType] ?? Math.max(0, hotel.totalRooms - hotel.occupiedRooms);
  return { hotelId: hotel.hotelId, roomType, availableRooms: available };
}
export function allocateRooms(groupId: string, hotel: HotelInventorySnapshot, roomRequirements: { type: string; count: number }[]): AllocationResult {
  const allocations = [] as NonNullable<AllocationResult['allocations']>;
  for (const req of roomRequirements) {
    if (!Number.isInteger(req.count) || req.count < 1) return { success: false, error: `Invalid room quantity for ${req.type}` };
    const avail = checkAvailability(hotel, req.type);
    if (avail.availableRooms < req.count) return { success: false, error: `Insufficient ${req.type} rooms. Required: ${req.count}, Available: ${avail.availableRooms}` };
    allocations.push({ allocationId: `alloc-${crypto.randomUUID()}`, hotelId: hotel.hotelId, groupId, roomType: req.type, count: req.count });
  }
  return { success: true, allocations };
}
export function calculateOccupancy(hotel: HotelInventorySnapshot) {
  const total = Math.max(0, hotel.totalRooms); const occupied = Math.max(0, Math.min(total, hotel.occupiedRooms));
  return { hotelId: hotel.hotelId, totalRooms: total, occupiedRooms: occupied, occupancyRate: total ? (occupied / total) * 100 : 0, availableRooms: total - occupied };
}
