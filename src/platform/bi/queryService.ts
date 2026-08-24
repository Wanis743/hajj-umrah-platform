/**
 * BI query + drill-down service (V12 §22 Phase B, §5.7/§19.20-21).
 *
 * What this adds over semanticService:
 * - Metric evaluation for certified metrics whose dataset maps to real
 *   tables (server-side aggregation only — the client never invents values).
 * - Drill-through: a metric value row resolves to its source accounting
 *   objects (journal entry -> source transaction), per §19.21.
 *
 * Supported evaluator (dataset e2e_revenue_dataset):
 *   formula: sum(revenue_minor) / nullif(sum(pilgrims),0)
 * backed by journal_lines joined to chart_of_accounts revenue accounts,
 * grouped by period. Pilgrims counted from bookings via groups.
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';
import type { BiMetricDTO } from './semanticService.ts';

export interface MetricValueRow {
  readonly period: string;
  readonly revenueMinor: number;
  readonly pilgrims: number;
  /** sum(revenue_minor) / nullif(sum(pilgrims),0) */
  readonly value: number | null;
}

export interface MetricDrillTarget {
  readonly journalEntryId: string;
  readonly reference: string;
  readonly entryDate: string;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly amountMinor: number;
}

/** Evaluate a net-revenue-per-pilgrim series grouped by month. */
export async function evaluateNetRevenuePerPilgrim(): Promise<Result<readonly MetricValueRow[], KernelError>> {
  // Revenue = credits on REVENUE accounts; pilgrim counts come from bookings.
  const rev = await supabase
    .from('journal_lines')
    .select('credit, debit, created_at, journal_entries!inner(entry_date, status), chart_of_accounts!inner(account_type)')
    .eq('chart_of_accounts.account_type', 'REVENUE')
    .eq('journal_entries.status', 'POSTED')
    .limit(5000);

  if (rev.error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: rev.error.message, details: { domain: 'BI' } });
  }

  const bk = await supabase
    .from('bookings')
    .select('id, created_at')
    .limit(5000);

  if (bk.error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: bk.error.message, details: { domain: 'BI' } });
  }

  const byMonthRevenue = new Map<string, number>();
  for (const row of (rev.data ?? []) as unknown as Record<string, unknown>[]) {
    const je = row.journal_entries as Record<string, unknown> | null;
    const entryDate = String(je?.entry_date ?? '');
    const month = entryDate.slice(0, 7);
    const credit = Number(row.credit ?? 0);
    const debit = Number(row.debit ?? 0);
    byMonthRevenue.set(month, (byMonthRevenue.get(month) ?? 0) + Math.max(0, credit - debit));
  }
  // Revenue is stored in major DZD in journal lines; the metric wants minor units (x100).
  const byMonthPilgrims = new Map<string, number>();
  for (const row of (bk.data ?? []) as unknown as Record<string, unknown>[]) {
    const month = String(row.created_at ?? '').slice(0, 7);
    if (month === '') continue;
    byMonthPilgrims.set(month, (byMonthPilgrims.get(month) ?? 0) + 1);
  }

  const months = [...new Set([...byMonthRevenue.keys(), ...byMonthPilgrims.keys()])].sort();
  const rows = months.map((m) => {
    const revenueMinor = Math.round((byMonthRevenue.get(m) ?? 0) * 100);
    const pilgrims = byMonthPilgrims.get(m) ?? 0;
    return Object.freeze({
      period: m,
      revenueMinor,
      pilgrims,
      value: pilgrims === 0 ? null : revenueMinor / pilgrims,
    });
  });

  return ok(rows);
}

/**
 * §19.21 drill: from a metric data point to the source accounting objects —
 * the POSTED journal entries touching REVENUE accounts in that period.
 */
export async function drillToSourceEntries(period: string): Promise<Result<readonly MetricDrillTarget[], KernelError>> {
  const { data, error } = await supabase
    .from('journal_lines')
    .select('debit, credit, journal_entries!inner(id, reference, entry_date, status, source_type, source_id), chart_of_accounts!inner(account_type)')
    .eq('chart_of_accounts.account_type', 'REVENUE')
    .eq('journal_entries.status', 'POSTED')
    .gte('journal_entries.entry_date', `${period}-01`)
    .lte('journal_entries.entry_date', `${period}-31`)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'BI' } });
  }

  const seen = new Set<string>();
  const targets: MetricDrillTarget[] = [];
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const je = row.journal_entries as Record<string, unknown> | null;
    if (je === null) continue;
    const id = String(je.id);
    if (seen.has(id)) continue;
    seen.add(id);
    targets.push(Object.freeze({
      journalEntryId: id,
      reference: String(je.reference ?? ''),
      entryDate: String(je.entry_date ?? ''),
      sourceType: je.source_type === null || je.source_type === undefined ? null : String(je.source_type),
      sourceId: je.source_id === null || je.source_id === undefined ? null : String(je.source_id),
      amountMinor: Math.round(Number(row.credit ?? 0) - Number(row.debit ?? 0)),
    }));
  }

  return ok(targets);
}

/** Guard: only CERTIFIED metrics may be evaluated for dashboards (§8 governance). */
export function assertCertified(metric: BiMetricDTO): Result<true, KernelError> {
  if (metric.status !== 'CERTIFIED') {
    return err({
      code: 'PERMISSION_DENIED',
      message: `Metric ${metric.key} is ${metric.status}; only CERTIFIED metrics can be evaluated`,
      details: { domain: 'BI' },
    });
  }
  return ok(true);
}
