/**
 * Customers — the acts.
 *
 * Thirty commands go through one `useLedgerCommand`, because a single answer to
 * "is a write in flight" is the only one a toolbar can trust. `busy` names which act
 * it is, so the control that raised it is the only one that spins.
 *
 * Twenty-nine of the thirty carry `crm.write`, which the kernel does not count as
 * privileged: nothing stands in front of them. That is right for a create or an
 * update, where the record is there afterwards and can be corrected. It is not right
 * for the eight deletes, which are the only irreversible acts in this app, so
 * `remove` raises the consent the kernel will not.
 *
 * The thirtieth is `crm.quote.accept`, and it asks nothing. Accepting carries
 * `ledger.post`, so the kernel raises its own consent before the RPC runs — and that
 * RPC confirms a booking, records the deposit, posts the payment's journal, takes the
 * seats, expires the sibling quotes and wins the opportunity in one transaction. A
 * dialog in front of the kernel's own would not make the sale safer; it would teach
 * people to click through both, which makes every later prompt weaker. The accept
 * dialog collects the amount and the method, and exists for no other reason.
 *
 * A sale is announced rather than toasted, for the reason a period close is: money
 * moved, and the window may be behind something else by the time it lands.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { type AppId, CHANNEL_ACTIVATED, useApp, useIpc, useLedgerCommand } from '@/platform/sdk';
import { REPORTS } from '../shared/paths';
import { suggestedFileName } from './export';
import {
  type CrmEntity,
  type RecordDraft,
  commandFor,
  deleteCommandFor,
  ENTITY_TITLE,
  recordPayload,
} from './form';
import {
  type AcceptDraft,
  type ConvertDraft,
  type StageDraft,
  acceptPayload,
  completePayload,
  convertPayload,
  declinePayload,
  LIFECYCLE_COMMANDS,
  sendPayload,
  stagePayload,
  tagsPayload,
} from './lifecycle';
import type { CrmView } from './model';

/**
 * The nine accelerators the manifest declares, and nothing else.
 *
 * `Ctrl+Enter` is the affirmative act across the suite and resolves against the
 * surface: on a lead it converts, on a quote it accepts. Anywhere else it means
 * nothing, so it returns null rather than guessing at the nearest verb. The shift
 * branch has to be tested first, or `Ctrl+Shift+Enter` would fall through to the
 * plain one and an accept would convert something.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>, view: CrmView): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  if (event.shiftKey) {
    if (event.key === 'Enter') return 'accept';
    const shifted = event.key.toLowerCase();
    if (shifted === 's') return 'send';
    if (shifted === 'f') return 'followup';
    return null;
  }
  if (event.key === 'Enter') {
    if (view === 'leads') return 'convert';
    return view === 'quotes' ? 'accept' : null;
  }
  if (event.key === 'Backspace') return 'decline';
  const key = event.key.toLowerCase();
  if (key === 'n') return 'new';
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  return null;
}

/** Which act is in flight. The seven middle members are the lifecycle command keys. */
export type CrmBusy =
  | 'save'
  | 'delete'
  | 'convert'
  | 'tags'
  | 'stage'
  | 'send'
  | 'accept'
  | 'decline'
  | 'complete'
  | 'export'
  | null;

/** Which grid an inbound launch argument lands on. */
const ARG_VIEW: Readonly<Record<string, CrmView>> = {
  leadId: 'leads',
  customerId: 'customers',
  opportunityId: 'pipeline',
  quoteId: 'quotes',
  followupId: 'followups',
  campaignId: 'campaigns',
};

export interface CrmTarget {
  readonly view: CrmView;
  readonly id: string;
}

/** The first recognised id in a launch. There is no arg for a single activity: a log
 *  line is not a place another app has any reason to send somebody. */
const targetFrom = (args: Readonly<Record<string, string>> | undefined): CrmTarget | null => {
  if (args === undefined) return null;
  for (const [key, view] of Object.entries(ARG_VIEW)) {
    const id = args[key];
    if (id !== undefined && id !== '') return { view, id };
  }
  return null;
};

/**
 * A launch that points at a record. Cold start reads `args` once — reading it again
 * would drag the selection back after somebody had moved on — and every later
 * activation arrives over the channel carrying the same shape.
 */
export function useCrmFocus(onTarget: (target: CrmTarget) => void): void {
  const runtime = useApp();
  const sink = useRef(onTarget);
  sink.current = onTarget;
  const launched = useRef(false);

  useEffect(() => {
    if (launched.current) return;
    const target = targetFrom(runtime.args);
    if (target === null) return;
    launched.current = true;
    sink.current(target);
  }, [runtime]);

  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const target = targetFrom(payload?.args);
    if (target !== null) sink.current(target);
  });
}

export interface RecordCommands {
  /** Create or update, routed by whether the draft already has an id. */
  save: (draft: RecordDraft) => Promise<boolean>;
  /** Delete, behind the consent the kernel does not raise for `crm.write`. */
  remove: (entity: CrmEntity, id: string, label: string) => Promise<boolean>;
}

