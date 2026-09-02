/**
 * Inbox — the acts.
 *
 * Six commands over two capabilities. The three ledger acts are bound to
 * `ledger.post`; the three handoff acts are bound to `spine.handoff`, a separate
 * grant because it is a separate kind of consequence: approving an entry settles
 * something inside this book, while answering a handoff changes what another
 * department is waiting for.
 *
 * The two are not policed the same way. `ledger.post` is in the kernel's
 * `PRIVILEGED_CAPABILITIES`, so the kernel raises a consent prompt before the first
 * act of it runs and holds the grant for a short window — which is what makes the
 * sweep possible: one prompt, then the batch. `spine.handoff` is not privileged, so
 * accepting, completing and declining raise nothing; the grant is either held by the
 * role or the command fails. That asymmetry is deliberate and it is the same argument
 * `abi.ts` makes about `model.write`: a prompt belongs in front of the act that moves
 * money, and a prompt in front of answering a colleague's question is one people
 * learn to click through. Nothing here asks a second time either way.
 *
 * The three dialogs this app owns are not confirmations. The reject dialog exists
 * because `void_journal_entry` refuses without `p_reason`; the decline dialog exists
 * because `decline_spine_handoff_command` refuses without a note. The approve note is
 * the only optional one, and it lands in the audit trail as `details.reason`, which is
 * the only place a later reader will ever find out why something was waved through.
 *
 * The sweep is the one act that does not go through `useLedgerCommand`. That hook
 * toasts every failure, and twelve toasts is not a report — so the sweep invokes
 * `data.command` itself, stops the moment consent is refused instead of failing
 * eleven more times, and says once what it did. It stays entry-only: a handoff is a
 * question from a named person, and answering forty of them in one keystroke is not
 * triage, it is a rubber stamp.
 */
import { type KeyboardEvent, useCallback, useState } from 'react';
import { APP_IDS, type Localized, useApp, useLedgerCommand } from '@/platform/sdk';
import type { CloseTask, JournalEntry, JournalLine } from '../shared/ledger';
import { DOCUMENTS } from '../shared/paths';
import { type SpineInboxItem, STAGE_LABEL } from '../shared/spine';
import { itemClipboardText, type QueueId, queueCsv, suggestedFileName, type WorkItem } from './queue';

/**
 * What a notification says a handoff was.
 *
 * The route, not the title, is what identifies it to somebody reading a notification
 * centre an hour later: titles repeat across chains, and "Documents → Accounting"
 * says at a glance which desk is now waiting.
 */
const routeOf = (handoff: SpineInboxItem, t: (value: Localized) => string): string =>
  `${t(STAGE_LABEL[handoff.fromStage])} → ${t(STAGE_LABEL[handoff.toStage])} · ${handoff.title}`;

/**
 * In-window accelerators, the manifest's set exactly.
 *
 * `Ctrl+Shift+C` is the one combination allowed to carry Shift, because certifying
 * a close step is the one act that would otherwise collide with copy.
 *
 * The handoff queue adds no keys. `Ctrl+Enter` and `Ctrl+Backspace` already mean
 * "the affirmative act" and "the refusal" on whatever is selected, and the window
 * resolves them against the selected row's kind — on a handoff they become accept or
 * complete, and decline. Giving handoffs their own two combinations would mean four
 * keys for two intentions, and a person switching queues would have to remember
 * which pair the row under the cursor answers to.
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
export type InboxBusy =
  | 'approve'
  | 'reject'
  | 'certify'
  | 'accept'
  | 'complete'
  | 'decline'
  | 'sweep'
  | 'export'
  | null;

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
  /**
   * OPEN → ACCEPTED. Taking the work, not finishing it.
   *
   * The one act with no note, because there is nothing yet to say: accepting means
   * the question has reached the right desk and someone is now answerable for it.
   */
  accept: (handoff: SpineInboxItem) => Promise<boolean>;
  /**
   * OPEN or ACCEPTED → DONE.
   *
   * The command takes an optional note and this window does not collect one, which is
   * deliberate: what answers a handoff is the work, and the chain already records who
   * finished it and when. The only answer that has to be typed is a refusal.
   */
  complete: (handoff: SpineInboxItem) => Promise<boolean>;
  /** OPEN or ACCEPTED → DECLINED. The note is mandatory: it is the answer itself. */
  decline: (handoff: SpineInboxItem, note: string) => Promise<boolean>;
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

