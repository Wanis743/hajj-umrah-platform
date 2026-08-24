/**
 * Reconciliation domain service (V12 §17.4 — platform migration, §5.5).
 *
 * Requirements:
 * - Bank statements/transactions are first-class objects separate from GL.
 * - Matching is server-authoritative: exact amount + date window (+/-3 days),
 *   direction-aware; who/when matched persisted (matched_by/matched_at).
 * - Truthful states only — no client-side fabrication of match results.
 *
 * Verified server contracts:
 * - bank_statements: id, agency_id, statement_date, start_balance, end_balance, status
 * - bank_transactions: id, statement_id, transaction_date, amount, description,
 *   reference, status ('UNMATCHED'|'MATCHED'), type, matched_journal_line_id,
 *   matched_at, matched_by
 * - auto_reconcile_bank_statement(p_statement_id) → {success, matched}
 */

import { supabase } from '../../lib/supabase.ts';
import {
  err,
  ok,
  type KernelError,
  type Result,
} from '../kernel/types.ts';

export interface BankStatementDTO {
  readonly id: string;
  readonly statementDate: string;
  readonly startBalance: number;
  readonly endBalance: number;
  readonly status: string;
}

export interface BankTransactionDTO {
  readonly id: string;
  readonly transactionDate: string;
  readonly amount: number;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly description: string;
  readonly reference: string;
  readonly status: 'UNMATCHED' | 'MATCHED';
  /** Ledger drill target when matched. */
  readonly matchedJournalLineId: string | null;
}

export interface StatementWithTransactions {
  readonly statement: BankStatementDTO;
  readonly transactions: readonly BankTransactionDTO[];
  readonly unmatchedCount: number;
}

export async function getStatement(statementId: string): Promise<Result<StatementWithTransactions, KernelError>> {
  const { data: stmt, error: stmtError } = await supabase
    .from('bank_statements')
    .select('id, statement_date, start_balance, end_balance, status')
    .eq('id', statementId)
    .maybeSingle();

  if (stmtError !== null) {
    return err({ code: 'VALIDATION_FAILED', message: stmtError.message, details: { domain: 'RECON' } });
  }
  if (stmt === null) {
    return err({ code: 'NOT_FOUND', message: `Unknown statement: ${statementId}`, details: { domain: 'RECON' } });
  }

  const { data: txs, error: txError } = await supabase
    .from('bank_transactions')
    .select('id, transaction_date, amount, type, description, reference, status, matched_journal_line_id')
    .eq('statement_id', statementId)
    .order('transaction_date', { ascending: true });

  if (txError !== null) {
    return err({ code: 'VALIDATION_FAILED', message: txError.message, details: { domain: 'RECON' } });
  }

  const s = stmt as Record<string, unknown>;
  const transactions = (txs ?? []).map((row) => {
    const t = row as Record<string, unknown>;
    return Object.freeze({
      id: String(t.id),
      transactionDate: String(t.transaction_date ?? ''),
      amount: Number(t.amount ?? 0),
      direction: String(t.type ?? 'DEBIT') === 'CREDIT' ? 'CREDIT' as const : 'DEBIT' as const,
      description: String(t.description ?? ''),
      reference: String(t.reference ?? ''),
      status: String(t.status ?? 'UNMATCHED') === 'MATCHED' ? 'MATCHED' as const : 'UNMATCHED' as const,
      matchedJournalLineId:
        t.matched_journal_line_id === null || t.matched_journal_line_id === undefined
          ? null
          : String(t.matched_journal_line_id),
    });
  });

  return ok({
    statement: Object.freeze({
      id: String(s.id),
      statementDate: String(s.statement_date ?? ''),
      startBalance: Number(s.start_balance ?? 0),
      endBalance: Number(s.end_balance ?? 0),
      status: String(s.status ?? 'DRAFT'),
    }),
    transactions,
    unmatchedCount: transactions.filter((t) => t.status === 'UNMATCHED').length,
  });
}

/** Run the server matching engine over a statement. Returns the matched count. */
export async function runAutoReconcile(
  statementId: string,
): Promise<Result<number, KernelError>> {
  const { data, error } = await supabase.rpc('auto_reconcile_bank_statement', {
    p_statement_id: statementId,
  });

  if (error !== null) {
    const code = error.message.includes('not found') || error.message.includes('Unauthorized') ? 'NOT_FOUND' : 'PERMISSION_DENIED';
    return err({ code, message: error.message, details: { domain: 'RECON' } });
  }

  const body = data as { success?: boolean; matched?: number } | null;
  if (body?.success !== true) {
    return err({ code: 'CONFLICT', message: 'Matching engine returned no result', details: { domain: 'RECON' } });
  }
  return ok(Number(body.matched ?? 0));
}
