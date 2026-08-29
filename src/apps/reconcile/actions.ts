/**
 * Reconciliation — the acts.
 *
 * Two commands, both `ledger.post`, both privileged. The kernel raises its own
 * consent before the first one and holds it briefly, which is what makes the sweep
 * possible: one prompt, then the batch. Nothing here asks a second time, and there
 * is no confirmation dialog on a match — a match is reversible, and every match
 * worth confirming is one the server refuses outright.
 *
 * The sweep is the one act that does not go through `useLedgerCommand`. That hook
 * toasts every failure, and eleven toasts is not a report: the sweep invokes
 * `data.command` itself, stops the moment consent is refused rather than failing ten
 * more times the same way, and says once what it did.
 *
 * Unmatching is the act that can be refused for a reason worth reading — a `LOCKED`
 * statement has been signed off, and reversing a match on it would restate a
 * reconciliation somebody already certified. The window disables the button when it
 * can see the lock, and the server refuses when it cannot.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { APP_IDS, CHANNEL_ACTIVATED, useApp, useIpc, useLedgerCommand } from '@/platform/sdk';
import type { BankStatement, BankTransaction } from '../shared/ledger';
import { DOCUMENTS } from '../shared/paths';
import type { AutoMatch, Candidate, LedgerRow } from './match';
import { differenceCsv, suggestedFileName, transactionClipboardText } from './report';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * `Ctrl+Shift+A` is the only combination carrying Shift: the sweep is the one act
 * that touches rows nobody selected, so it does not get a bare accelerator.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  if (event.shiftKey) return event.key.toLowerCase() === 'a' ? 'auto' : null;
  if (event.key === 'Enter') return 'match';
  if (event.key === 'Backspace') return 'unmatch';
  const key = event.key.toLowerCase();
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  return null;
}

/** Which act is in flight, so one button spins rather than all of them. */
export type ReconcileBusy = 'match' | 'unmatch' | 'auto' | 'export' | null;

/** What a sweep did, in the numbers the summary reports. */
export interface SweepReport {
  readonly matched: number;
  readonly failed: number;
  /** True when consent was refused and the rest were never attempted. */
  readonly stopped: boolean;
  readonly firstError: string | null;
}

export interface ReconcileActions {
  readonly busy: ReconcileBusy;
  match: (transaction: BankTransaction, candidate: Candidate) => Promise<boolean>;
  unmatch: (transaction: BankTransaction) => Promise<boolean>;
  sweep: (plan: readonly AutoMatch[]) => Promise<SweepReport>;
  copy: (transaction: BankTransaction, candidate: Candidate | null) => void;
  exportCsv: (
    transactions: readonly BankTransaction[],
    ledgerRows: readonly LedgerRow[],
    statement: BankStatement | null,
    today: string,
  ) => void;
  /** Hand-off: Ledger's account focus reads `args.accountId`. */
  openLedgerAccount: (accountId: string) => void;
}

export function useReconcileActions(): ReconcileActions {
  const runtime = useApp();
  const { t, tr } = runtime.locale;
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<ReconcileBusy>(null);

  const match = useCallback(
    async (transaction: BankTransaction, candidate: Candidate): Promise<boolean> => {
      setBusy('match');
      const ok = await ledger.run(
        {
          command: 'reconcile.match',
          payload: { transactionId: transaction.id, journalLineId: candidate.row.line.id },
        },
        {
          success: tr('تمت المطابقة.', 'Ligne rapprochée.', 'Line matched.'),
          failure: tr('تعذّرت المطابقة.', 'Rapprochement impossible.', 'Could not match.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, tr],
  );

  const unmatch = useCallback(
    async (transaction: BankTransaction): Promise<boolean> => {
      setBusy('unmatch');
      const ok = await ledger.run(
        { command: 'reconcile.unmatch', payload: { transactionId: transaction.id } },
        {
          success: tr('تم إلغاء المطابقة.', 'Rapprochement annulé.', 'Match reversed.'),
          failure: tr('تعذّر الإلغاء.', 'Annulation impossible.', 'Could not reverse the match.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, tr],
  );

  const sweep = useCallback(
    async (plan: readonly AutoMatch[]): Promise<SweepReport> => {
      setBusy('auto');
      let matched = 0;
      let failed = 0;
      let stopped = false;
      let firstError: string | null = null;
      for (const pair of plan) {
        const result = await runtime.invoke('data.command', {
          command: 'reconcile.match',
          payload: { transactionId: pair.transaction.id, journalLineId: pair.candidate.row.line.id },
        });
        if (result.ok) {
          matched += 1;
          continue;
        }
        failed += 1;
        if (firstError === null) firstError = result.error.message;
        // Consent refused, or the capability is not held: every pairing left would
        // fail the same way, and a run of identical refusals is noise.
        if (result.error.code === 'ELEVATION_REQUIRED' || result.error.code === 'PERMISSION_DENIED') {
          stopped = true;
          break;
        }
      }
      setBusy(null);
      // A sweep changes rows somebody else is looking at, so it is news rather than
      // a toast — but only when it actually did something.
      if (matched > 0) {
        await runtime.notify({
          kind: 'success',
          title: tr('مطابقة تلقائية', 'Rapprochement automatique', 'Auto-match'),
          body: tr(
            `طوبقت ${matched} سطرًا`,
            `${matched} ligne(s) rapprochée(s)`,
            `${matched} line(s) matched`,
          ),
        });
      }
      return { matched, failed, stopped, firstError };
    },
    [runtime, tr],
  );

  const copy = useCallback(
    (transaction: BankTransaction, candidate: Candidate | null) => {
      const text = transactionClipboardText(transaction, candidate, t);
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) => {
        void runtime.toast(
          result.ok
            ? { kind: 'success', title: tr('تم النسخ.', 'Copié.', 'Copied.') }
            : { kind: 'error', title: tr('تعذّر النسخ.', 'Copie impossible.', 'Could not copy.') },
        );
      });
    },
    [runtime, t, tr],
  );

  const exportCsv = useCallback(
    (
      transactions: readonly BankTransaction[],
      ledgerRows: readonly LedgerRow[],
      statement: BankStatement | null,
      today: string,
    ) => {
      const run = async () => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير الفروق', 'Exporter les écarts', 'Export the differences'),
          startPath: DOCUMENTS,
          suggestedName: suggestedFileName(statement, today),
          contentTypes: ['text/csv'],
        });
        // A cancelled dialog is an answer, not a failure: nothing is said about it.
        const path = chosen.ok ? chosen.value.path : null;
        if (path === null) {
          setBusy(null);
          return;
        }
        const written = await runtime.invoke('fs.writeText', {
          path,
          content: differenceCsv(transactions, ledgerRows),
          contentType: 'text/csv',
        });
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

  const openLedgerAccount = useCallback(
    (accountId: string) => {
      void runtime.launch(APP_IDS.ledger, { accountId });
    },
    [runtime],
  );

  return { busy, match, unmatch, sweep, copy, exportCsv, openLedgerAccount };
}

/**
 * The bank account a launch is about, both ways in.
 *
 * A cold launch carries it in `runtime.args`; a launch of an already-running window
 * arrives on `CHANNEL_ACTIVATED` instead, because the kernel re-activates the
 * process rather than spawning a second one. Both end on the same selection, which
 * is what lets Treasury and the dashboard say "reconcile this account" and mean it.
 */
export function useBankFocus(onAccount: (accountId: string) => void): void {
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
