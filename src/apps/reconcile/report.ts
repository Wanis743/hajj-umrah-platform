/**
 * Reconciliation — what leaves the window.
 *
 * Two artefacts, and they answer different questions. The CSV is the difference
 * report: the statement lines nobody could tie to an entry, and the posted entries
 * nobody could tie to the statement, in one file with a `side` column. That file is
 * the paper somebody takes to the bank, or back to the person who booked the entry.
 * The clipboard text is one row and its best candidate, which is what gets pasted
 * into a message that starts "is this the same payment?".
 *
 * Machine columns carry codes rather than labels, because a CSV outlives the
 * language it was exported in. The clipboard is the opposite — it is read once, by a
 * person, now — so it is written in theirs.
 */
import type { Localized } from '@/platform/sdk';
import { csvDocument } from '../shared/csv';
import type { BankStatement, BankTransaction } from '../shared/ledger';
import { type Candidate, isEligible, type LedgerRow, SIGNAL_LABEL } from './match';

export type Label = (value: Localized) => string;

const HEADER = [
  'side',
  'date',
  'reference',
  'description',
  'direction',
  'amount',
  'state',
  'counterpart',
  'delta',
] as const;

const direction = (kind: 'debit' | 'credit'): string => (kind === 'debit' ? 'DEBIT' : 'CREDIT');

const money = (value: number): string => value.toFixed(2);

/**
 * The two sides that did not meet.
 *
 * Matched lines are left out on purpose: a difference report listing the things
 * that agree is a report nobody reads to the end. `ignored` lines are left out too
 * — somebody already decided those need no counterpart.
 */
export function differenceCsv(
  transactions: readonly BankTransaction[],
  ledgerRows: readonly LedgerRow[],
): string {
  const open = transactions.filter((row) => row.state === 'unmatched');
  const loose = ledgerRows.filter(isEligible);
  return csvDocument(HEADER, [
    ...open.map((row) => [
      'STATEMENT',
      row.date,
      row.reference,
      row.description,
      direction(row.kind),
      money(row.amount),
      'UNMATCHED',
      '',
      '',
    ]),
    ...loose.map((row) => [
      'LEDGER',
      row.date,
      row.reference,
      row.line.memo,
      direction(row.kind),
      money(row.amount),
      'UNRECONCILED',
      row.accountLabel,
      '',
    ]),
  ]);
}

export const suggestedFileName = (statement: BankStatement | null, today: string): string =>
  `reconciliation-${statement === null ? today : statement.date}.csv`;

/**
 * One statement line and what it might be, as pasteable text.
 *
 * The signals are included because they are the argument: "same amount, same day,
 * same reference" is a case a colleague can agree or disagree with, whereas a bare
 * score is a number they have no way to check.
 */
export function transactionClipboardText(
  transaction: BankTransaction,
  candidate: Candidate | null,
  t: Label,
): string {
  const head = [
    `${transaction.date} · ${direction(transaction.kind)} ${money(transaction.amount)}`,
    transaction.description === '' ? null : transaction.description,
    transaction.reference === '' ? null : `ref ${transaction.reference}`,
  ].filter((part): part is string => part !== null);
  if (candidate === null) return head.join('\n');
  const signals = candidate.signals.map((signal) => t(SIGNAL_LABEL[signal])).join(', ');
  const line = candidate.row;
  return [
    ...head,
    '—',
    `${line.date} · ${line.reference} · ${direction(line.kind)} ${money(line.amount)}`,
    line.line.memo === '' ? null : line.line.memo,
    signals === '' ? null : signals,
  ]
    .filter((part): part is string => part !== null)
    .join('\n');
}
