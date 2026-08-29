/**
 * Modeling — the acts.
 *
 * Nothing here writes to the book, and that is the whole security posture of the app: no
 * `ledger.post`, no privileged capability, no consent prompt. The only things that leave
 * this window are a CSV and a paragraph, both of which the person asked for by name.
 *
 * Which means "busy" has a smaller job here than in the apps that post: it exists so the
 * export button spins while the file dialog and the write are in flight, and so a second
 * press cannot start a second write to the same path.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { APP_IDS, CHANNEL_ACTIVATED, useApp, useIpc } from '@/platform/sdk';
import { REPORTS } from '../shared/paths';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * `Ctrl+Enter` opens the override, which is the one thing in this window that replaces a
 * computed number with a typed one. `Ctrl+Backspace` takes it away again — destructive of
 * nothing but an assumption, so it needs no confirmation.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey) return key === 'c' ? 'copy' : null;
  if (event.key === 'Enter') return 'override';
  if (event.key === 'Backspace') return 'release';
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  if (key === '1') return 'view:forecast';
  if (key === '2') return 'view:timeline';
  if (key === '3') return 'view:compare';
  return null;
}

/** Which act is in flight. Only one of them can be, so one control spins. */
export type ModelingBusy = 'export' | null;

export interface ModelingActions {
  readonly busy: ModelingBusy;
  copy: (text: string) => void;
  exportCsv: (content: string, suggestedName: string) => void;
  /** Hand-off: Ledger's account focus reads `args.accountId`. */
  openAccount: (accountId: string) => void;
}

export function useModelingActions(): ModelingActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const [busy, setBusy] = useState<ModelingBusy>(null);

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

/**
 * The account a launch is about, both ways in.
 *
 * A cold launch carries it in `runtime.args`; a launch of an already-running window arrives
 * on `CHANNEL_ACTIVATED` instead, because the kernel re-activates the process rather than
 * spawning a second one. Both end on the same selection, which is what lets another window
 * say "model this line" and land on the row.
 */
export function useAccountFocus(onAccount: (accountId: string) => void): void {
  const runtime = useApp();
  // Held in a ref so a new closure per render cannot re-select on its own.
  const sink = useRef(onAccount);
  sink.current = onAccount;

  const launched = useRef(false);
  useEffect(() => {
    const id = runtime.args.accountId;
    if (launched.current || id === undefined || id === '') return;
    launched.current = true;
    sink.current(id);
  }, [runtime]);

  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const id = payload?.args?.accountId;
    if (id !== undefined && id !== '') sink.current(id);
  });
}
