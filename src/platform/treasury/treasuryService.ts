/**
 * Treasury / Risk / Controls domain service (V12 §17.8 — platform
 * migration, §12).
 *
 * Verified server contracts:
 * - cash_positions: id, bank_portfolio (jsonb), expected_inflows,
 *   expected_outflows, net_position, report_date
 * - financial_controls: id, control_code, description, test_population,
 *   exceptions, status
 * - risk_events: id, event_name, probability, impact, expected_exposure,
 *   mitigations
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export interface CashPositionDTO {
  readonly id: string;
  readonly bankPortfolio: unknown;
  readonly expectedInflows: number;
  readonly expectedOutflows: number;
  readonly netPosition: number;
  readonly reportDate: string;
}

export interface FinancialControlDTO {
  readonly id: string;
  readonly controlCode: string;
  readonly description: string;
  readonly testPopulation: number;
  readonly exceptions: number;
  readonly status: string;
}

export interface RiskEventDTO {
  readonly id: string;
  readonly eventName: string;
  readonly probability: number;
  readonly impact: number;
  readonly expectedExposure: number;
  readonly mitigations: string | null;
}

export async function getCashPositions(): Promise<Result<readonly CashPositionDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('cash_positions')
    .select('id, bank_portfolio, expected_inflows, expected_outflows, net_position, report_date')
    .order('report_date', { ascending: false })
    .limit(60);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'TREASURY' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    bankPortfolio: r.bank_portfolio ?? null,
    expectedInflows: Number(r.expected_inflows ?? 0),
    expectedOutflows: Number(r.expected_outflows ?? 0),
    netPosition: Number(r.net_position ?? 0),
    reportDate: String(r.report_date ?? ''),
  })));
}

export async function getFinancialControls(): Promise<Result<readonly FinancialControlDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('financial_controls')
    .select('id, control_code, description, test_population, exceptions, status')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'TREASURY' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    controlCode: String(r.control_code ?? ''),
    description: String(r.description ?? ''),
    testPopulation: Number(r.test_population ?? 0),
    exceptions: Number(r.exceptions ?? 0),
    status: String(r.status ?? 'OPEN'),
  })));
}

export async function getRiskEvents(): Promise<Result<readonly RiskEventDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('risk_events')
    .select('id, event_name, probability, impact, expected_exposure, mitigations')
    .order('expected_exposure', { ascending: false })
    .limit(100);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'TREASURY' } });
  }
  return ok(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    eventName: String(r.event_name ?? ''),
    probability: Number(r.probability ?? 0),
    impact: Number(r.impact ?? 0),
    expectedExposure: Number(r.expected_exposure ?? 0),
    mitigations: r.mitigations === null || r.mitigations === undefined ? null : String(r.mitigations),
  })));
}
