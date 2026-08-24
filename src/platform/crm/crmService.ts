/**
 * CRM domain service (V12 §17.8 — platform migration of crm/v10, §6).
 *
 * §6 lifecycle honored with the REAL server objects that exist:
 * leads -> opportunities -> quotes (-> booking/invoice downstream).
 *
 * Verified server contracts:
 * - leads: id, agency_id, first_name, last_name, email, phone, status,
 *          source, created_at, updated_at
 * - opportunities: id, agency_id, lead_id, name, stage, amount,
 *          expected_close_date
 * - sales_activities: id, lead_id, opportunity_id, activity_type,
 *          description, activity_date
 * - quotes: id, opportunity_id, quote_number, status, total_amount, valid_until
 * NOTE: no quote_line_items table exists in this lineage; quote amounts are
 * the authoritative total_amount column.
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export interface LeadDTO {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly status: string;
  readonly source: string;
  readonly createdAt: string;
}

export interface OpportunityDTO {
  readonly id: string;
  readonly leadId: string;
  readonly name: string;
  readonly stage: string;
  readonly amount: number;
  readonly expectedCloseDate: string | null;
}

export interface QuoteDTO {
  readonly id: string;
  readonly opportunityId: string;
  readonly quoteNumber: string;
  readonly status: string;
  readonly totalAmount: number;
  readonly validUntil: string | null;
}

export interface CrmPipelineSnapshot {
  readonly leads: readonly LeadDTO[];
  readonly opportunities: readonly OpportunityDTO[];
  readonly quotes: readonly QuoteDTO[];
  /** Derived pipeline value: open opportunities by stage. */
  readonly openPipelineValue: number;
}

export async function getCrmSnapshot(): Promise<Result<CrmPipelineSnapshot, KernelError>> {
  const [leadsRes, oppsRes, quotesRes] = await Promise.all([
    supabase.from('leads').select('id, first_name, last_name, email, phone, status, source, created_at').order('created_at', { ascending: false }).limit(200),
    supabase.from('opportunities').select('id, lead_id, name, stage, amount, expected_close_date').order('created_at', { ascending: false }).limit(200),
    supabase.from('quotes').select('id, opportunity_id, quote_number, status, total_amount, valid_until').order('created_at', { ascending: false }).limit(200),
  ]);

  if (leadsRes.error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: leadsRes.error.message, details: { domain: 'CRM' } });
  }
  if (oppsRes.error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: oppsRes.error.message, details: { domain: 'CRM' } });
  }
  if (quotesRes.error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: quotesRes.error.message, details: { domain: 'CRM' } });
  }

  const leads = ((leadsRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    firstName: String(r.first_name ?? ''),
    lastName: String(r.last_name ?? ''),
    email: String(r.email ?? ''),
    phone: String(r.phone ?? ''),
    status: String(r.status ?? 'NEW'),
    source: String(r.source ?? ''),
    createdAt: String(r.created_at ?? ''),
  }));

  const opportunities = ((oppsRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    leadId: String(r.lead_id ?? ''),
    name: String(r.name ?? ''),
    stage: String(r.stage ?? 'QUALIFICATION'),
    amount: Number(r.amount ?? 0),
    expectedCloseDate: r.expected_close_date === null || r.expected_close_date === undefined ? null : String(r.expected_close_date),
  }));

  const quotes = ((quotesRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => Object.freeze({
    id: String(r.id),
    opportunityId: String(r.opportunity_id ?? ''),
    quoteNumber: String(r.quote_number ?? ''),
    status: String(r.status ?? 'DRAFT'),
    totalAmount: Number(r.total_amount ?? 0),
    validUntil: r.valid_until === null || r.valid_until === undefined ? null : String(r.valid_until),
  }));

  const closedStages = new Set(['WON', 'LOST', 'CLOSED']);
  const openPipelineValue = opportunities
    .filter((o) => !closedStages.has(o.stage.toUpperCase()))
    .reduce((sum, o) => sum + o.amount, 0);

  return ok({ leads, opportunities, quotes, openPipelineValue });
}
