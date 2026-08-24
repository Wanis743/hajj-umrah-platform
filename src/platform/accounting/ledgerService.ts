/**
 * Ledger domain service (V12 §17.4 — platform migration of LedgerExplorer).
 *
 * §5.2 requirements:
 * - Query authoritative chart of accounts + journal lines via typed contracts.
 * - Filter by account / period / branch.
 * - Drill balance -> journal -> source transaction.
 * - Expose current balance, period movement, opening/closing balances.
 *
 * Verified server contracts:
 * - chart_of_accounts: id, agency_id, code, name, account_type, balance
 * - journal_entries: id, agency_id, reference, entry_date, description,
 *   status ('DRAFT'|'POSTED'), source_type, source_id, total_debit, total_credit
 * - journal_lines: id, journal_entry_id, account_id, debit, credit,
 *   currency_code, memo
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface AccountBalanceDTO {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  /** Authoritative server-side balance in major units. */
  readonly balance: number;
}

export interface JournalLineDTO {
  readonly id: string;
  readonly debit: number;
  readonly credit: number;
  readonly memo: string;
  readonly currencyCode: string;
  readonly accountId: string;
}

export interface JournalEntryDTO {
  readonly id: string;
  readonly reference: string;
  readonly entryDate: string;
  readonly description: string;
  readonly status: 'DRAFT' | 'POSTED';
  readonly sourceType: string | null;
  /** Drill target: the business object that produced this entry. */
  readonly sourceId: string | null;
  readonly totalDebit: number;
  readonly totalCredit: number;
  readonly lines: readonly JournalLineDTO[];
}

interface JournalEntryBuilder {
  id: string;
  reference: string;
  entryDate: string;
  description: string;
  status: 'DRAFT' | 'POSTED';
  sourceType: string | null;
  sourceId: string | null;
  totalDebit: number;
  totalCredit: number;
  lines: JournalLineDTO[];
}

export interface LedgerDrillResult {
  readonly account: AccountBalanceDTO;
  readonly entries: readonly JournalEntryDTO[];
}

/** Authoritative account list with server balances. */
export async function getAccountBalances(): Promise<Result<readonly AccountBalanceDTO[], KernelError>> {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, account_type, balance')
    .order('code', { ascending: true });

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'LEDGER' } });
  }

  const accounts = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return Object.freeze({
      id: String(r.id ?? ''),
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      type: (String(r.account_type ?? 'ASSET')) as AccountType,
      balance: Number(r.balance ?? 0),
    });
  });

  return ok(accounts);
}

/** Balance drill-down: every journal line touching an account, grouped by entry. */
export async function getAccountLedger(
  accountId: string,
): Promise<Result<LedgerDrillResult, KernelError>> {
  const accounts = await getAccountBalances();
  if (!accounts.ok) return accounts;
  const account = accounts.value.find((a) => a.id === accountId);
  if (account === undefined) {
    return err({ code: 'NOT_FOUND', message: `Unknown account: ${accountId}`, details: { domain: 'LEDGER' } });
  }

  const { data, error } = await supabase
    .from('journal_lines')
    .select('id, debit, credit, memo, currency_code, account_id, journal_entries!inner(id, reference, entry_date, description, status, source_type, source_id, total_debit, total_credit)')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error !== null) {
    return err({ code: 'VALIDATION_FAILED', message: error.message, details: { domain: 'LEDGER' } });
  }

  const byEntry = new Map<string, JournalEntryBuilder>();
  for (const row of data ?? []) {
    const line = row as Record<string, unknown>;
    const je = line.journal_entries as Record<string, unknown> | null;
    if (je === null) continue;
    const entryId = String(je.id);
    let entry: JournalEntryBuilder | undefined = byEntry.get(entryId);
    if (entry === undefined) {
      entry = {
        id: entryId,
        reference: String(je.reference ?? ''),
        entryDate: String(je.entry_date ?? ''),
        description: String(je.description ?? ''),
        status: (String(je.status ?? 'DRAFT') as 'DRAFT' | 'POSTED'),
        sourceType: je.source_type === null || je.source_type === undefined ? null : String(je.source_type),
        sourceId: je.source_id === null || je.source_id === undefined ? null : String(je.source_id),
        totalDebit: Number(je.total_debit ?? 0),
        totalCredit: Number(je.total_credit ?? 0),
        lines: [],
      };
      byEntry.set(entryId, entry);
    }
    if (entry !== undefined) {
      entry.lines.push(Object.freeze({
        id: String(line.id ?? ''),
        debit: Number(line.debit ?? 0),
        credit: Number(line.credit ?? 0),
        memo: String(line.memo ?? ''),
        currencyCode: String(line.currency_code ?? 'DZD'),
        accountId,
      }));
    }
  }

  const entries: JournalEntryDTO[] = [...byEntry.values()].map((e) => Object.freeze({ ...e, lines: Object.freeze(e.lines) }));
  return ok({ account, entries });
}
