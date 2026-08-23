/**
 * Journal domain service (slice 3 — accounting vertical, spec §14/§15/§72).
 *
 * Client-side half of the journal contract. Pure logic lives here so the
 * workbench UI contains zero business rules and the server remains
 * authoritative. Amounts cross the boundary as exact decimal strings built
 * from bigint minor units (§63 — never binary floats).
 *
 * Verified server contracts (from migrations, see docs/rebuild/EVIDENCE_LOG.md):
 * - post_journal_entry(p_reference, p_description, p_entry_date, p_lines JSONB)
 *   → validates balance + account scope, creates status='DRAFT'.
 *   Returns {'success', 'journal_entry_id'} (fix_rpcs) or
 *   {'success', 'journal_id'} (original) — both tolerated below.
 * - get_recent_journal_entries(limit_rows?) → [{
 *     id, created_at, reference, entry_date, description, status,
 *     total_debit, total_credit,
 *     lines: [{ account_code, account_name, debit, credit, memo }] }]
 * - approve_journal_entry(p_journal_id, p_correlation_id?, p_reason?)
 *   → POSTED (migration 20260823000010).
 */

import { toMinorUnits, fromMinorUnits } from '../../lib/money.ts';
import {
  err,
  minorUnits,
  ok,
  type KernelError,
  type MinorUnits,
  type Result,
} from '../kernel/types.ts';

export interface JournalLineInput {
  readonly accountId: string;
  /** Major-unit decimal string (e.g. "1500.00"); converted internally. */
  readonly debit: string;
  readonly credit: string;
  readonly currencyCode: 'DZD' | 'SAR';
  readonly memo: string;
}

export interface JournalDraft {
  readonly reference: string;
  readonly description: string;
  /** ISO date (yyyy-mm-dd) within an OPEN fiscal period. */
  readonly entryDate: string;
  readonly lines: readonly JournalLineInput[];
}

export interface RecentJournalLine {
  readonly accountCode: string | null;
  readonly accountName: string | null;
  readonly debitMinor: MinorUnits;
  readonly creditMinor: MinorUnits;
  readonly memo: string | null;
}

export interface RecentJournalEntry {
  readonly id: string;
  readonly createdAt: string | null;
  readonly reference: string | null;
  readonly entryDate: string | null;
  readonly description: string | null;
  readonly status: 'DRAFT' | 'POSTED' | 'VOID';
  readonly totalDebitMinor: MinorUnits;
  readonly totalCreditMinor: MinorUnits;
  readonly lines: readonly RecentJournalLine[];
}

const ACCOUNTING = 'ACCOUNTING';

// ── Pure validation ─────────────────────────────────────────────────────────

export function sumLines(lines: readonly JournalLineInput[]): {
  debit: MinorUnits;
  credit: MinorUnits;
} {
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    debit += toMinorUnits(line.debit);
    credit += toMinorUnits(line.credit);
  }
  return { debit: minorUnits(debit), credit: minorUnits(credit) };
}

/** §15 invariant, pre-flight mirror of the server's check. */
export function validateDraft(draft: JournalDraft): Result<null, KernelError> {
  if (draft.reference.trim().length === 0) {
    return err({ code: 'VALIDATION_FAILED', message: 'Reference is required', details: { domain: ACCOUNTING, field: 'reference' } });
  }
  if (draft.description.trim().length === 0) {
    return err({ code: 'VALIDATION_FAILED', message: 'Description is required', details: { domain: ACCOUNTING, field: 'description' } });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.entryDate)) {
    return err({ code: 'VALIDATION_FAILED', message: 'Entry date must be yyyy-mm-dd', details: { domain: ACCOUNTING, field: 'entryDate' } });
  }
  if (draft.lines.length < 2) {
    return err({ code: 'VALIDATION_FAILED', message: 'A journal entry needs at least two lines', details: { domain: ACCOUNTING } });
  }
  for (let i = 0; i < draft.lines.length; i++) {
    const line = draft.lines[i] as JournalLineInput;
    if (line.accountId.length === 0) {
      return err({ code: 'VALIDATION_FAILED', message: `Line ${i + 1}: account is required`, details: { domain: ACCOUNTING, line: i + 1 } });
    }
    const d = toMinorUnits(line.debit);
    const c = toMinorUnits(line.credit);
    if (d < 0n || c < 0n) {
      return err({ code: 'VALIDATION_FAILED', message: `Line ${i + 1}: negative amounts are not allowed`, details: { domain: ACCOUNTING, line: i + 1 } });
    }
    // Server constraint: (debit = 0) <> (credit = 0) — exactly one side non-zero.
    if ((d === 0n) === (c === 0n)) {
      return err({ code: 'VALIDATION_FAILED', message: `Line ${i + 1}: enter either a debit or a credit, not both/neither`, details: { domain: ACCOUNTING, line: i + 1 } });
    }
  }
  const totals = sumLines(draft.lines);
  if (totals.debit !== totals.credit) {
    return err({
      code: 'VALIDATION_FAILED',
      message: `Unbalanced entry: debits ${fromMinorUnits(totals.debit)} ≠ credits ${fromMinorUnits(totals.credit)}`,
      details: { domain: ACCOUNTING, debit: totals.debit.toString(), credit: totals.credit.toString() },
    });
  }
  if (totals.debit === minorUnits(0n)) {
    return err({ code: 'VALIDATION_FAILED', message: 'Entry must have non-zero amounts', details: { domain: ACCOUNTING } });
  }
  return ok(null);
}

