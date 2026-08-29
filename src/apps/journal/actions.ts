/**
 * Journal — the acts.
 *
 * Everything in this app that changes something, or that touches a file or the
 * clipboard, is here: one hook returning one closure per act, so the components
 * stay declarative and every syscall in the app is visible from one screen.
 *
 * There is deliberately **no "are you sure?"** in front of posting or voiding.
 * `ledger.post` is in the kernel's `PRIVILEGED_CAPABILITIES`, so the kernel
 * raises its own consent prompt before the RPC runs. A second dialog in front of
 * the kernel's own would not make the decision safer — it would teach people to
 * click through both, which makes every later prompt weaker.
 *
 * The void dialog that does exist is not a confirmation. `void_journal_entry`
 * takes `p_reason` as a required argument: the reversal is written into the audit
 * trail with a stated cause or it is not written at all, and the dialog is where
 * that sentence is typed.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CHANNEL_ACTIVATED, useApp, useIpc, useLedgerCommand } from '@/platform/sdk';
import type { JournalEntry, JournalLine } from '../shared/ledger';
import { DOCUMENTS } from '../shared/paths';
import { type Draft, draftPayload, parseDraftFile, serialiseDraft, suggestedFileName } from './draft';
import { entriesCsv, entryClipboardText } from './entries';

/** The content type the manifest claims for `.fxjournal`. */
const DRAFT_TYPE = 'application/vnd.financeos.journal';

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
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'n') return 'new';
  if (key === 'o') return 'open';
  if (key === 'f') return 'find';
  if (key === 'e') return 'export';
  return null;
}

/** Which act is in flight, so one button spins rather than all of them. */
export type JournalBusy = 'post' | 'void' | 'create' | 'export' | 'save' | 'open' | null;

export interface JournalActions {
  readonly busy: JournalBusy;
  /** Draft → posted. The kernel prompts; this does not. */
  post: (entry: JournalEntry) => void;
  /** Posted → void, with the reason the RPC requires. */
  voidEntry: (entry: JournalEntry, reason: string) => void;
  /** Resolves true when the entry landed, so the dialog knows to close. */
  create: (draft: Draft) => Promise<boolean>;
  copy: (
    entry: JournalEntry,
    lines: readonly JournalLine[],
    labelOf: (accountId: string | null) => string,
  ) => void;
  exportCsv: (entries: readonly JournalEntry[], today: string) => void;
  /** Resolves to the path written, or null when cancelled or refused. */
  saveDraft: (draft: Draft) => Promise<string | null>;
  openDraft: (today: string) => Promise<Draft | null>;
}

