/**
 * Treasury — the acts.
 *
 * Four things leave this window and not one of them writes a number: a report, a
 * paragraph, and two hand-offs. No `ledger.post`, no privileged capability, no consent
 * prompt — a cash report that could move a balance would not be a report, and the
 * manifest says as much before the kernel loads a line of this.
 *
 * The two hand-offs are the whole reason this window has `shell.launch`. A treasurer
 * looking at a gap asks one of exactly two questions — "which postings make up the book
 * side" and "why do the two disagree" — and neither is Treasury's to answer. The first
 * belongs to the general ledger and the second to reconciliation, and both windows
 * already take an account on launch.
 *
 * `busy` names the act in flight rather than being a boolean, so exactly one control
 * spins and a second press cannot start a second write to the same path while the first
 * dialog is still open.
 */
import { type KeyboardEvent, useCallback } from 'react';
import { APP_IDS, useApp } from '@/platform/sdk';
import type { ExportFormat, TableDocument } from '../shared/export';
import { useExport } from '../shared/useExport';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * The number keys pick a lens, in the order the toolbar shows them. There is no
 * `Ctrl+S`: this window owns no document, and a saved copy of a cash position would be
 * wrong by the afternoon.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'c' ? 'copy' : null;
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  if (key === '1') return 'lens:cash';
  if (key === '2') return 'lens:payable';
  if (key === '3') return 'lens:receivable';
  return null;
}

/** Which act is in flight. Only one can be, so exactly one control spins. */
export type TreasuryBusy = 'export' | null;

export interface TreasuryActions {
  readonly busy: TreasuryBusy;
  copy: (text: string) => void;
  /** Save the table in front of the person, in the format they picked. */
  exportTable: (doc: TableDocument, suggestedName: string, format: ExportFormat) => void;
  /** Hand-off: the Ledger's focus reads `args.accountId` as a *ledger* account. */
  openAccount: (accountId: string) => void;
  /** Hand-off: Reconciliation's focus reads `args.accountId` as a *bank* account. */
  openReconcile: (bankAccountId: string) => void;
}

export function useTreasuryActions(): TreasuryActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const { busy: exporting, exportTable } = useExport();

  const copy = useCallback(
    (text: string) => {
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) => {
        void runtime.toast(
          result.ok
            ? { kind: 'success', title: tr('تم النسخ.', 'Copié.', 'Copied.') }
            : { kind: 'error', title: tr('تعذّر النسخ.', 'Copie impossible.', 'Could not copy.') },
        );
      });
    },
    [runtime, tr],
  );

  const openAccount = useCallback(
    (accountId: string) => {
      void runtime.launch(APP_IDS.ledger, { accountId });
    },
    [runtime],
  );

  const openReconcile = useCallback(
    (bankAccountId: string) => {
      void runtime.launch(APP_IDS.reconcile, { accountId: bankAccountId });
    },
    [runtime],
  );

  // The window names one act, not four formats: the toolbar's Export control
  // spins whichever of them is being written.
  const busy: TreasuryBusy = exporting === null ? null : 'export';

  return { busy, copy, exportTable, openAccount, openReconcile };
}
