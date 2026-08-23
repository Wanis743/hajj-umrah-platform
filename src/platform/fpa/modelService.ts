/**
 * FPA domain service (slice 7 — modeling/planning vertical).
 *
 * Pure client-side contracts for the modeling workspace. Mirrors the live DB:
 *   financial_models(id, agency_id, package_id, name, status, created_at, updated_at)
 *   model_scenarios(id, model_id, name, description, is_baseline, created_at)
 *   model_assumptions(id, scenario_id, variable_key UNIQUE, variable_value)
 *   model_projections(id, scenario_id UNIQUE, projected_*, calculated_at)
 *   simulate_scenario(p_scenario_id) -> JSONB
 *     { projected_revenue, projected_cost, projected_margin, projected_margin_percent }
 */

import { toMinorUnits, fromMinorUnits } from '../../lib/money.ts';
import { err, minorUnits, ok, type KernelError, type MinorUnits, type Result } from '../kernel/types.ts';

export const ASSUMPTION_KEYS = [
  'target_pilgrims',
  'price_per_pilgrim',
  'flight_cost_per_pilgrim',
  'hotel_cost_per_pilgrim',
  'visa_cost_per_pilgrim',
  'other_cost_per_pilgrim',
] as const;

export type AssumptionKey = (typeof ASSUMPTION_KEYS)[number];

export interface ScenarioAssumptions {
  readonly targetPilgrims: number;
  readonly pricePerPilgrim: number;
  readonly flightCostPerPilgrim: number;
  readonly hotelCostPerPilgrim: number;
  readonly visaCostPerPilgrim: number;
  readonly otherCostPerPilgrim: number;
}

/** Client mirror of the server's simulate_scenario arithmetic (modeling_engine.sql). */
export function projectScenario(a: ScenarioAssumptions): {
  revenue: MinorUnits;
  cost: MinorUnits;
  margin: MinorUnits;
  marginPercent: number;
} {
  const pilgrims = Math.max(0, Math.round(a.targetPilgrims));
  const revenue = pilgrims * a.pricePerPilgrim;
  const unitCost =
    a.flightCostPerPilgrim + a.hotelCostPerPilgrim + a.visaCostPerPilgrim + a.otherCostPerPilgrim;
  const cost = pilgrims * unitCost;
  const margin = revenue - cost;
  const marginPercent = revenue > 0 ? Math.round((margin / revenue) * 10000) / 100 : 0;
  return {
    revenue: minorUnits(toMinorUnits(revenue.toFixed(2))),
    cost: minorUnits(toMinorUnits(cost.toFixed(2))),
    margin: minorUnits(toMinorUnits(margin.toFixed(2))),
    marginPercent,
  };
}

/** Validate assumptions before persisting or simulating. */
export function validateAssumptions(
  values: Readonly<Record<string, unknown>>,
): Result<ScenarioAssumptions, KernelError> {
  const out: Record<string, number> = {};
  const camel = (snake: string): string =>
    snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  for (const key of ASSUMPTION_KEYS) {
    const raw = values[key];
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(num) || num < 0) {
      return err({
        code: 'VALIDATION_FAILED',
        message: `Assumption '${key}' must be a non-negative number`,
        details: { domain: 'FPA', key },
      });
    }
    out[camel(key)] = num;
  }
  if (out['targetPilgrims'] === 0) {
    return err({
      code: 'VALIDATION_FAILED',
      message: 'Target pilgrims must be greater than zero',
      details: { domain: 'FPA', key: 'target_pilgrims' },
    });
  }
  // Cross-field sanity: selling below unit cost is allowed but flagged via margin math.
  return ok(out as unknown as ScenarioAssumptions);
}

/** JSONB contract of simulate_scenario with runtime narrowing (§36). */
export interface ScenarioSimulationResult {
  readonly projectedRevenue: MinorUnits;
  readonly projectedCost: MinorUnits;
  readonly projectedMargin: MinorUnits;
  readonly projectedMarginPercent: number;
}

export function parseSimulation(value: unknown): Result<ScenarioSimulationResult, KernelError> {
  if (typeof value !== 'object' || value === null) {
    return err({ code: 'VALIDATION_FAILED', message: 'Unexpected simulation result', details: { domain: 'FPA' } });
  }
  const v = value as Record<string, unknown>;
  const nums = ['projected_revenue', 'projected_cost', 'projected_margin', 'projected_margin_percent'].every((k) =>
    typeof v[k] === 'number' || typeof v[k] === 'string',
  );
  if (!nums) {
    return err({ code: 'VALIDATION_FAILED', message: 'Simulation result missing fields', details: { domain: 'FPA' } });
  }
  return ok({
    projectedRevenue: minorUnits(toMinorUnits(v['projected_revenue'] as string)),
    projectedCost: minorUnits(toMinorUnits(v['projected_cost'] as string)),
    projectedMargin: minorUnits(toMinorUnits(v['projected_margin'] as string)),
    projectedMarginPercent: Number(v['projected_margin_percent']),
  });
}
