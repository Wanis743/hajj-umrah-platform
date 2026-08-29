/**
 * Ledger — the acts.
 *
 * Two writes, one file, one clipboard. Both writes are the same RPC:
 * `upsert_chart_account` creates when `p_id` is null and updates when it is not,
 * so `save` and `setActive` differ only in the payload they hand it.
 *
 * Nothing here asks "are you sure?". `account.create` and `account.update` are
 * both bound to `ledger.post`, which the kernel counts as privileged, so it raises
 * its own consent before either RPC runs. A second dialog in front of the kernel's
 * own would not make the decision safer — it would teach people to click through
 * both, which makes every later prompt weaker.
 *
 * Deactivation is the one act worth a notification rather than a toast: it takes an
 * account out of every other app's picker, and a toast that has faded is not a
 * record of that. The notification carries the account id back with it, so the
 * click lands on the account the message is about.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_ACTIVATED, useApp, useIpc, useLedgerCommand } from '@/platform/sdk';
import type { Account } from '../shared/ledger';
import { REPORTS } from '../shared/paths';
import {
  accountClipboardText,
  type LedgerView,
  type Posting,
  type Rollup,
  suggestedFileName,
} from './accounts';
import { type AccountDraft, accountPayload, activePayload, draftCommand } from './form';

/**
 * In-window accelerators.
 *
 * The set is the manifest's, exactly — an app whose own shortcuts and whose
 * declared commands disagree is an app whose command palette lies. Dispatch goes
 * to the same handler `useAppCommands` feeds, so a key, a jump-list entry and a
 * palette hit are one code path.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (event.key === 'F2') return 'edit';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'n') return 'new';
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  return null;
}

/** Which act is in flight, so one button spins rather than all of them. */
export type LedgerBusy = 'save' | 'active' | 'export' | null;

export interface LedgerActions {
  readonly busy: LedgerBusy;
  /** Create or update, whichever the draft is. Resolves true when it landed. */
  save: (draft: AccountDraft) => Promise<boolean>;
  /** The one flag, resent with the whole account because the RPC requires it. */
  setActive: (account: Account, next: boolean) => void;
  exportCsv: (view: LedgerView, content: string, today: string) => void;
  copy: (account: Account, totals: Rollup, postings: readonly Posting[]) => void;
}

export function useLedgerActions(): LedgerActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<LedgerBusy>(null);

  const save = useCallback(
    async (draft: AccountDraft): Promise<boolean> => {
      setBusy('save');
      const creating = draft.id === null;
      const ok = await ledger.run(
        { command: draftCommand(draft), payload: accountPayload(draft) },
        {
          success: creating
            ? tr('تم إنشاء الحساب.', 'Compte créé.', 'Account created.')
            : tr('تم تحديث الحساب.', 'Compte mis à jour.', 'Account updated.'),
          failure: creating
            ? tr('تعذّر إنشاء الحساب.', 'Création impossible.', 'Could not create the account.')
            : tr('تعذّر تحديث الحساب.', 'Mise à jour impossible.', 'Could not update the account.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, tr],
  );

  const setActive = useCallback(
    (account: Account, next: boolean) => {
      const run = async () => {
        setBusy('active');
        const ok = await ledger.run(
          { command: 'account.update', payload: activePayload(account, next) },
          {
            success: next
              ? tr('تم تفعيل الحساب.', 'Compte réactivé.', 'Account reactivated.')
              : tr('تم إيقاف الحساب.', 'Compte désactivé.', 'Account deactivated.'),
            failure: tr('تعذّر تغيير الحالة.', 'Changement d’état impossible.', 'Could not change the state.'),
          },
        );
        setBusy(null);
        // Only the deactivation is announced. Bringing an account back adds a
        // choice; taking one away removes it from every other app's picker, and
        // that is the half somebody may need to find again later.
        if (ok && !next) {
          await runtime.notify({
            kind: 'warning',
            title: tr('حساب غير مفعّل', 'Compte désactivé', 'Account deactivated'),
            body: `${account.code} · ${account.name}`,
            launch: runtime.appId,
            args: { accountId: account.id },
          });
        }
      };
      void run();
    },
    [ledger, runtime, tr],
  );

  const copy = useCallback(
    (account: Account, totals: Rollup, postings: readonly Posting[]) => {
      const text = accountClipboardText(account, totals, postings);
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
    (view: LedgerView, content: string, today: string) => {
      const run = async () => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير CSV', 'Exporter en CSV', 'Export as CSV'),
          // A chart and a trial balance are both reports about the book rather
          // than documents of it, so they are offered where the reports live.
          startPath: REPORTS,
          suggestedName: suggestedFileName(view, today),
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

  return { busy, save, setActive, exportCsv, copy };
}

/**
 * The account a launch is about, both ways in.
 *
 * A cold launch carries it in `runtime.args`; a launch of an already-running
 * Ledger arrives on `CHANNEL_ACTIVATED` instead, because the kernel re-activates
 * the process rather than spawning a second one. Both end on the same selection.
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
