/**
 * Simulation & Optimization domain service (V12 §17.8 — platform migration, §11).
 *
 * Jobs are real server objects; results come from the jobs table status —
 * the client never invents simulation output (§23).
 *
 * Verified server contracts:
 * - simulation_jobs: id, name, type, status, parameters (jsonb),
 *   started_at, completed_at
 * - optimization_jobs: id, name, objective_function, feasible_solutions,
 *   status, started_at, completed_at
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export interface SimulationJobDTO {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
  readonly parameters: unknown;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface OptimizationJobDTO {
  readonly id: string;
  readonly name: string;
  readonly objectiveFunction: string;
  readonly feasibleSolutions: number;
  readonly status: string;
  readonly completedAt: string | null;
}

export async function getSimulationJobs(): Promise<Result<readonly SimulationJobDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('simulation_jobs')
    .select('id, name, type, status, parameters, started_at, completed_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'SIMULATION' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    name: String(r.name ?? ''),
    type: String(r.type ?? ''),
    status: String(r.status ?? 'QUEUED'),
    parameters: r.parameters ?? null,
    startedAt: r.started_at === null || r.started_at === undefined ? null : String(r.started_at),
    completedAt: r.completed_at === null || r.completed_at === undefined ? null : String(r.completed_at),
  })));
}

export async function getOptimizationJobs(): Promise<Result<readonly OptimizationJobDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('optimization_jobs')
    .select('id, name, objective_function, feasible_solutions, status, completed_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'SIMULATION' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    name: String(r.name ?? ''),
    objectiveFunction: String(r.objective_function ?? ''),
    feasibleSolutions: Number(r.feasible_solutions ?? 0),
    status: String(r.status ?? 'QUEUED'),
    completedAt: r.completed_at === null || r.completed_at === undefined ? null : String(r.completed_at),
  })));
}
