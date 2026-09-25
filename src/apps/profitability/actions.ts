/**
 * Profitability — the acts.
 *
 * Three things leave this window and none of them touch the book: a table, a
 * paragraph, and a launch of the ledger. No `ledger.post`, no privileged
 * capability, no consent prompt — an analysis that could change a number would not
 * be one, and the manifest says so before the kernel loads a line of this.
 *
 * `busy` names the act in flight rather than being a boolean, so exactly one
 * control spins, and a second press cannot start a second write to the same path
 * while the first dialog is still open.
 */
import { type KeyboardEvent, useCallback } from 'react';
import { APP_IDS, useApp } from '@/platform/sdk';
import type { ExportFormat, TableDocument } from '../shared/export';
import { useExport } from '../shared/useExport';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * The number keys pick a dimension, in the order the toolbar shows them. There is
 * no `Ctrl+S`, because this window owns no document — the question it was asked is
 * two clicks to restate and a saved copy of it would only go stale.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'c' ? 'copy' : null;
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  if (key === '1') return 'dimension:package';
  if (key === '2') return 'dimension:branch';
  return null;
}

/** Which act is in flight. Only one can be, so exactly one control spins. */
export type ProfitabilityBusy = 'export' | null;

export interface ProfitabilityActions {
  readonly busy: ProfitabilityBusy;
  copy: (text: string) => void;
  /** Save the table in front of the person, in the format they picked. */
  exportTable: (doc: TableDocument, suggestedName: string, format: ExportFormat) => void;
  /** Hand-off: the Ledger's account focus reads `args.accountId`. */
  openAccount: (accountId: string) => void;
}

export function useProfitabilityActions(): ProfitabilityActions {
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

  // Two acts, and only one of them can be in flight: the export hook owns the dialog
  // and the write, and `busy` is that hook's answer said in this window's vocabulary.
  const busy: ProfitabilityBusy = exporting !== null ? 'export' : null;

  return { busy, copy, exportTable, openAccount };
}
