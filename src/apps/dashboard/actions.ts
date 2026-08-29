/**
 * Dashboard — the acts, such as they are.
 *
 * This app changes nothing. It declares no `ledger.post`, so the kernel would refuse
 * a privileged command even if something here asked for one, and there is no dialog
 * anywhere in the window because there is nothing to confirm.
 *
 * What it does instead is hand work over. Every tile and every row on the attention
 * list carries a `Destination`, and `open` turns that into a launch: the taskbar's
 * jump lists and `useAppCommands`' cold-start verb mean an app can be started
 * *already on* the view a person needs, so pressing "7 waiting on approval" lands in
 * Inbox's approvals queue rather than on whatever Inbox happened to show last. The
 * three targets are the three apps installed; a tile never offers a door that is not
 * there.
 *
 * The other two acts are what anybody does with a dashboard at nine in the morning:
 * paste the numbers into a message, or take the page to a meeting as a CSV.
 */
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react';
import { type AppId, APP_IDS, fmt, type LaunchArgs, useApp } from '@/platform/sdk';
import type { Currency } from '../shared/ledger';
import { REPORTS } from '../shared/paths';
import {
  type Destination,
  type Formatters,
  type PageId,
  pageCsv,
  type Snapshot,
  suggestedFileName,
  summaryText,
  type TargetApp,
} from './metrics';

/** `Ctrl+1`…`Ctrl+5` walk the pages, the way a browser walks tabs. */
const PAGE_KEYS: Readonly<Record<string, string>> = {
  '1': 'page:overview',
  '2': 'page:position',
  '3': 'page:performance',
  '4': 'page:activity',
  '5': 'page:close',
};

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * `Ctrl+C` is deliberately left alone: it belongs to whatever text a person has
 * selected, and stealing it to copy a summary they did not ask for is the kind of
 * small betrayal that makes people stop trusting a window. Copying the summary is
 * `Ctrl+Shift+C`.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  if (event.shiftKey) return event.key.toLowerCase() === 'c' ? 'copy' : null;
  const page = PAGE_KEYS[event.key];
  if (page !== undefined) return page;
  return event.key.toLowerCase() === 'e' ? 'export' : null;
}

/** Only one act can be in flight, and only one of them touches the disk. */
export type DashboardBusy = 'export' | null;

/** The three apps a destination can name, resolved to what the shell launches. */
const TARGET: Readonly<Record<TargetApp, AppId>> = {
  inbox: APP_IDS.inbox,
  journal: APP_IDS.journal,
  ledger: APP_IDS.ledger,
};

export interface DashboardActions {
  readonly busy: DashboardBusy;
  /** Locale-aware formatting, shared with the cards so a number reads the same twice. */
  readonly formatters: Formatters;
  open: (destination: Destination) => void;
  copySummary: (snap: Snapshot) => void;
  exportCsv: (snap: Snapshot, page: PageId) => void;
}

export function useDashboardActions(book: Currency): DashboardActions {
  const runtime = useApp();
  const { t, tr, lang } = runtime.locale;
  const [busy, setBusy] = useState<DashboardBusy>(null);

  const formatters = useMemo<Formatters>(
    () => ({
      t,
      money: (value: number) => fmt.money(value, book, lang),
      percent: (fraction: number) => fmt.percent(fraction, lang),
      integer: (value: number) => fmt.integer(value, lang),
    }),
    [book, lang, t],
  );

  const open = useCallback(
    (destination: Destination) => {
      const args: Record<string, string> = {};
      if (destination.command !== undefined) args.command = destination.command;
      if (destination.accountId !== undefined) args.accountId = destination.accountId;
      void runtime.launch(TARGET[destination.app], args as LaunchArgs);
    },
    [runtime],
  );

  const copySummary = useCallback(
    (snap: Snapshot) => {
      const text = summaryText(snap, formatters);
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) => {
        void runtime.toast(
          result.ok
            ? { kind: 'success', title: tr('تم نسخ الملخص.', 'Résumé copié.', 'Summary copied.') }
            : { kind: 'error', title: tr('تعذّر النسخ.', 'Copie impossible.', 'Could not copy.') },
        );
      });
    },
    [formatters, runtime, tr],
  );

  const exportCsv = useCallback(
    (snap: Snapshot, page: PageId) => {
      const run = async () => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير الصفحة', 'Exporter la page', 'Export this page'),
          startPath: REPORTS,
          suggestedName: suggestedFileName(page, snap.today),
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
          content: pageCsv(snap, page, t),
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
    [runtime, t, tr],
  );

  return { busy, formatters, open, copySummary, exportCsv };
}