/** The three handoff acts, as their own surface. */
interface HandoffCommands {
  accept: (handoff: SpineInboxItem) => Promise<boolean>;
  complete: (handoff: SpineInboxItem) => Promise<boolean>;
  decline: (handoff: SpineInboxItem, note: string) => Promise<boolean>;
}

/**
 * The three handoff commands.
 *
 * Same shape as `certify` — one command, one toast pair, one notification — but a
 * different capability, and a different audience: the row this touches is on somebody
 * else's screen too. That is also why they are the seam: the hook below was over this
 * project's 180-line function budget, and the handoffs are the half of it that answers
 * another department rather than settling something inside this book. The budget is a
 * design input here rather than a lint nag — a hook long enough that nobody reads to
 * the end of it is where a second `setBusy` gets added by accident.
 *
 * Both halves share one `ledger` and one `setBusy`, handed in rather than re-derived:
 * `useLedgerCommand` keeps its own `running` and `error`, so calling it twice would be
 * two answers to "is a command in flight", and two `useState` pairs would let the
 * toolbar spin in two places for one act.
 */
function useHandoffCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: InboxBusy) => void,
): HandoffCommands {
  const runtime = useApp();
  const { t, tr } = runtime.locale;

  const accept = useCallback(
    async (handoff: SpineInboxItem): Promise<boolean> => {
      setBusy('accept');
      const ok = await ledger.run(
        { command: 'spine.handoff.accept', payload: { handoffId: handoff.id } },
        {
          success: tr('تم قبول التحويل.', 'Transmission acceptée.', 'Handoff accepted.'),
          failure: tr('تعذّر القبول.', 'Acceptation impossible.', 'Could not accept.'),
        },
      );
      setBusy(null);
      if (ok) {
        await runtime.notify({
          kind: 'info',
          title: tr('تحويل مقبول', 'Transmission acceptée', 'Handoff accepted'),
          body: routeOf(handoff, t),
        });
      }
      return ok;
    },
    [ledger, runtime, setBusy, t, tr],
  );

  const complete = useCallback(
    async (handoff: SpineInboxItem): Promise<boolean> => {
      setBusy('complete');
      const ok = await ledger.run(
        { command: 'spine.handoff.complete', payload: { handoffId: handoff.id } },
        {
          success: tr('تم إنجاز التحويل.', 'Transmission terminée.', 'Handoff completed.'),
          failure: tr('تعذّر الإنجاز.', 'Achèvement impossible.', 'Could not complete.'),
        },
      );
      setBusy(null);
      if (ok) {
        await runtime.notify({
          kind: 'success',
          title: tr('تحويل منجز', 'Transmission terminée', 'Handoff completed'),
          body: routeOf(handoff, t),
        });
      }
      return ok;
    },
    [ledger, runtime, setBusy, t, tr],
  );

  const decline = useCallback(
    async (handoff: SpineInboxItem, note: string): Promise<boolean> => {
      setBusy('decline');
      // Sent trimmed but never omitted: `decline_spine_handoff_command` requires the
      // note, and the dialog will not submit an empty one, so this cannot be blank
      // unless something else called it wrong — in which case the server refusing is
      // the correct outcome.
      const ok = await ledger.run(
        { command: 'spine.handoff.decline', payload: { handoffId: handoff.id, note: note.trim() } },
        {
          success: tr('تم رفض التحويل.', 'Transmission refusée.', 'Handoff declined.'),
          failure: tr('تعذّر الرفض.', 'Refus impossible.', 'Could not decline.'),
        },
      );
      setBusy(null);
      if (ok) {
        await runtime.notify({
          kind: 'warning',
          title: tr('تحويل مرفوض', 'Transmission refusée', 'Handoff declined'),
          body: `${routeOf(handoff, t)} · ${note.trim()}`,
        });
      }
      return ok;
    },
    [ledger, runtime, setBusy, t, tr],
  );

  return { accept, complete, decline };
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

  // The three handoff acts live in their own hook, and are handed this one's `ledger`
  // and `setBusy` so the toolbar cannot spin twice for a single act.
  const { accept, complete, decline } = useHandoffCommands(ledger, setBusy);

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

  return {
    busy,
    approve,
    reject,
    certify,
    accept,
    complete,
    decline,
    sweep,
    copy,
    exportCsv,
    openAccount,
  };
}