/**
 * The twenty-three CRUD writes. `ENTITY_TITLE` is the only place the app keeps its
 * nouns, so a toast, a title bar and a delete prompt cannot drift apart.
 */
export function useRecordCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: CrmBusy) => void,
): RecordCommands {
  const runtime = useApp();
  const { t, tr } = runtime.locale;

  const save = useCallback(
    async (draft: RecordDraft): Promise<boolean> => {
      const command = commandFor(draft.entity, draft.id);
      // Null for an activity being edited: the log has no update command to route to.
      if (command === null) return false;
      const noun = t(ENTITY_TITLE[draft.entity]);
      const creating = draft.id === null;
      setBusy('save');
      const ok = await ledger.run(
        { command, payload: recordPayload(draft) },
        {
          success: creating
            ? tr(`تم إنشاء ${noun}.`, `Créé : ${noun}`, `${noun} created.`)
            : tr(`تم تحديث ${noun}.`, `Mis à jour : ${noun}`, `${noun} updated.`),
          failure: creating
            ? tr(`تعذّر إنشاء ${noun}.`, `Création impossible : ${noun}`, `Could not create ${noun}.`)
            : tr(`تعذّر تحديث ${noun}.`, `Mise à jour impossible : ${noun}`, `Could not update ${noun}.`),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, t, tr],
  );

  const remove = useCallback(
    async (entity: CrmEntity, id: string, label: string): Promise<boolean> => {
      const noun = t(ENTITY_TITLE[entity]);
      const agreed = await runtime.confirm({
        kind: 'warning',
        destructive: true,
        title: tr(`حذف ${noun}؟`, `Supprimer ${noun} ?`, `Delete ${noun}?`),
        body: tr(
          `يُحذف «${label}» نهائيًا. لا يوجد تراجع، وما يعتمد عليه قد يُحذف معه.`,
          `« ${label} » est supprimé définitivement. Il n'y a pas d'annulation, et ce qui en dépend peut partir avec.`,
          `“${label}” is removed permanently. There is no undo, and whatever depends on it may go with it.`,
        ),
        confirmLabel: { ar: 'احذف', fr: 'Supprimer', en: 'Delete' },
      });
      if (!agreed) return false;
      setBusy('delete');
      const ok = await ledger.run(
        { command: deleteCommandFor(entity), payload: { id } },
        {
          success: tr(`تم حذف ${noun}.`, `Supprimé : ${noun}`, `${noun} deleted.`),
          failure: tr(`تعذّر حذف ${noun}.`, `Suppression impossible : ${noun}`, `Could not delete ${noun}.`),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, runtime, setBusy, t, tr],
  );

  return { save, remove };
}

export interface LifecycleCommands {
  /** Lead → customer, and an opportunity behind it if the draft named one. */
  convert: (draft: ConvertDraft) => Promise<boolean>;
  retag: (customerId: string, text: string) => Promise<boolean>;
  moveStage: (draft: StageDraft) => Promise<boolean>;
  send: (quoteId: string, validDays: string) => Promise<boolean>;
  /** Accept, which the kernel gates: `crm.quote.accept` carries `ledger.post`. */
  accept: (draft: AcceptDraft, label: string) => Promise<boolean>;
  decline: (quoteId: string, reason: string) => Promise<boolean>;
  complete: (followupId: string, note: string) => Promise<boolean>;
}

/**
 * The seven acts that move a record from one state to the next. Each names itself in
 * `busy` with its `LIFECYCLE_COMMANDS` key, so a stage move spins the stage button and
 * leaves the rest of the toolbar alone.
 */
export function useLifecycleCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: CrmBusy) => void,
): LifecycleCommands {
  const runtime = useApp();
  const { tr } = runtime.locale;

  const convert = useCallback(
    async (draft: ConvertDraft): Promise<boolean> => {
      setBusy('convert');
      const ok = await ledger.run(
        { command: LIFECYCLE_COMMANDS.convert, payload: convertPayload(draft) },
        {
          success: tr('تم تحويل العميل المحتمل.', 'Prospect converti.', 'Lead converted.'),
          failure: tr('تعذّر التحويل.', 'Conversion impossible.', 'Could not convert the lead.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  const retag = useCallback(
    async (customerId: string, text: string): Promise<boolean> => {
      setBusy('tags');
      const ok = await ledger.run(
        { command: LIFECYCLE_COMMANDS.tags, payload: tagsPayload(customerId, text) },
        {
          success: tr('تم تحديث الوسوم.', 'Étiquettes mises à jour.', 'Tags updated.'),
          failure: tr('تعذّر تحديث الوسوم.', 'Mise à jour impossible.', 'Could not update the tags.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  const moveStage = useCallback(
    async (draft: StageDraft): Promise<boolean> => {
      setBusy('stage');
      const ok = await ledger.run(
        { command: LIFECYCLE_COMMANDS.stage, payload: stagePayload(draft) },
        {
          success: tr('تم تحديث المرحلة.', 'Étape mise à jour.', 'Stage updated.'),
          failure: tr('تعذّر تحديث المرحلة.', 'Changement impossible.', 'Could not move the stage.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  const send = useCallback(
    async (quoteId: string, validDays: string): Promise<boolean> => {
      setBusy('send');
      const ok = await ledger.run(
        { command: LIFECYCLE_COMMANDS.send, payload: sendPayload(quoteId, validDays) },
        {
          success: tr('تم إرسال العرض.', 'Devis envoyé.', 'Quote sent.'),
          failure: tr('تعذّر إرسال العرض.', 'Envoi impossible.', 'Could not send the quote.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  const accept = useCallback(
    async (draft: AcceptDraft, label: string): Promise<boolean> => {
      setBusy('accept');
      const ok = await ledger.run(
        { command: LIFECYCLE_COMMANDS.accept, payload: acceptPayload(draft) },
        {
          success: tr(
            'تم قبول العرض وتأكيد الحجز.',
            'Devis accepté, réservation confirmée.',
            'Quote accepted, booking confirmed.',
          ),
          failure: tr('تعذّر قبول العرض.', 'Acceptation impossible.', 'Could not accept the quote.'),
        },
      );
      // Announced, not toasted: money moved, and this window may be behind another.
      if (ok) {
        await runtime.notify({
          kind: 'success',
          title: tr('حجز مؤكد', 'Réservation confirmée', 'Booking confirmed'),
          body: label,
        });
      }
      setBusy(null);
      return ok;
    },
    [ledger, runtime, setBusy, tr],
  );

  const decline = useCallback(
    async (quoteId: string, reason: string): Promise<boolean> => {
      setBusy('decline');
      const ok = await ledger.run(
        { command: LIFECYCLE_COMMANDS.decline, payload: declinePayload(quoteId, reason) },
        {
          success: tr('تم رفض العرض.', 'Devis refusé.', 'Quote declined.'),
          failure: tr('تعذّر رفض العرض.', 'Refus impossible.', 'Could not decline the quote.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  const complete = useCallback(
    async (followupId: string, note: string): Promise<boolean> => {
      setBusy('complete');
      const ok = await ledger.run(
        { command: LIFECYCLE_COMMANDS.complete, payload: completePayload(followupId, note) },
        {
          success: tr('تمت المتابعة.', 'Relance terminée.', 'Follow-up completed.'),
          failure: tr('تعذّر إنهاء المتابعة.', 'Clôture impossible.', 'Could not complete the follow-up.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, tr],
  );

  return { convert, retag, moveStage, send, accept, decline, complete };
}

export interface TransferActions {
  /** Write the grid the user is looking at to a CSV the user names. */
  exportCsv: (view: CrmView, content: string, today: string) => void;
  copy: (text: string) => void;
  /** The app's only cross-app verb. It carries nothing: no neighbour reads a CRM id. */
  openApp: (app: AppId) => void;
}

/** The three acts that leave the app: a file, the clipboard, another window. */
export function useTransferActions(setBusy: (busy: CrmBusy) => void): TransferActions {
  const runtime = useApp();
  const { tr } = runtime.locale;

  const exportCsv = useCallback(
    (view: CrmView, content: string, today: string): void => {
      const run = async (): Promise<void> => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير CSV', 'Exporter en CSV', 'Export as CSV'),
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
        const written = await runtime.invoke('fs.writeText', {
          path,
          content,
          contentType: 'text/csv',
        });
        runtime.toast(
          written.ok
            ? { kind: 'success', title: tr('تم التصدير', 'Exporté', 'Exported'), body: path }
            : {
                kind: 'error',
                title: tr('تعذّر التصدير', 'Export impossible', 'Export failed'),
                body: written.error.message,
              },
        );
        setBusy(null);
      };
      void run();
    },
    [runtime, setBusy, tr],
  );

  const copy = useCallback(
    (text: string): void => {
      // Nothing to copy is not a failure: the id was simply off the page.
      if (text === '') return;
      void runtime
        .invoke('shell.clipboardWrite', { text })
        .then((result) =>
          runtime.toast(
            result.ok
              ? { kind: 'success', title: tr('تم النسخ', 'Copié', 'Copied') }
              : { kind: 'error', title: tr('تعذّر النسخ', 'Copie impossible', 'Copy failed') },
          ),
        );
    },
    [runtime, tr],
  );

  const openApp = useCallback((app: AppId) => void runtime.launch(app), [runtime]);

  return { exportCsv, copy, openApp };
}

/** Everything the toolbar, the grids and the dialogs are allowed to do. */
export interface CrmActions extends RecordCommands, LifecycleCommands, TransferActions {
  readonly busy: CrmBusy;
}

/**
 * One `useLedgerCommand` for all thirty commands, threaded into the three seams rather
 * than called in each of them: two answers to "is a write in flight" would let a
 * toolbar spin one button while a second write was already running behind it.
 */
export function useCrmActions(): CrmActions {
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<CrmBusy>(null);
  const records = useRecordCommands(ledger, setBusy);
  const lifecycle = useLifecycleCommands(ledger, setBusy);
  const transfer = useTransferActions(setBusy);
  return { busy, ...records, ...lifecycle, ...transfer };
}
