import { grossMarginPct } from '../math/financial';
import { roundTo } from '../math/arithmetic';

export interface SensitivityVariable {
  name: string;
  currentValue: number;
  changes: number[];   // e.g., [-20, -10, -5, 0, 5, 10, 20] (percentages)
}

export interface SensitivityResult {
  variableName: string;
  baseValue: number;
  results: {
    changePercent: number;
    newValue: number;
    newRevenue: number | null;
    newCost: number | null;
    newProfit: number | null;
    newMargin: number | null;
  }[];
}

export interface ScenarioInput {
  baseRevenue: number;
  baseCost: number;
  priceChangePct?: number;      // % change in price → affects revenue
  hotelCostChangePct?: number;  // % change in hotel cost → affects cost
  flightCostChangePct?: number; // % change in flight cost → affects cost
  occupancyChangePct?: number;  // % change in occupancy → affects revenue
  discountChangePct?: number;   // % change in discount → affects revenue
  hotelCostShare?: number;      // proportion of cost that is hotel (0-1)
  flightCostShare?: number;     // proportion of cost that is flight (0-1)
}

export interface ScenarioResult {
  inputs: ScenarioInput;
  baseRevenue: number;
  baseCost: number;
  baseProfit: number;
  baseMargin: number | null;
  scenarioRevenue: number;
  scenarioCost: number;
  scenarioProfit: number;
  scenarioMargin: number | null;
  revenueChange: number;
  costChange: number;
  profitChange: number;
  warning: 'SCENARIO_NOT_ACTUAL';
}

/**
 * Multi-variable scenario engine.
 * NOTE: Results are hypothetical. Does not modify actual data.
 */
export function runScenario(input: ScenarioInput): ScenarioResult {
  const { baseRevenue, baseCost } = input;
  const baseProfit = baseRevenue - baseCost;

  // Apply price change to revenue
  let scenarioRevenue = baseRevenue;
  if (input.priceChangePct != null) {
    scenarioRevenue *= (1 + input.priceChangePct / 100);
  }
  if (input.occupancyChangePct != null) {
    scenarioRevenue *= (1 + input.occupancyChangePct / 100);
  }
  if (input.discountChangePct != null) {
    // Discount increase reduces revenue
    scenarioRevenue *= (1 - input.discountChangePct / 100);
  }

  // Apply cost changes
  let scenarioCost = baseCost;
  if (input.hotelCostChangePct != null && input.hotelCostShare != null) {
    const hotelBase = baseCost * input.hotelCostShare;
    scenarioCost += hotelBase * (input.hotelCostChangePct / 100);
  }
  if (input.flightCostChangePct != null && input.flightCostShare != null) {
    const flightBase = baseCost * input.flightCostShare;
    scenarioCost += flightBase * (input.flightCostChangePct / 100);
  }

  const scenarioProfit = scenarioRevenue - scenarioCost;

  return {
    inputs: input,
    baseRevenue,
    baseCost,
    baseProfit: roundTo(baseProfit, 2)!,
    baseMargin: grossMarginPct(baseRevenue, baseCost),
    scenarioRevenue: roundTo(scenarioRevenue, 2)!,
    scenarioCost: roundTo(scenarioCost, 2)!,
    scenarioProfit: roundTo(scenarioProfit, 2)!,
    scenarioMargin: grossMarginPct(scenarioRevenue, scenarioCost),
    revenueChange: roundTo(scenarioRevenue - baseRevenue, 2)!,
    costChange: roundTo(scenarioCost - baseCost, 2)!,
    profitChange: roundTo(scenarioProfit - baseProfit, 2)!,
    warning: 'SCENARIO_NOT_ACTUAL',
  };
}
