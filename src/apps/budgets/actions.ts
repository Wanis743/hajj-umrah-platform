/**
 * Budgets — the acts.
 *
 * One command writes: `budget.upsert`, which carries `ledger.post` and is therefore
 * privileged, so the kernel raises its own consent every time an amount is set. The
 * dialog this app owns is a field, not a confirmation — asking twice is how people learn
 * to click through the question that matters.
 *
 * `upsert_budget_line` takes both currencies and writes both. A plan typed in dinars
 * would zero the riyal amount if only one were sent, so every write carries the line's
 * other amount back unchanged. That is why the report keeps whole budget lines around
 * instead of only the figure it compares against.
 *
 * Nothing here posts to the book. A budget line moves; the ledger does not.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { APP_IDS, CHANNEL_ACTIVATED, useApp, useIpc, useLedgerCommand } from '@/platform/sdk';
import { REPORTS } from '../shared/paths';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * `Ctrl+Enter` commits the amount because the dialog is a one-field form and the hands
 * are already on the keyboard. `Ctrl+Shift+S` takes the actual as the plan — a write
 * that overwrites a number somebody typed, so it carries Shift.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  if (event.shiftKey) return event.key.toLowerCase() === 's' ? 'seed' : null;
  if (event.key === 'Enter') return 'set';
  const key = event.key.toLowerCase();
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  return null;
}

/** Which act is in flight, so one control spins rather than all of them. */
export type BudgetBusy = 'set' | 'seed' | 'export' | null;

/** Why an amount is being written, which is the difference between typing and copying. */
export type PlanIntent = 'set' | 'seed';

/** Both amounts of a line, because the upsert writes both every time. */
export interface PlanAmounts {
  readonly dzd: number;
  readonly sar: number;
}

export interface BudgetActions {
  readonly busy: BudgetBusy;
  setAmount: (budgetId: string, accountId: string, amounts: PlanAmounts, intent: PlanIntent) => Promise<boolean>;
  copy: (text: string) => void;
  exportCsv: (content: string, suggestedName: string) => void;
  /** Hand-off: Ledger's account focus reads `args.accountId`. */
  openAccount: (accountId: string) => void;
}

export function useBudgetActions(): BudgetActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<BudgetBusy>(null);

  const setAmount = useCallback(
    async (budgetId: string, accountId: string, amounts: PlanAmounts, intent: PlanIntent): Promise<boolean> => {
      setBusy(intent);
      const ok = await ledger.run(
        {
          command: 'budget.upsert',
          payload: { budgetId, accountId, amountDzd: amounts.dzd, amountSar: amounts.sar },
        },
        {
          success: tr('حُدِّثت الخطة.', 'Plan mis à jour.', 'Plan updated.'),
          // A locked budget refuses at the server, and its message says so.
          failure: tr('تعذّر تحديث الخطة.', 'Mise à jour impossible.', 'Could not update the plan.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, tr],
  );

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

  return { busy, setAmount, copy, exportCsv, openAccount };
}

/**
 * The account a launch is about, both ways in.
 *
 * A cold launch carries it in `runtime.args`; a launch of an already-running window
 * arrives on `CHANNEL_ACTIVATED` instead, because the kernel re-activates the process
 * rather than spawning a second one. Both end on the same selection, which is what lets
 * the dashboard say "the overspend is here" and land on the row.
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
