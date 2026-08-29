/**
 * Inbox — the acts.
 *
 * Three commands, all bound to `ledger.post`, all privileged. The kernel raises its
 * own consent before the first one runs and holds it for a short window, which is
 * exactly what makes the sweep possible: one prompt, then the batch. Nothing here
 * asks a second time.
 *
 * The two dialogs this app owns are not confirmations. The reject dialog exists
 * because `void_journal_entry` refuses without `p_reason`. The approve note is
 * optional and lands in the audit trail as `details.reason`, which is the only
 * place a later reader will ever find out why something was waved through.
 *
 * The sweep is the one act that does not go through `useLedgerCommand`. That hook
 * toasts every failure, and twelve toasts is not a report — so the sweep invokes
 * `data.command` itself, stops the moment consent is refused instead of failing
 * eleven more times, and says once what it did.
 */
import { type KeyboardEvent, useCallback, useState } from 'react';
import { APP_IDS, useApp, useLedgerCommand } from '@/platform/sdk';
import type { CloseTask, JournalEntry, JournalLine } from '../shared/ledger';
import { DOCUMENTS } from '../shared/paths';
import { itemClipboardText, type QueueId, queueCsv, suggestedFileName, type WorkItem } from './queue';

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * `Ctrl+Shift+C` is the one combination allowed to carry Shift, because certifying
 * a close step is the one act that would otherwise collide with copy.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  if (event.shiftKey) return event.key.toLowerCase() === 'c' ? 'certify' : null;
  if (event.key === 'Enter') return 'approve';
  if (event.key === 'Backspace') return 'reject';
  const key = event.key.toLowerCase();
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  return null;
}

/** Which act is in flight, so one button spins rather than all of them. */
export type InboxBusy = 'approve' | 'reject' | 'certify' | 'sweep' | 'export' | null;

/** What a sweep did, in the numbers the summary dialog reports. */
export interface SweepReport {
  readonly approved: number;
  readonly failed: number;
  /** True when consent was refused and the rest were never attempted. */
  readonly stopped: boolean;
  readonly firstError: string | null;
}

export interface InboxActions {
  readonly busy: InboxBusy;
  /** Draft → posted. The note is optional and becomes `details.reason`. */
  approve: (entry: JournalEntry, note: string) => Promise<boolean>;
  /** Draft → void with the reason the RPC requires. A posted entry gets a reversal. */
  reject: (entry: JournalEntry, reason: string) => Promise<boolean>;
  certify: (task: CloseTask) => Promise<boolean>;
  sweep: (entries: readonly JournalEntry[]) => Promise<SweepReport>;
  copy: (
    item: WorkItem,
    lines: readonly JournalLine[],
    accountLabelOf: (accountId: string | null) => string,
  ) => void;
  exportCsv: (items: readonly WorkItem[], queue: QueueId, today: string) => void;
  /** Hand-off: Ledger's account focus reads `args.accountId`. */
  openAccount: (accountId: string) => void;
}

export function useInboxActions(): InboxActions {
  const runtime = useApp();
  const { t, tr } = runtime.locale;
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<InboxBusy>(null);

  const approve = useCallback(
    async (entry: JournalEntry, note: string): Promise<boolean> => {
      setBusy('approve');
      const reason = note.trim();
      const ok = await ledger.run(
        {
          command: 'journal.post',
          // Omitted rather than empty: `p_reason` null leaves the audit row's
          // `details.reason` absent, which reads as "no note" instead of "blank".
          payload: reason === '' ? { journalId: entry.id } : { journalId: entry.id, reason },
        },
        {
          success: tr('تم اعتماد القيد.', 'Écriture approuvée.', 'Entry approved.'),
          failure: tr('تعذّر الاعتماد.', 'Approbation impossible.', 'Could not approve.'),
        },
      );
      setBusy(null);
      // An approval is somebody else's news: the author is waiting on it, and a
      // toast in this window is not a record they will ever see.
      if (ok) {
        await runtime.notify({
          kind: 'success',
          title: tr('قيد معتمد', 'Écriture approuvée', 'Entry approved'),
          body: `${entry.reference} · ${entry.date}`,
        });
      }
      return ok;
    },
    [ledger, runtime, tr],
  );

  const reject = useCallback(
    async (entry: JournalEntry, reason: string): Promise<boolean> => {
      setBusy('reject');
      const ok = await ledger.run(
        { command: 'journal.void', payload: { journalId: entry.id, reason: reason.trim() } },
        {
          // A draft is rejected outright; anything already posted gets a mirrored
          // reversal instead, so the message names neither.
          success: tr('تم رفض القيد.', 'Écriture refusée.', 'Entry rejected.'),
          failure: tr('تعذّر الرفض.', 'Refus impossible.', 'Could not reject.'),
        },
      );
      setBusy(null);
      if (ok) {
        await runtime.notify({
          kind: 'warning',
          title: tr('قيد مرفوض', 'Écriture refusée', 'Entry rejected'),
          body: `${entry.reference} · ${reason.trim()}`,
        });
      }
      return ok;
    },
    [ledger, runtime, tr],
  );

  const certify = useCallback(
    async (task: CloseTask): Promise<boolean> => {
      setBusy('certify');
      // No status in the payload: `complete_close_task` defaults to 'certified',
      // and certifying is the only transition this window offers.
      const ok = await ledger.run(
        { command: 'closeTask.complete', payload: { taskId: task.id } },
        {
          success: tr('تم تصديق الخطوة.', 'Étape certifiée.', 'Step certified.'),
          failure: tr('تعذّر التصديق.', 'Certification impossible.', 'Could not certify.'),
        },
      );
      setBusy(null);
      if (ok) {
        await runtime.notify({
          kind: 'success',
          title: tr('خطوة مصدّقة', 'Étape certifiée', 'Step certified'),
          body: task.name,
        });
      }
      return ok;
    },
    [ledger, runtime, tr],
  );

  const sweep = useCallback(
    async (entries: readonly JournalEntry[]): Promise<SweepReport> => {
      setBusy('sweep');
      let approved = 0;
      let failed = 0;
      let stopped = false;
      let firstError: string | null = null;
      for (const entry of entries) {
        const result = await runtime.invoke('data.command', {
          command: 'journal.post',
          payload: { journalId: entry.id },
        });
        if (result.ok) {
          approved += 1;
          continue;
        }
        failed += 1;
        if (firstError === null) firstError = result.error.message;
        // Consent refused, or the capability is not held: every entry left would
        // fail the same way, and a run of identical refusals is noise.
        if (result.error.code === 'ELEVATION_REQUIRED' || result.error.code === 'PERMISSION_DENIED') {
          stopped = true;
          break;
        }
      }
      setBusy(null);
      return { approved, failed, stopped, firstError };
    },
    [runtime],
  );

  const copy = useCallback(
    (
      item: WorkItem,
      lines: readonly JournalLine[],
      accountLabelOf: (accountId: string | null) => string,
    ) => {
      const text = itemClipboardText(item, lines, accountLabelOf, t);
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
    (items: readonly WorkItem[], queue: QueueId, today: string) => {
      const run = async () => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير القائمة', 'Exporter la liste', 'Export the queue'),
          startPath: DOCUMENTS,
          suggestedName: suggestedFileName(queue, today),
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
          content: queueCsv(items, t),
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

  const openAccount = useCallback(
    (accountId: string) => {
      void runtime.launch(APP_IDS.ledger, { accountId });
    },
    [runtime],
  );

  return { busy, approve, reject, certify, sweep, copy, exportCsv, openAccount };
}



