import { safeDivide, roundTo } from '../math/arithmetic';

export interface UnitEconomicsInput {
  totalRevenue: number | null;
  totalCost: number | null;
  totalProfit: number | null;
  pilgrimCount: number | null;
  bookingCount: number | null;
  groupCount: number | null;
}

export interface UnitEconomicsResult {
  revenuePerPilgrim: number | null;
  costPerPilgrim: number | null;
  profitPerPilgrim: number | null;
  revenuePerBooking: number | null;
  profitPerBooking: number | null;
  revenuePerGroup: number | null;
  profitPerGroup: number | null;
}

export function calculateUnitEconomics(input: UnitEconomicsInput): UnitEconomicsResult {
  const { totalRevenue, totalCost, totalProfit, pilgrimCount, bookingCount, groupCount } = input;
  return {
    revenuePerPilgrim: roundTo(safeDivide(totalRevenue, pilgrimCount), 2),
    costPerPilgrim: roundTo(safeDivide(totalCost, pilgrimCount), 2),
    profitPerPilgrim: roundTo(safeDivide(totalProfit, pilgrimCount), 2),
    revenuePerBooking: roundTo(safeDivide(totalRevenue, bookingCount), 2),
    profitPerBooking: roundTo(safeDivide(totalProfit, bookingCount), 2),
    revenuePerGroup: roundTo(safeDivide(totalRevenue, groupCount), 2),
    profitPerGroup: roundTo(safeDivide(totalProfit, groupCount), 2),
  };
}