export function useJournalActions(): JournalActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<JournalBusy>(null);

  const post = useCallback(
    (entry: JournalEntry) => {
      const run = async () => {
        setBusy('post');
        const ok = await ledger.run(
          { command: 'journal.post', payload: { journalId: entry.id } },
          {
            success: tr('تم ترحيل القيد.', 'Écriture comptabilisée.', 'Entry posted.'),
            failure: tr('تعذّر الترحيل.', 'Comptabilisation impossible.', 'Could not post.'),
          },
        );
        setBusy(null);
        // A posting is the one act here another person may need to hear about, and
        // a toast that has faded is not a record. This one goes to the centre.
        if (ok) {
          await runtime.notify({
            kind: 'success',
            title: tr('قيد مُرحّل', 'Écriture comptabilisée', 'Entry posted'),
            body: `${entry.reference} · ${entry.date}`,
          });
        }
      };
      void run();
    },
    [ledger, runtime, tr],
  );

  const voidEntry = useCallback(
    (entry: JournalEntry, reason: string) => {
      const run = async () => {
        setBusy('void');
        await ledger.run(
          { command: 'journal.void', payload: { journalId: entry.id, reason: reason.trim() } },
          {
            success: tr('تم إلغاء القيد.', 'Écriture annulée.', 'Entry voided.'),
            failure: tr('تعذّر الإلغاء.', 'Annulation impossible.', 'Could not void.'),
          },
        );
        setBusy(null);
      };
      void run();
    },
    [ledger, tr],
  );

  const create = useCallback(
    async (draft: Draft): Promise<boolean> => {
      setBusy('create');
      const ok = await ledger.run(
        { command: 'journal.create', payload: draftPayload(draft) },
        {
          // The RPC inserts with status DRAFT; saying "posted" here would be a lie
          // that the entry list would then contradict.
          success: tr('تم إنشاء المسودة.', 'Brouillon créé.', 'Draft entry created.'),
          failure: tr('تعذّر إنشاء القيد.', 'Création impossible.', 'Could not create the entry.'),
        },
      );
      setBusy(null);
      return ok;
    },
    [ledger, tr],
  );

  const copy = useCallback(
    (entry: JournalEntry, lines: readonly JournalLine[], labelOf: (accountId: string | null) => string) => {
      const text = entryClipboardText(entry, lines, labelOf);
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
    (entries: readonly JournalEntry[], today: string) => {
      const run = async () => {
        setBusy('export');
        const suggested = `journal-${today}.csv`;
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير القيود', 'Exporter les écritures', 'Export entries'),
          startPath: DOCUMENTS,
          suggestedName: suggested,
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
          content: entriesCsv(entries),
          contentType: 'text/csv',
        });
        setBusy(null);
        await runtime.toast(
          written.ok
            ? {
                kind: 'success',
                title: tr('تم التصدير.', 'Export terminé.', 'Exported.'),
                body: path,
              }
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

  const saveDraft = useCallback(
    async (draft: Draft): Promise<string | null> => {
      setBusy('save');
      // An already-saved draft still asks: Save is the only way to reach the
      // dialog, so silently overwriting would leave no way to save a copy.
      const chosen = await runtime.invoke('shell.fileDialog', {
        mode: 'save',
        title: tr('حفظ المسودة', 'Enregistrer le brouillon', 'Save draft'),
        startPath: draft.path === null ? DOCUMENTS : draft.path,
        suggestedName: suggestedFileName(draft),
        contentTypes: [DRAFT_TYPE],
      });
      const path = chosen.ok ? chosen.value.path : null;
      if (path === null) {
        setBusy(null);
        return null;
      }
      const written = await runtime.invoke('fs.writeText', {
        path,
        content: serialiseDraft(draft),
        contentType: DRAFT_TYPE,
      });
      setBusy(null);
      await runtime.toast(
        written.ok
          ? { kind: 'success', title: tr('تم الحفظ.', 'Enregistré.', 'Saved.'), body: path }
          : {
              kind: 'error',
              title: tr('تعذّر الحفظ.', 'Enregistrement impossible.', 'Could not save.'),
              body: written.error.message,
            },
      );
      return written.ok ? path : null;
    },
    [runtime, tr],
  );

  const openDraft = useCallback(
    async (today: string): Promise<Draft | null> => {
      setBusy('open');
      const chosen = await runtime.invoke('shell.fileDialog', {
        mode: 'open',
        title: tr('فتح مسودة', 'Ouvrir un brouillon', 'Open draft'),
        startPath: DOCUMENTS,
        contentTypes: [DRAFT_TYPE],
      });
      const path = chosen.ok ? chosen.value.path : null;
      if (path === null) {
        setBusy(null);
        return null;
      }
      const draft = await readDraft(runtime, path, today);
      setBusy(null);
      return draft;
    },
    [runtime, tr],
  );

  return { busy, post, voidEntry, create, copy, exportCsv, saveDraft, openDraft };
}

/**
 * Reads one path as a draft, complaining once if it is not one.
 *
 * Shared by the Open dialog and the file association, because a `.fxjournal`
 * that a double-click hands over is read exactly the way one the user picked is.
 */
async function readDraft(
  runtime: ReturnType<typeof useApp>,
  path: string,
  today: string,
): Promise<Draft | null> {
  const { tr } = runtime.locale;
  const read = await runtime.invoke('fs.readText', { path });
  if (!read.ok) {
    await runtime.toast({
      kind: 'error',
      title: tr('تعذّر فتح الملف.', 'Ouverture impossible.', 'Could not open the file.'),
      body: read.error.message,
    });
    return null;
  }
  const draft = parseDraftFile(read.value.content, today);
  if (draft === null) {
    await runtime.toast({
      kind: 'warning',
      title: tr('هذا ليس مسودة قيد.', 'Ce fichier n’est pas un brouillon.', 'That is not a journal draft.'),
      body: path,
    });
    return null;
  }
  return { ...draft, path };
}

/**
 * The file association, both ways in.
 *
 * A cold launch carries the path in `runtime.args`; a second launch of an
 * already-running Journal arrives on `CHANNEL_ACTIVATED` instead, because the
 * kernel re-activates the process rather than spawning a second one. Both end in
 * the same compose dialog.
 */
export function useDraftAssociation(today: string, onDraft: (draft: Draft) => void): void {
  const runtime = useApp();
  // The callback is held in a ref so a new closure per render cannot re-open a file.
  const sink = useRef(onDraft);
  sink.current = onDraft;

  const open = useCallback(
    (path: string) => {
      void readDraft(runtime, path, today).then((draft) => {
        if (draft !== null) sink.current(draft);
      });
    },
    [runtime, today],
  );

  const launched = useRef(false);
  useEffect(() => {
    const path = runtime.args.path;
    if (launched.current || path === undefined || path === '') return;
    launched.current = true;
    open(path);
  }, [runtime, open]);

  useIpc(CHANNEL_ACTIVATED, (message) => {
    const payload = message.payload as { readonly args?: Readonly<Record<string, string>> } | null;
    const path = payload?.args?.path;
    if (path !== undefined && path !== '') open(path);
  });
}
