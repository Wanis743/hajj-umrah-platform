/**
 * FP&A / Planning domain service (V12 §17.8 — platform migration, §10).
 *
 * Real server objects: models, scenarios (with base_version inheritance),
 * planning cycles. No client-side fabrication of assumptions or formulas.
 *
 * Verified server contracts:
 * - fpa_models: id, name, description, model_type, data_type
 * - fpa_scenarios: id, base_version_id, name, description, status
 * - fpa_planning_cycles: id, name, start_date, end_date, status, scenario_id
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export interface FpaModelDTO {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly modelType: string;
  readonly dataType: string;
}

export interface FpaScenarioDTO {
  readonly id: string;
  readonly baseVersionId: string | null;
  readonly name: string;
  readonly description: string;
  readonly status: string;
}

export interface FpaCycleDTO {
  readonly id: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly status: string;
  readonly scenarioId: string | null;
}

export async function getFpaModels(): Promise<Result<readonly FpaModelDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('fpa_models')
    .select('id, name, description, model_type, data_type')
    .order('name', { ascending: true })
    .limit(200);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'FPA' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    modelType: String(r.model_type ?? ''),
    dataType: String(r.data_type ?? ''),
  })));
}

export async function getFpaScenarios(): Promise<Result<readonly FpaScenarioDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('fpa_scenarios')
    .select('id, base_version_id, name, description, status')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'FPA' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    baseVersionId: r.base_version_id === null || r.base_version_id === undefined ? null : String(r.base_version_id),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    status: String(r.status ?? 'DRAFT'),
  })));
}

export async function getPlanningCycles(): Promise<Result<readonly FpaCycleDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('fpa_planning_cycles')
    .select('id, name, start_date, end_date, status, scenario_id')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'FPA' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    name: String(r.name ?? ''),
    startDate: r.start_date === null || r.start_date === undefined ? null : String(r.start_date),
    endDate: r.end_date === null || r.end_date === undefined ? null : String(r.end_date),
    status: String(r.status ?? 'OPEN'),
    scenarioId: r.scenario_id === null || r.scenario_id === undefined ? null : String(r.scenario_id),
  })));
}
