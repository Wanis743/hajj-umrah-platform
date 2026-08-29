/**
 * Profitability — the acts.
 *
 * Three things leave this window and none of them touch the book: a CSV, a
 * paragraph, and a launch of the ledger. No `ledger.post`, no privileged
 * capability, no consent prompt — an analysis that could change a number would not
 * be one, and the manifest says so before the kernel loads a line of this.
 *
 * `busy` names the act in flight rather than being a boolean, so exactly one
 * control spins, and a second press cannot start a second write to the same path
 * while the first dialog is still open.
 */
import { type KeyboardEvent, useCallback, useState } from 'react';
import { APP_IDS, useApp } from '@/platform/sdk';
import { REPORTS } from '../shared/paths';

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
  exportCsv: (content: string, suggestedName: string) => void;
  /** Hand-off: the Ledger's account focus reads `args.accountId`. */
  openAccount: (accountId: string) => void;
}

export function useProfitabilityActions(): ProfitabilityActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const [busy, setBusy] = useState<ProfitabilityBusy>(null);

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

  const exportCsv = useCallback(
    (content: string, suggestedName: string) => {
      const run = async () => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير', 'Exporter', 'Export'),
          startPath: REPORTS,
          suggestedName,
          contentTypes: ['text/csv'],
        });
        // A cancelled dialog is an answer, not a failure: nothing is said about it.
        const path = chosen.ok ? chosen.value.path : null;
        if (path === null) {
          setBusy(null);
          return;
        }
        const written = await runtime.invoke('fs.writeText', { path, content, contentType: 'text/csv' });
        setBusy(null);
        await runtime.toast(
          written.ok
            ? { kind: 'success', title: tr('تم التصدير.', 'Export terminé.', 'Exported.'), body: path }
            : {
                kind: 'error',
                title: tr('تعذّر التصدير.', 'Export impossible.', 'Could not export.'),
                body: written.error.message,
              },
        );
      };
      void run();
    },
    [runtime, tr],
  );

  const openAccount = useCallback(
    (accountId: string) => {
      void runtime.launch(APP_IDS.ledger, { accountId });
    },
    [runtime],
  );

  return { busy, copy, exportCsv, openAccount };
}
