/**
 * Draft editor panel (slice 3) — the work area of the Journal Workbench.
 * Owns line-row editing and totals display; validation lives in journalService.
 */

import React from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { KernelError } from '../kernel/types.ts';
import type { AccountOption, DraftLine } from './workbenchTypes.ts';
import { BalancedBadge } from './workbenchParts';
import { fmt } from './format';

const CURRENCIES = ['DZD', 'SAR'] as const;

export interface DraftEditorProps {
  readonly accounts: readonly AccountOption[];
  readonly lines: readonly DraftLine[];
  readonly entryDate: string;
  readonly description: string;
  readonly busy: boolean;
  readonly canDraft: boolean;
  readonly validation: { readonly ok: true } | { readonly ok: false; readonly error: KernelError };
  readonly onEntryDateChange: (v: string) => void;
  readonly onDescriptionChange: (v: string) => void;
  readonly onLineChange: (index: number, patch: Partial<DraftLine>) => void;
  readonly onAddLine: () => void;
  readonly onRemoveLine: (index: number) => void;
  readonly onSaveDraft: () => void;
}

export function DraftEditor(props: DraftEditorProps): React.JSX.Element {
  const {
    accounts,
    lines,
    entryDate,
    description,
    busy,
    canDraft,
    validation,
    onEntryDateChange,
    onDescriptionChange,
    onLineChange,
    onAddLine,
    onRemoveLine,
    onSaveDraft,
  } = props;

  let debit = 0n;
  let credit = 0n;
  for (const l of lines) {
    debit += l.debitMinor;
    credit += l.creditMinor;
  }
  const balanced = debit === credit && debit !== 0n;

  return (
    <section className="col-span-5 min-h-0 overflow-auto rounded-xl border border-[var(--border)] p-3">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-[var(--text-muted)]">
          Entry date
          <input
            type="date"
            value={entryDate}
            onChange={(e) => onEntryDateChange(e.target.value)}
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="col-span-1 text-xs text-[var(--text-muted)]">
          Description
          <input
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="What is this entry for?"
            className="mt-1 w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm text-[var(--text-primary)]"
          />
        </label>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <th className="pb-1">Account</th>
            <th className="pb-1 text-right">Debit</th>
            <th className="pb-1 text-right">Credit</th>
            <th className="pb-1">Currency</th>
            <th className="pb-1">Memo</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="py-1 pr-1">
                <select
                  value={line.accountId}
                  onChange={(e) => onLineChange(i, { accountId: e.target.value })}
                  className="w-full rounded border border-[var(--border)] bg-transparent px-1 py-1 text-xs"
                >
                  <option value="">— select —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-1">
                <input
                  inputMode="decimal"
                  value={line.debitRaw}
                  onChange={(e) => onLineChange(i, { debitRaw: e.target.value, creditRaw: e.target.value !== '' ? '' : line.creditRaw })}
                  placeholder="0.00"
                  className="w-24 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-right font-mono text-xs"
                />
              </td>
              <td className="py-1 pr-1">
                <input
                  inputMode="decimal"
                  value={line.creditRaw}
                  onChange={(e) => onLineChange(i, { creditRaw: e.target.value, debitRaw: e.target.value !== '' ? '' : line.debitRaw })}
                  placeholder="0.00"
                  className="w-24 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-right font-mono text-xs"
                />
              </td>
              <td className="py-1 pr-1">
                <select
                  value={line.currencyCode}
                  onChange={(e) => onLineChange(i, { currencyCode: e.target.value as DraftLine['currencyCode'] })}
                  className="rounded border border-[var(--border)] bg-transparent px-1 py-1 text-xs"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-1">
                <input
                  value={line.memo}
                  onChange={(e) => onLineChange(i, { memo: e.target.value })}
                  className="w-full rounded border border-[var(--border)] bg-transparent px-2 py-1 text-xs"
                />
              </td>
              <td>
                <button
                  type="button"
                  aria-label={`Remove line ${i + 1}`}
                  onClick={() => onRemoveLine(i)}
                  disabled={lines.length <= 2}
                  title={lines.length <= 2 ? 'An entry needs at least two lines' : undefined}
                  className="rounded p-1 text-[var(--text-muted)] hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--border)] font-mono text-sm">
            <td className="pt-2 text-xs uppercase text-[var(--text-muted)]">Totals</td>
            <td className="pt-2 text-right">{fmt(debit)}</td>
            <td className="pt-2 text-right">{fmt(credit)}</td>
            <td colSpan={3} className="pt-2 text-right">
              <BalancedBadge balanced={balanced} />
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onAddLine}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--bg-secondary)]"
        >
          <Plus className="h-3.5 w-3.5" /> Add line
        </button>
        <div className="flex-1" />
        <button
          type="button"
          disabled={!canDraft || busy || !validation.ok}
          title={
            !canDraft
              ? 'Your role cannot create journal drafts'
              : !validation.ok
                ? validation.error.message
                : undefined
          }
          onClick={onSaveDraft}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Save as draft
        </button>
      </div>
      {!validation.ok && <p className="mt-2 text-xs text-amber-500">{validation.error.message}</p>}
    </section>
  );
}
