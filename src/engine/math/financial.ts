import {  roundTo } from './arithmetic';

/** Gross profit = revenue - cost */
export function grossProfit(revenue: number | null, cost: number | null): number | null {
  if (revenue == null || cost == null) return null;
  return revenue - cost;
}

/**
 * Gross margin = (revenue - cost) / revenue × 100
 * Formula: (gross profit / revenue) × 100
 */
export function grossMarginPct(revenue: number | null, cost: number | null): number | null {
  if (revenue == null || cost == null || revenue === 0) return null;
  return ((revenue - cost) / revenue) * 100;
}

/**
 * Markup = profit / cost × 100
 * NOTE: This is different from margin (profit/revenue).
 */
export function markupPct(profit: number | null, cost: number | null): number | null {
  if (profit == null || cost == null || cost === 0) return null;
  return (profit / cost) * 100;
}

/**
 * ROI = (gain - cost) / cost × 100
 * Returns null if cost is 0 — denominator must be defined.
 */
export function roi(gain: number | null, cost: number | null): number | null {
  if (gain == null || cost == null || cost === 0) return null;
  return ((gain - cost) / cost) * 100;
}

/**
 * Break-even units = fixed costs / (price per unit - variable cost per unit)
 * Returns null if contribution margin ≤ 0
 */
export function breakEvenUnits(
  fixedCosts: number | null,
  pricePerUnit: number | null,
  variableCostPerUnit: number | null,
): number | null {
  if (fixedCosts == null || pricePerUnit == null || variableCostPerUnit == null) return null;
  const contribution = pricePerUnit - variableCostPerUnit;
  if (contribution <= 0) return null; // No break-even possible
  return fixedCosts / contribution;
}

/**
 * Break-even revenue = fixed costs / gross margin %
 */
export function breakEvenRevenue(
  fixedCosts: number | null,
  grossMarginPctValue: number | null,
): number | null {
  if (fixedCosts == null || grossMarginPctValue == null || grossMarginPctValue <= 0) return null;
  return (fixedCosts / grossMarginPctValue) * 100;
}

/**
 * Margin of safety = (actual - break-even) / actual × 100
 */
export function marginOfSafety(actual: number | null, breakEven: number | null): number | null {
  if (actual == null || breakEven == null || actual === 0) return null;
  return ((actual - breakEven) / actual) * 100;
}

/**
 * Contribution margin per unit = price - variable cost
 */
export function contributionMargin(
  pricePerUnit: number | null,
  variableCostPerUnit: number | null,
): number | null {
  if (pricePerUnit == null || variableCostPerUnit == null) return null;
  return pricePerUnit - variableCostPerUnit;
}

/**
 * Required price = cost / (1 - target margin %)
 * e.g., cost=800, targetMargin=20% → price=1000
 */
export function requiredPriceForMargin(
  cost: number | null,
  targetMarginPct: number | null,
): number | null {
  if (cost == null || targetMarginPct == null) return null;
  if (targetMarginPct >= 100 || targetMarginPct < 0) return null;
  return cost / (1 - targetMarginPct / 100);
}

/** DSO = (accounts receivable / revenue) × days */
export function dso(accountsReceivable: number | null, revenue: number | null, days = 365): number | null {
  if (accountsReceivable == null || revenue == null || revenue === 0) return null;
  return (accountsReceivable / revenue) * days;
}

/** DPO = (accounts payable / cost of goods) × days */
export function dpo(accountsPayable: number | null, cogs: number | null, days = 365): number | null {
  if (accountsPayable == null || cogs == null || cogs === 0) return null;
  return (accountsPayable / cogs) * days;
}

/** Net margin = net profit / revenue × 100 */
export function netMarginPct(netProfit: number | null, revenue: number | null): number | null {
  if (netProfit == null || revenue == null || revenue === 0) return null;
  return (netProfit / revenue) * 100;
}

export interface PricingScenario {
  cost: number;
  targetMarginPct: number;
  discount: number;       // absolute discount amount
  taxRate: number;        // % e.g. 19
}

export interface PricingResult {
  basePrice: number;
  priceAfterDiscount: number;
  priceWithTax: number;
  profitBeforeDiscount: number;
  profitAfterDiscount: number;
  marginBeforeDiscount: number;
  marginAfterDiscount: number;
}

/** Full pricing engine: cost → target margin → discount → tax → result */
export function pricingEngine(scenario: PricingScenario): PricingResult | null {
  const { cost, targetMarginPct, discount, taxRate } = scenario;
  if (targetMarginPct >= 100 || targetMarginPct < 0) return null;
  const basePrice = cost / (1 - targetMarginPct / 100);
  const priceAfterDiscount = Math.max(0, basePrice - discount);
  const priceWithTax = priceAfterDiscount * (1 + taxRate / 100);
  return {
    basePrice: roundTo(basePrice, 2)!,
    priceAfterDiscount: roundTo(priceAfterDiscount, 2)!,
    priceWithTax: roundTo(priceWithTax, 2)!,
    profitBeforeDiscount: roundTo(basePrice - cost, 2)!,
    profitAfterDiscount: roundTo(priceAfterDiscount - cost, 2)!,
    marginBeforeDiscount: roundTo(((basePrice - cost) / basePrice) * 100, 2)!,
    marginAfterDiscount: priceAfterDiscount > 0
      ? roundTo(((priceAfterDiscount - cost) / priceAfterDiscount) * 100, 2)!
      : 0,
  };
}
