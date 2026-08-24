/**
 * Accounts Receivable domain service (V12 §17.4 — platform migration of ARWorkspace).
 *
 * §5.3 requirements:
 * - Invoices, allocations; outstanding balances DERIVED from authoritative state
 *   (total - paid), never from local UI assumptions.
 * - Aging buckets computed from server timestamps.
 *
 * Verified server contracts:
 * - invoices: id, agency_id, invoice_number, booking_id, total_dzd, total_sar,
 *   paid_dzd, paid_sar, status ('DRAFT'|'ISSUED'|'PARTIALLY_PAID'|'PAID'|...),
 *   issued_at, created_at, currency
 * - payment_allocations: id, payment_id, invoice_id, amount_dzd, amount_sar, created_at
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export interface InvoiceARDTO {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly currency: string;
  readonly total: number;
  readonly paid: number;
  /** Derived: total - paid (authoritative state, not UI assumption). */
  readonly outstanding: number;
  readonly status: string;
  readonly issuedAt: string;
}

export interface AgingSummary {
  readonly current: number;
  readonly days30: number;
  readonly days60: number;
  readonly days90Plus: number;
}

export interface ArSnapshot {
  readonly invoices: readonly InvoiceARDTO[];
  readonly aging: AgingSummary;
  readonly totalOutstanding: number;
}

function deriveStatus(total: number, paid: number, serverStatus: string): 'OPEN' | 'PAID' | 'PARTIAL' {
  if (serverStatus === 'PAID' || paid >= total) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return 'OPEN';
}

export async function getArSnapshot(): Promise<Result<ArSnapshot, KernelError>> {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, total_dzd, total_sar, paid_dzd, paid_sar, status, issued_at, created_at, currency')
    .in('status', ['ISSUED', 'PARTIALLY_PAID', 'PAID'])
    .order('created_at', { ascending: false })
    .limit(500);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'AR' } });
  }

  const now = Date.now();
  const invoices: InvoiceARDTO[] = [];
  const aging = { current: 0, days30: 0, days60: 0, days90Plus: 0 };
  let totalOutstanding = 0;

  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const isSar = String(r.currency ?? 'DZD') === 'SAR';
    const total = Number((isSar ? r.total_sar : r.total_dzd) ?? 0);
    const paid = Number((isSar ? r.paid_sar : r.paid_dzd) ?? 0);
    const outstanding = Math.max(0, total - paid);
    const issuedAt = String(r.issued_at ?? r.created_at ?? '');
    const ageDays = issuedAt !== '' ? Math.floor((now - new Date(issuedAt).getTime()) / 86_400_000) : 0;

    if (outstanding > 0) {
      totalOutstanding += outstanding;
      if (ageDays <= 30) aging.current += outstanding;
      else if (ageDays <= 60) aging.days30 += outstanding;
      else if (ageDays <= 90) aging.days60 += outstanding;
      else aging.days90Plus += outstanding;
    }

    invoices.push(Object.freeze({
      id: String(r.id),
      invoiceNumber: String(r.invoice_number ?? ''),
      currency: String(r.currency ?? 'DZD'),
      total,
      paid,
      outstanding,
      status: deriveStatus(total, paid, String(r.status ?? '')),
      issuedAt,
    }));
  }

  return ok({ invoices: Object.freeze(invoices), aging: Object.freeze(aging), totalOutstanding });
}