/** Collision-safe client reference until a server sequence exists. */
export function nextReference(now: Date = new Date()): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `JE-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

// ── RPC payload / result parsing ────────────────────────────────────────────

interface PostLineRpc {
  readonly account_id: string;
  readonly debit: string;
  readonly credit: string;
  readonly currency_code: string;
  readonly memo: string;
}

export function buildPostArgs(draft: JournalDraft): {
  p_reference: string;
  p_description: string;
  p_entry_date: string;
  p_lines: readonly PostLineRpc[];
} {
  return {
    p_reference: draft.reference.trim(),
    p_description: draft.description.trim(),
    p_entry_date: draft.entryDate,
    p_lines: draft.lines.map((l) => ({
      account_id: l.accountId,
      debit: fromMinorUnits(toMinorUnits(l.debit)),
      credit: fromMinorUnits(toMinorUnits(l.credit)),
      currency_code: l.currencyCode,
      memo: l.memo,
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Tolerates both historical result keys: journal_entry_id | journal_id. */
export function parsePostResult(value: unknown): Result<string, KernelError> {
  if (!isRecord(value)) {
    return err({ code: 'VALIDATION_FAILED', message: 'Unexpected RPC result shape', details: { domain: ACCOUNTING } });
  }
  const id = value['journal_entry_id'] ?? value['journal_id'];
  if (typeof id !== 'string' || id.length === 0) {
    return err({ code: 'VALIDATION_FAILED', message: 'RPC result missing journal id', details: { domain: ACCOUNTING } });
  }
  return ok(id);
}

function num(value: unknown): MinorUnits {
  if (typeof value === 'number') return minorUnits(BigInt(Math.round(value * 100)));
  if (typeof value === 'string') return minorUnits(toMinorUnits(value));
  return minorUnits(0n);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseStatus(value: unknown): RecentJournalEntry['status'] {
  return value === 'POSTED' || value === 'VOID' ? value : 'DRAFT';
}

export function parseRecentEntries(value: unknown): Result<readonly RecentJournalEntry[], KernelError> {
  if (!Array.isArray(value)) {
    return err({ code: 'VALIDATION_FAILED', message: 'Expected an array of journal entries', details: { domain: ACCOUNTING } });
  }
  const out: RecentJournalEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw['id'] !== 'string') {
      return err({ code: 'VALIDATION_FAILED', message: 'Malformed journal entry record', details: { domain: ACCOUNTING } });
    }
    if (!Array.isArray(raw['lines'])) {
      return err({ code: 'VALIDATION_FAILED', message: 'Malformed journal line list', details: { domain: ACCOUNTING } });
    }
    const rawLines: readonly unknown[] = raw['lines'];
    const lines: RecentJournalLine[] = [];
    for (const rl of rawLines) {
      if (!isRecord(rl)) {
        return err({ code: 'VALIDATION_FAILED', message: 'Malformed journal line record', details: { domain: ACCOUNTING } });
      }
      lines.push({
        accountCode: str(rl['account_code']),
        accountName: str(rl['account_name']),
        debitMinor: num(rl['debit']),
        creditMinor: num(rl['credit']),
        memo: str(rl['memo']),
      });
    }
    out.push({
      id: raw['id'],
      createdAt: str(raw['created_at']),
      reference: str(raw['reference']),
      entryDate: str(raw['entry_date']),
      description: str(raw['description']),
      status: parseStatus(raw['status']),
      totalDebitMinor: num(raw['total_debit']),
      totalCreditMinor: num(raw['total_credit']),
      lines,
    });
  }
  return ok(out);
}

/** Structured error extraction from Supabase/Postgres exceptions (§72). */
export function rpcError(cause: unknown): KernelError {
  const message =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'Unknown RPC failure';
  const pgCode = isRecord(cause) && typeof cause['code'] === 'string' ? cause['code'] : null;
  return {
    code: pgCode === '42501' ? 'PERMISSION_DENIED' : 'VALIDATION_FAILED',
    message,
    details: { domain: ACCOUNTING, pgCode },
  };
}

/**
 * Workbench-facing helpers: convert editor rows (raw strings) into
 * service-level inputs, and run full pre-flight validation using the
 * row's cached minor-unit values.
 */
export function toDraftLines(
  rows: readonly {
    accountId: string;
    debitRaw: string;
    creditRaw: string;
    currencyCode: 'DZD' | 'SAR';
    memo: string;
  }[],
): JournalLineInput[] {
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: r.debitRaw === '' ? '0.00' : r.debitRaw,
    credit: r.creditRaw === '' ? '0.00' : r.creditRaw,
    currencyCode: r.currencyCode,
    memo: r.memo,
  }));
}

export function validateDraftLines(
  rows: readonly { debitMinor: MinorUnits; creditMinor: MinorUnits; accountId: string }[],
  description: string,
  entryDate: string,
): Result<null, KernelError> {
  const lines: JournalLineInput[] = rows.map((r) => ({
    accountId: r.accountId,
    debit: fromMinorUnits(r.debitMinor),
    credit: fromMinorUnits(r.creditMinor),
    currencyCode: 'DZD',
    memo: '',
  }));
  return validateDraft({
    reference: nextReference(),
    description,
    entryDate,
    lines,
  });
}
