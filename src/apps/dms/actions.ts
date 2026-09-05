/**
 * Documents — the acts.
 *
 * Twenty-six commands and two syscalls go through one `useLedgerCommand`, because a
 * single answer to "is a write in flight" is the only one a toolbar can trust. `busy`
 * names which act it is, so the control that raised it is the only one that spins.
 *
 * Every command here is spelled once, through {@link useAct}, and that is a departure
 * from Customers worth defending. Customers writes each of its thirty commands out in
 * full — `setBusy`, `ledger.run`, two sentences, `setBusy(null)` — and at thirty that
 * is still readable. At twenty-six it stops being readable and starts being a place
 * for a copy-paste to hide: the eleventh block that forgot its `setBusy(null)` looks
 * exactly like the ten above it. So the six lines every command shares live in one
 * `useCallback`, and what stays at each call site is the only part that differs — the
 * command's name, its payload, and what to say when it works and when it does not.
 *
 * The payload keys are camelCase because that is the wire the broker reads; it does
 * the translation to `p_document_id` and friends. Which key a command wants is not
 * guessable and is not consistent, because the migration is not consistent: the review
 * transitions take `documentId`, the metadata and tag edits take a bare `id`, the
 * package verbs split the same way, and `link`/`unlink` identify the *edge* rather than
 * either end. Each is spelled from `broker.ts`'s own binding rather than inferred, and
 * a wrong key is a `PGRST202` in front of a user, not a type error here.
 *
 * Three acts ask for consent the kernel will not raise. `dms.write` is not privileged,
 * so nothing stands in front of the two deletes or the void — and a document delete
 * takes its versions, its links and its history with it, while voiding a package
 * unsays an attestation. The review transitions ask nothing on purpose: every one of
 * them is reversible by another transition, and a dialog in front of an approve would
 * teach people to click through the dialogs that matter.
 *
 * Two acts are not commands at all. Filing bytes is `docs.upload`, a syscall, because
 * the kernel holds the three-step storage protocol — hash, reserve, PUT, discard on
 * failure — and an app that could run those steps separately could leave the store in
 * a state the store cannot describe. Reading bytes back is `docs.signedUrl`, which
 * records its own `SIGNED_URL_ISSUED` through the broker before the link exists, which
 * is why nothing here logs an access around it: the ledger entry is written at issue
 * time so that a URL pasted elsewhere and opened tomorrow still has one behind it.
 *
 * `dms.document.recordAccess` is the one command that never sets `busy`. It fires when
 * a detail pane opens, and a spinner appearing because somebody looked at something
 * would be a lie about who is waiting for what.
 */
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  type AppId,
  type DataCommandName,
  type Localized,
  CHANNEL_ACTIVATED,
  useApp,
  useIpc,
  useLedgerCommand,
} from '@/platform/sdk';
import { REPORTS } from '../shared/paths';
import { toVerification } from './model';
import type {
  DmsAccessAction,
  DmsConfidentiality,
  DmsDocumentRelation,
  DmsExtractionStatus,
  DmsLinkEntityType,
  DmsLinkRelation,
  DmsVerification,
  DmsView,
} from './types';

/** Argument order is Arabic, French, English — the same order as `text()` in a manifest. */
const w = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/**
 * The four accelerators the manifest declares, and nothing else.
 *
 * The returned strings are the manifest's own command ids rather than a second
 * vocabulary, so the palette and the keyboard reach the same handler and cannot drift
 * apart. `sweep` and `package:new` are deliberately absent: the manifest gives them no
 * accelerator, and inventing one here would be a shortcut nothing documents.
 *
 * `Ctrl+U` and not `Ctrl+N`, because a new document here always begins as bytes
 * arriving and there is nothing to create without them.
 */
export function hotkey(event: KeyboardEvent<HTMLElement>, view: DmsView): string | null {
  if (event.key === 'F5') return 'refresh';
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'u') return 'upload';
  if (key === 'f') return 'search';
  // Only the four grids have a page worth writing out. On the dashboard the export
  // would be a screenshot of some tiles, so the key does nothing rather than
  // producing a file whose contents nobody asked for.
  if (key === 'e') return view === 'dashboard' ? null : 'export';
  return null;
}

/* ------------------------------------------------------------------ *
 * What is in flight
 * ------------------------------------------------------------------ */

/**
 * Which act is in flight, named finely enough that one spinner means one control.
 *
 * The seven review keys are separate rather than a single `'review'` because they sit
 * side by side on the same pane, and a shared key would spin Reject while Approve was
 * the button that was pressed. `recordAccess` has no key at all — see the header.
 */
export type DmsBusy =
  | 'upload'
  | 'link'
  | 'unlink'
  | 'relate'
  | 'unrelate'
  | 'submit'
  | 'startReview'
  | 'approve'
  | 'reject'
  | 'requestChanges'
  | 'reopen'
  | 'archive'
  | 'metadata'
  | 'tags'
  | 'delete'
  | 'sweep'
  | 'queue'
  | 'record'
  | 'field'
  | 'package'
  | 'member'
  | 'seal'
  | 'verify'
  | 'void'
  | 'purge'
  | 'link:copy'
  | 'export'
  | null;

/* ------------------------------------------------------------------ *
 * Where an inbound launch lands
 * ------------------------------------------------------------------ */

/**
 * Which tab an inbound launch argument opens on.
 *
 * `documentId` is the one every neighbour will actually send: an invoice screen with a
 * scanned bill attached wants to hand this app a document, not a tab. The other three
 * exist because the review queue, the expiry report and a package are all things a
 * notification legitimately points at.
 */
const ARG_VIEW: Readonly<Record<string, DmsView>> = {
  documentId: 'library',
  reviewId: 'review',
  expiryId: 'expiry',
  packageId: 'packages',
};

export interface DmsTarget {
  readonly view: DmsView;
  readonly id: string;
}

/** The first recognised id in a launch. */
const targetFrom = (args: Readonly<Record<string, string>> | undefined): DmsTarget | null => {
  if (args === undefined) return null;
  for (const [key, view] of Object.entries(ARG_VIEW)) {
    const id = args[key];
    if (id !== undefined && id !== '') return { view, id };
  }
  return null;
};

/**
 * Read the launch argument once, and every later activation as it arrives.
 *
 * Once, because a re-render is not a second request to jump somewhere: without the
 * `launched` latch, a user who navigated away from the document another app sent them
 * to would be dragged back to it on the next state change. The IPC half has no latch
 * on purpose — an activation *is* a fresh request, and the same neighbour sending the
 * same document twice means they want it twice.
 *
 * `sink` holds the newest callback so the effect does not re-run when the handler's
 * identity changes, which for a handler closing over view state is every render.
 */
export function useDmsFocus(onTarget: (target: DmsTarget) => void): void {
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

/* ------------------------------------------------------------------ *
 * One command, spelled once
 * ------------------------------------------------------------------ */

/** What to say when a command works, and when it does not. Both are required: a
 *  silent failure is the one outcome a clerk cannot act on. */
interface Said {
  readonly ok: Localized;
  readonly bad: Localized;
}

/**
 * Run one command: raise its spinner, send it, say how it went, lower the spinner.
 *
 * The return is the broker's own verdict, so a dialog can close on success and stay
 * open — with its fields intact — on failure. `setBusy(null)` is in the same statement
 * sequence as `setBusy(busy)` rather than in a `finally`, because `ledger.run` does
 * not throw: it catches at the syscall boundary and returns false.
 */
type Act = (
  busy: DmsBusy,
  command: DataCommandName,
  payload: Readonly<Record<string, unknown>>,
  said: Said,
) => Promise<boolean>;

function useAct(ledger: ReturnType<typeof useLedgerCommand>, setBusy: (busy: DmsBusy) => void): Act {
  const { t } = useApp().locale;
  return useCallback(
    async (busy, command, payload, said) => {
      setBusy(busy);
      const ok = await ledger.run({ command, payload }, { success: t(said.ok), failure: t(said.bad) });
      setBusy(null);
      return ok;
    },
    [ledger, setBusy, t],
  );
}

/**
 * Drop the keys a caller left undefined.
 *
 * The broker reads a payload key as "the caller said this" and forwards it to
 * PostgREST, so `{ p_note: undefined }` is not the same as omitting `p_note` — it is a
 * request to set the column to null. Every optional field in this file goes through
 * here so that "unchanged" and "cleared" stay different things, and `clearExpiry`
 * exists precisely because they are.
 */
const only = (payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/* ------------------------------------------------------------------ *
 * Bytes: in, and back out again
 * ------------------------------------------------------------------ */

/**
 * What a person filled in around the file they picked.
 *
 * `file` is a DOM `File` and that is legal here: Wall 3 bans ambient *capabilities* —
 * `fetch`, `localStorage`, `Math.random` — not DOM types, and `abi.ts` refuses `File`
 * for its own reason (a contract that names a browser interface cannot be honoured by
 * a non-browser host). The app sits on the browser side of that line, so it holds the
 * `File`, reads it once, and hands the kernel the bytes.
 *
 * `documentId` present means "this is a new version of that document", which the
 * server resets to DRAFT — what was approved is not this. Absent means a new document.
 */
export interface UploadDraft {
  readonly file: File;
  readonly title: string;
  readonly documentType: string;
  readonly documentId?: string;
  readonly description?: string;
  readonly confidentiality?: DmsConfidentiality;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly expiryNoticeDays?: number;
  readonly tags?: readonly string[];
  readonly queueExtraction?: boolean;
}

export interface ByteActions {
  /** The new document's id, or null if nothing was filed. */
  readonly upload: (draft: UploadDraft) => Promise<string | null>;
  /** A short-lived link to one version's bytes, for a pane to render. */
  readonly previewUrl: (documentId: string, storagePath: string) => Promise<string | null>;
  readonly copyLink: (documentId: string, storagePath: string) => Promise<void>;
  readonly noteAccess: (documentId: string, action: DmsAccessAction) => Promise<void>;
}

/**
 * Bytes in, bytes out, and the note that somebody looked.
 *
 * Three of the four talk to the kernel directly rather than through {@link useAct},
 * because `docs.upload` and `docs.signedUrl` are syscalls and not ledger commands —
 * they return a value the caller needs, and `ledger.run` returns only whether it
 * worked. The toast is therefore spelled out here rather than inherited.
 *
 * Neither URL verb records an access. `documents.ts` writes `SIGNED_URL_ISSUED`
 * through the broker *before* it mints the link, so an app-side entry would count
 * every open twice and make the access ledger useless for the one question it is
 * asked: how many times has this been read.
 */
function useByteActions(setBusy: (busy: DmsBusy) => void): ByteActions {
  const runtime = useApp();
  const { t, tr } = runtime.locale;

  const upload = useCallback(
    async (draft: UploadDraft): Promise<string | null> => {
      setBusy('upload');
      // One read of the file, so the checksum the server computes is provably over
      // the bytes that were sent rather than over a second read of the same handle.
      const buffer = await draft.file.arrayBuffer();
      const result = await runtime.invoke('docs.upload', {
        file: { buffer, fileName: draft.file.name, contentType: draft.file.type },
        title: draft.title,
        documentType: draft.documentType,
        ...only({
          documentId: draft.documentId,
          description: draft.description,
          confidentiality: draft.confidentiality,
          issuedOn: draft.issuedOn,
          expiresOn: draft.expiresOn,
          expiryNoticeDays: draft.expiryNoticeDays,
          tags: draft.tags,
          queueExtraction: draft.queueExtraction,
        }),
      });
      setBusy(null);
      if (!result.ok) {
        await runtime.toast({
          kind: 'error',
          title: t(w('تعذّر رفع الملف', 'Téléversement impossible', 'Could not file the document')),
          body: result.error.message,
        });
        return null;
      }
      // The version number is in the toast because filing v3 of a contract and
      // filing a new contract look identical once the dialog closes.
      await runtime.toast({
        kind: 'success',
        title: t(w('تم الرفع', 'Document téléversé', 'Document filed')),
        body: tr(
          `الإصدار ${result.value.versionNumber}`,
          `Version ${result.value.versionNumber}`,
          `Version ${result.value.versionNumber}`,
        ),
      });
      return result.value.documentId;
    },
    [runtime, setBusy, t, tr],
  );

  /**
   * No busy key on purpose: this resolves while a detail pane is opening, and the
   * pane owns its own skeleton. A toolbar spinner for a preview would report the
   * wrong thing as blocked.
   */
  const previewUrl = useCallback(
    async (documentId: string, storagePath: string): Promise<string | null> => {
      const result = await runtime.invoke('docs.signedUrl', { documentId, storagePath });
      if (result.ok) return result.value.url;
      await runtime.toast({
        kind: result.error.code === 'PERMISSION_DENIED' ? 'warning' : 'error',
        title: t(w('تعذّر فتح الملف', 'Ouverture impossible', 'Could not open the document')),
        body: result.error.message,
      });
      return null;
    },
    [runtime, t],
  );

  /**
   * The link, on the clipboard, with its lifetime said out loud.
   *
   * There is no "open in a new tab" here and that is not an omission: the shell
   * exposes eight syscalls and none of them navigates. So a document is either
   * rendered in-pane from {@link previewUrl} or handed over as text — and text that
   * expires in a minute needs to say so, or it gets pasted into an email.
   */
  const copyLink = useCallback(
    async (documentId: string, storagePath: string): Promise<void> => {
      setBusy('link:copy');
      const result = await runtime.invoke('docs.signedUrl', { documentId, storagePath });
      if (!result.ok) {
        setBusy(null);
        await runtime.toast({
          kind: 'error',
          title: t(w('تعذّر إنشاء الرابط', 'Lien impossible', 'Could not mint a link')),
          body: result.error.message,
        });
        return;
      }
      const written = await runtime.invoke('shell.clipboardWrite', { text: result.value.url });
      setBusy(null);
      if (!written.ok) return;
      await runtime.toast({
        kind: 'success',
        title: t(w('نُسخ الرابط', 'Lien copié', 'Link copied')),
        body: t(w('ينتهي بعد دقيقة.', 'Expire dans une minute.', 'It expires in a minute.')),
      });
    },
    [runtime, setBusy, t],
  );

  /**
   * That somebody looked. Silent in both directions: no spinner, and no toast on
   * failure either, because a clerk opening a passport scan cannot act on "the
   * access log write failed" and should not be interrupted by it.
   */
  const noteAccess = useCallback(
    async (documentId: string, action: DmsAccessAction): Promise<void> => {
      await runtime.invoke('data.command', {
        command: 'dms.document.recordAccess',
        payload: { documentId, action },
      });
    },
    [runtime],
  );

  return { upload, previewUrl, copyLink, noteAccess };
}

/* ------------------------------------------------------------------ *
 * The review machine
 * ------------------------------------------------------------------ */

export interface ReviewActions {
  readonly submit: (documentId: string, note?: string) => Promise<boolean>;
  readonly startReview: (documentId: string) => Promise<boolean>;
  readonly approve: (documentId: string, note?: string) => Promise<boolean>;
  readonly reject: (documentId: string, reason: string) => Promise<boolean>;
  readonly requestChanges: (documentId: string, note: string) => Promise<boolean>;
  readonly reopen: (documentId: string, note?: string) => Promise<boolean>;
  readonly setArchived: (documentId: string, archived: boolean, reason?: string) => Promise<boolean>;
}

/**
 * Seven transitions, none of which asks permission.
 *
 * That is deliberate and it is the opposite of what Customers does for its lifecycle
 * verbs. Every state here is reachable again from the state it leads to — an approval
 * can be reopened, a rejection can be reopened, an archive can be un-archived by the
 * same command with `archived: false`. Nothing is lost, so a dialog in front of each
 * one would be a dialog people learn to dismiss without reading, and the two that
 * genuinely need reading are in {@link useMetadataCommands} and
 * {@link usePackageCommands}.
 *
 * `note` is optional on four of them and required on two, and that asymmetry is the
 * server's: `p_note` on submit, approve and reopen records why, while a rejection
 * without a reason and a changes-request without an instruction send a document back
 * with nothing attached for the submitter to act on. The broker enforces it; the
 * dialogs make it obvious before the click.
 */
function useReviewCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: DmsBusy) => void,
): ReviewActions {
  const act = useAct(ledger, setBusy);

  const submit = useCallback(
    (documentId: string, note?: string) =>
      act('submit', 'dms.document.submit', only({ documentId, note }), {
        ok: w('أُرسل للمراجعة', 'Envoyé en revue', 'Sent for review'),
        bad: w('تعذّر الإرسال', 'Envoi impossible', 'Could not send for review'),
      }),
    [act],
  );

  const startReview = useCallback(
    (documentId: string) =>
      act('startReview', 'dms.document.startReview', { documentId }, {
        ok: w('بدأت المراجعة', 'Revue commencée', 'Review started'),
        bad: w('تعذّر بدء المراجعة', 'Impossible de commencer', 'Could not start the review'),
      }),
    [act],
  );

  const approve = useCallback(
    (documentId: string, note?: string) =>
      act('approve', 'dms.document.approve', only({ documentId, note }), {
        ok: w('تم الاعتماد', 'Approuvé', 'Approved'),
        bad: w('تعذّر الاعتماد', 'Approbation impossible', 'Could not approve'),
      }),
    [act],
  );

  const reject = useCallback(
    (documentId: string, reason: string) =>
      act('reject', 'dms.document.reject', { documentId, reason }, {
        ok: w('تم الرفض', 'Rejeté', 'Rejected'),
        bad: w('تعذّر الرفض', 'Rejet impossible', 'Could not reject'),
      }),
    [act],
  );

  const requestChanges = useCallback(
    (documentId: string, note: string) =>
      act('requestChanges', 'dms.document.requestChanges', { documentId, note }, {
        ok: w('طُلبت تعديلات', 'Modifications demandées', 'Changes requested'),
        bad: w('تعذّر طلب التعديلات', 'Demande impossible', 'Could not request changes'),
      }),
    [act],
  );

  const reopen = useCallback(
    (documentId: string, note?: string) =>
      act('reopen', 'dms.document.reopen', only({ documentId, note }), {
        ok: w('أُعيد فتحه', 'Rouvert', 'Reopened'),
        bad: w('تعذّر إعادة الفتح', 'Réouverture impossible', 'Could not reopen'),
      }),
    [act],
  );

  /**
   * One command for both directions, because the server's `p_archived` defaults true
   * and accepts false. Two verbs here would be two names for one row change, and the
   * grid's control is a toggle rather than a pair of buttons for the same reason.
   */
  const setArchived = useCallback(
    (documentId: string, archived: boolean, reason?: string) =>
      act('archive', 'dms.document.archive', only({ documentId, archived, reason }), {
        ok: archived
          ? w('تمت الأرشفة', 'Archivé', 'Archived')
          : w('أُلغيت الأرشفة', 'Désarchivé', 'Unarchived'),
        bad: w('تعذّر تغيير الأرشفة', 'Archivage impossible', 'Could not change the archive state'),
      }),
    [act],
  );

  return { submit, startReview, approve, reject, requestChanges, reopen, setArchived };
}

/* ------------------------------------------------------------------ *
 * What the document says it is
 * ------------------------------------------------------------------ */

/**
 * The eight editable fields, plus the flag that makes "no expiry" sayable.
 *
 * Every field is optional because this is a patch: an omitted key means "leave it
 * alone", which is why {@link only} runs over the payload before it is sent. That is
 * also why `clearExpiry` has to exist — `expiresOn: undefined` is silence, and there
 * would otherwise be no way to state that a document turned out not to expire at all.
 */
export interface MetadataDraft {
  readonly title?: string;
  readonly description?: string;
  readonly documentType?: string;
  readonly confidentiality?: DmsConfidentiality;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly expiryNoticeDays?: number;
  readonly clearExpiry?: boolean;
}

export interface MetadataActions {
  readonly saveMetadata: (id: string, draft: MetadataDraft) => Promise<boolean>;
  readonly setTags: (id: string, tags: readonly string[]) => Promise<boolean>;
  readonly remove: (id: string, title: string) => Promise<boolean>;
}

/**
 * Editing the description, retagging, and the one delete this app can perform.
 *
 * These three take a bare `id` where the review commands take `documentId`, and the
 * inconsistency is the migration's rather than this file's. PostgREST matches
 * arguments by name, so normalising the two spellings here would produce a `PGRST202`
 * in front of a user instead of a compile error in front of a developer.
 */
function useMetadataCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: DmsBusy) => void,
): MetadataActions {
  const runtime = useApp();
  const { tr } = runtime.locale;
  const act = useAct(ledger, setBusy);

  const saveMetadata = useCallback(
    (id: string, draft: MetadataDraft) =>
      act('metadata', 'dms.document.updateMetadata', only({ id, ...draft }), {
        ok: w('تم الحفظ', 'Enregistré', 'Saved'),
        bad: w('تعذّر الحفظ', 'Enregistrement impossible', 'Could not save'),
      }),
    [act],
  );

  /**
   * Tags are set as a whole list, never added to one at a time, so an empty array is
   * a real instruction: it clears every tag. That is why this does not go through
   * {@link only} — an absent `tags` would be a silent no-op where the user asked for
   * a removal.
   */
  const setTags = useCallback(
    (id: string, tags: readonly string[]) =>
      act('tags', 'dms.document.setTags', { id, tags }, {
        ok: w('تم تحديث الوسوم', 'Étiquettes mises à jour', 'Tags updated'),
        bad: w('تعذّر تحديث الوسوم', 'Mise à jour impossible', 'Could not update the tags'),
      }),
    [act],
  );

  /**
   * The consent the kernel will not raise.
   *
   * `dms.write` is not a privileged capability, so nothing stands between a click and
   * a document's versions, links, extractions and history going with it. The server
   * refuses this for APPROVED, SUPERSEDED and EXPIRED documents and for any member of
   * a sealed package, so what reaches here is a draft or a rejection — recoverable
   * only from whoever still has the file.
   */
  const remove = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const agreed = await runtime.confirm({
        kind: 'warning',
        destructive: true,
        title: tr('حذف المستند؟', 'Supprimer le document ?', 'Delete this document?'),
        body: tr(
          `يُحذف «${title}» بكل إصداراته وروابطه وسجلّه. لا يوجد تراجع.`,
          `« ${title} » part avec toutes ses versions, ses liens et son historique. Il n'y a pas d'annulation.`,
          `“${title}” goes with every version, every link and its whole history. There is no undo.`,
        ),
        confirmLabel: { ar: 'احذف', fr: 'Supprimer', en: 'Delete' },
      });
      if (!agreed) return false;
      return act('delete', 'dms.document.delete', { id }, {
        ok: w('تم الحذف', 'Document supprimé', 'Document deleted'),
        bad: w('تعذّر الحذف', 'Suppression impossible', 'Could not delete'),
      });
    },
    [act, runtime, tr],
  );

  return { saveMetadata, setTags, remove };
}

/* ------------------------------------------------------------------ *
 * What the document is filed against
 * ------------------------------------------------------------------ */

export interface FilingActions {
  readonly link: (
    documentId: string,
    entityType: DmsLinkEntityType,
    entityId: string,
    relation?: DmsLinkRelation,
    note?: string,
  ) => Promise<boolean>;
  readonly unlink: (linkId: string) => Promise<boolean>;
  readonly relate: (
    fromDocumentId: string,
    toDocumentId: string,
    relation: DmsDocumentRelation,
    note?: string,
  ) => Promise<boolean>;
  readonly unrelate: (relationId: string) => Promise<boolean>;
}

/**
 * The two graphs a document sits in, and the two ways out of each.
 *
 * A link points at a business row — one of seventeen entity types — and says why
 * ("evidence for this payment"). A relation points at another document ("this replaces
 * that"). Both are edges, and both are removed by the id of the *edge*, never by the
 * id of either end: `unlink` takes a `linkId` and `unrelate` a `relationId`, because a
 * document filed twice against the same booking under two relations has two rows, and
 * deleting "the link to that booking" would be ambiguous.
 *
 * `relation` is optional on a link and required on a relation. A link with nothing
 * said defaults to `ABOUT`, which is honest — the filer knows the document belongs
 * there and has not claimed more. A document-to-document edge has no such neutral
 * reading: `SUPERSEDES` and `TRANSLATION_OF` are different facts, and the server acts
 * on the first of them by marking the target SUPERSEDED.
 */
function useFilingCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: DmsBusy) => void,
): FilingActions {
  const act = useAct(ledger, setBusy);

  const link = useCallback(
    (
      documentId: string,
      entityType: DmsLinkEntityType,
      entityId: string,
      relation?: DmsLinkRelation,
      note?: string,
    ) =>
      act(
        'link',
        'dms.document.link',
        only({ documentId, entityType, entityId, relation, note }),
        {
          ok: w('تم الربط', 'Lié', 'Linked'),
          bad: w('تعذّر الربط', 'Liaison impossible', 'Could not link'),
        },
      ),
    [act],
  );

  const unlink = useCallback(
    (linkId: string) =>
      act('unlink', 'dms.document.unlink', { linkId }, {
        ok: w('تم فكّ الربط', 'Lien retiré', 'Link removed'),
        bad: w('تعذّر فكّ الربط', 'Retrait impossible', 'Could not remove the link'),
      }),
    [act],
  );

  const relate = useCallback(
    (
      fromDocumentId: string,
      toDocumentId: string,
      relation: DmsDocumentRelation,
      note?: string,
    ) =>
      act(
        'relate',
        'dms.document.relate',
        only({ fromDocumentId, toDocumentId, relation, note }),
        {
          ok: w('تم الربط بين المستندين', 'Documents liés', 'Documents related'),
          bad: w('تعذّر ربط المستندين', 'Liaison impossible', 'Could not relate the documents'),
        },
      ),
    [act],
  );

  const unrelate = useCallback(
    (relationId: string) =>
      act('unrelate', 'dms.document.unrelate', { relationId }, {
        ok: w('تم فكّ الارتباط', 'Relation retirée', 'Relation removed'),
        bad: w('تعذّر فكّ الارتباط', 'Retrait impossible', 'Could not remove the relation'),
      }),
    [act],
  );

  return { link, unlink, relate, unrelate };
}

/* ------------------------------------------------------------------ *
 * Expiry and extraction
 * ------------------------------------------------------------------ */

/**
 * What the app may report a job as. Three of the four extraction states, not four.
 *
 * `pending` is missing on purpose: it is the state a job is *created* in by
 * `dms.extraction.queue`, and the server's CHECK on this command accepts only
 * `processing`, `completed` and `failed`. Written as an `Exclude` over the wire union
 * rather than as three fresh literals so that a fifth state added to the enum arrives
 * here automatically instead of being silently unreportable.
 */
export type ExtractionReport = Exclude<DmsExtractionStatus, 'pending'>;

/**
 * One value being reported back, in the JSONB shape the RPC reads.
 *
 * These keys are snake_case, alone in this app, because they are not a record the app
 * owns — they are read out of the payload with `f->>'key'` inside
 * `dms_record_extraction_result`, so the casing is the server's to choose. `key` is
 * the only required one, and a member whose `key` trims to empty is skipped by the
 * loop rather than rejected, which is why it is not optional here.
 *
 * `value` falls back to `raw_value` server-side, so a field that came out clean needs
 * only one of them. `bounding_box` is deliberately absent: it is a page geometry an
 * engine produces, and the only writer inside this app is a human typing into the
 * manual-entry form, who has none.
 */
export interface ExtractedFieldInput {
  readonly key: string;
  readonly label?: string;
  readonly raw_value?: string;
  readonly value?: string;
  readonly confidence?: number;
  readonly page_number?: number;
}

/**
 * The verb a reviewer performs on one field, which is not the state it lands in.
 *
 * `ACCEPT`/`CORRECT`/`REJECT` go over the wire; `ACCEPTED`/`CORRECTED`/`REJECTED` come
 * back out of the table. The server maps between them and rejects a state where a verb
 * belongs, so the two vocabularies are kept apart in the types as well: this union is
 * what a command takes, {@link DmsFieldReviewState} is what a row holds.
 */
export type FieldReviewAction = 'ACCEPT' | 'CORRECT' | 'REJECT';

export interface ExtractionActions {
  readonly sweepExpiry: () => Promise<boolean>;
  readonly queueExtraction: (documentId: string, engine?: string) => Promise<boolean>;
  readonly recordExtraction: (
    jobId: string,
    status: ExtractionReport,
    fields?: readonly ExtractedFieldInput[],
    confidence?: number,
    error?: string,
  ) => Promise<boolean>;
  readonly reviewField: (
    fieldId: string,
    action: FieldReviewAction,
    value?: string,
  ) => Promise<boolean>;
}

/**
 * The expiry sweep, and the three verbs around the extraction queue.
 *
 * The sweep is the one command in this app that takes no arguments and names no row:
 * it walks every document whose `expires_on` has passed and moves it to EXPIRED. That
 * makes it the only verb here whose effect is invisible when it works — nothing on the
 * screen the operator is looking at necessarily changes — so its success toast reports
 * that it ran rather than what it found.
 */
function useExtractionCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: DmsBusy) => void,
): ExtractionActions {
  const act = useAct(ledger, setBusy);

  const sweepExpiry = useCallback(
    () =>
      act('sweep', 'dms.expiry.sweep', {}, {
        ok: w('تم تحديث الصلاحيات', 'Échéances mises à jour', 'Expiry states refreshed'),
        bad: w('تعذّر التحديث', 'Mise à jour impossible', 'Could not refresh the expiry states'),
      }),
    [act],
  );

  const queueExtraction = useCallback(
    (documentId: string, engine?: string) =>
      act('queue', 'dms.extraction.queue', only({ documentId, engine }), {
        ok: w('أُضيف إلى قائمة الاستخراج', 'Mis en file', 'Queued for extraction'),
        bad: w('تعذّرت الإضافة', 'Mise en file impossible', 'Could not queue the extraction'),
      }),
    [act],
  );

  /**
   * `fields` is sent even when empty, because the server only writes fields on a
   * `completed` report and an omitted list there would leave the previous run's
   * reading in place — a completed extraction that found nothing is a real answer.
   * A `failed` report must carry `error`; the server refuses one that does not.
   */
  const recordExtraction = useCallback(
    (
      jobId: string,
      status: ExtractionReport,
      fields?: readonly ExtractedFieldInput[],
      confidence?: number,
      error?: string,
    ) =>
      act(
        'record',
        'dms.extraction.record',
        only({ jobId, status, fields: fields ?? [], confidence, error }),
        {
          ok: w('تم تسجيل النتيجة', 'Résultat enregistré', 'Result recorded'),
          bad: w('تعذّر تسجيل النتيجة', 'Enregistrement impossible', 'Could not record the result'),
        },
      ),
    [act],
  );

  const reviewField = useCallback(
    (fieldId: string, action: FieldReviewAction, value?: string) =>
      act('field', 'dms.extraction.reviewField', only({ fieldId, action, value }), {
        ok:
          action === 'CORRECT'
            ? w('تم التصحيح', 'Corrigé', 'Corrected')
            : action === 'REJECT'
              ? w('تم الرفض', 'Rejeté', 'Rejected')
              : w('تم القبول', 'Accepté', 'Accepted'),
        bad: w('تعذّرت المراجعة', 'Révision impossible', 'Could not review the field'),
      }),
    [act],
  );

  return { sweepExpiry, queueExtraction, recordExtraction, reviewField };
}

/* ------------------------------------------------------------------ *
 * Evidence packages
 * ------------------------------------------------------------------ */

/**
 * What a package says about itself. Every field is optional because `update` may
 * change one of them, and `create` takes its name as a separate required argument
 * rather than as an optional field somebody could forget to fill in.
 */
export interface PackageDraft {
  readonly name?: string;
  readonly purpose?: string;
  readonly reference?: string;
  readonly notes?: string;
}

export interface PackageActions {
  readonly createPackage: (name: string, draft?: PackageDraft) => Promise<boolean>;
  readonly updatePackage: (id: string, draft: PackageDraft) => Promise<boolean>;
  readonly setMember: (
    packageId: string,
    documentId: string,
    include: boolean,
    note?: string,
  ) => Promise<boolean>;
  readonly sealPackage: (packageId: string, name: string) => Promise<boolean>;
  readonly verifyPackage: (packageId: string) => Promise<DmsVerification | null>;
  readonly voidPackage: (id: string, reason: string) => Promise<boolean>;
  readonly deletePackage: (id: string, name: string) => Promise<boolean>;
}

/**
 * Seven verbs over the subsystem that exists to be able to say "these documents, at
 * that moment, and here is the proof they have not moved since."
 *
 * Three of the seven ask permission and the other four do not, on the same test the
 * review machine uses: whether the state they lead to is reachable again. Adding and
 * removing a member is not — `setDocument` with `include: false` is itself the undo,
 * and the row stays. Sealing is: a seal is the point of the thing, it cannot be
 * unsealed, and every later verification is compared against it. Voiding is, on the
 * server's terms rather than this app's — `OPEN → VOID` only, so a sealed package
 * cannot be unsaid, and a package with no seal is being abandoned rather than
 * destroyed. Deleting takes the members and the seal with it.
 *
 * The three id spellings are the migration's and are transcribed rather than
 * smoothed: `create` names none, `update`, `void` and `delete` take `id`, and `seal`,
 * `verify` and `setDocument` take `packageId`. PostgREST matches arguments by name,
 * so unifying them here would turn a compile error into a `PGRST202` in front of a
 * clerk.
 */
function usePackageCommands(
  ledger: ReturnType<typeof useLedgerCommand>,
  setBusy: (busy: DmsBusy) => void,
): PackageActions {
  const runtime = useApp();
  const { t, tr } = runtime.locale;
  const act = useAct(ledger, setBusy);

  const createPackage = useCallback(
    (name: string, draft?: PackageDraft) =>
      act('package', 'dms.package.create', only({ name, ...draft }), {
        ok: w('تم إنشاء الحزمة', 'Dossier créé', 'Package created'),
        bad: w('تعذّر إنشاء الحزمة', 'Création impossible', 'Could not create the package'),
      }),
    [act],
  );

  const updatePackage = useCallback(
    (id: string, draft: PackageDraft) =>
      act('package', 'dms.package.update', only({ id, ...draft }), {
        ok: w('تم الحفظ', 'Enregistré', 'Saved'),
        bad: w('تعذّر الحفظ', 'Enregistrement impossible', 'Could not save'),
      }),
    [act],
  );

  /**
   * One member in or out. The two success words are different sentences because a
   * clerk who has just clicked a row in a long list needs to know which way it went,
   * and "Saved" would not tell them.
   */
  const setMember = useCallback(
    (packageId: string, documentId: string, include: boolean, note?: string) =>
      act('member', 'dms.package.setDocument', only({ packageId, documentId, include, note }), {
        ok: include
          ? w('أُضيف إلى الحزمة', 'Ajouté au dossier', 'Added to the package')
          : w('أُزيل من الحزمة', 'Retiré du dossier', 'Removed from the package'),
        bad: w('تعذّر التعديل', 'Modification impossible', 'Could not change the package'),
      }),
    [act],
  );

  /**
   * Sealing, once, with the name in the question.
   *
   * The consent dialog says what a seal is for rather than warning about loss,
   * because nothing is lost: the members freeze, the digest is computed over them,
   * and from then on {@link verifyPackage} can answer whether they still match. What
   * a person needs told is that this is the last chance to add a document — which is
   * why the name is interpolated, so somebody with three packages open seals the one
   * they meant.
   */
  const sealPackage = useCallback(
    async (packageId: string, name: string): Promise<boolean> => {
      const agreed = await runtime.confirm({
        kind: 'question',
        title: tr('ختم الحزمة؟', 'Sceller le dossier ?', 'Seal this package?'),
        body: tr(
          `يُحسب بصمة «${name}» على أعضائها الحاليين ويُثبّتها. لا يمكن إضافة مستند بعد الختم، ولا فتح الختم.`,
          `L’empreinte de « ${name} » est calculée sur ses membres actuels et figée. Après le scellement, plus aucun document ne s’ajoute et le sceau ne s’ouvre pas.`,
          `“${name}” gets a checksum over the documents it holds right now, and they freeze. Nothing can be added after a seal, and a seal cannot be opened.`,
        ),
        confirmLabel: { ar: 'اختم', fr: 'Sceller', en: 'Seal' },
      });
      if (!agreed) return false;
      return act('seal', 'dms.package.seal', { packageId }, {
        ok: w('تم الختم', 'Dossier scellé', 'Package sealed'),
        bad: w('تعذّر الختم', 'Scellement impossible', 'Could not seal the package'),
      });
    },
    [act, runtime, tr],
  );

  /**
   * Recompute the digest over what the package holds now, and compare.
   *
   * The one verb in this file that goes around {@link useAct}, because it is the one
   * whose answer matters more than whether it worked: `ledger.run` returns a boolean,
   * and a boolean cannot carry the drift list. So the syscall is called directly and
   * the payload is handed to `model.ts`'s `toVerification` — the only mapper that file
   * exports, and it lives there rather than here so that `evidence_package_id` and the
   * rest of the server's spelling stay in the one file that admits to knowing it.
   *
   * Silent on success on purpose. A match and a mismatch are both results a pane
   * renders — with the drifted members listed — and a toast saying "verified" over a
   * dialog that already says so would be the same sentence twice. Failure is toasted,
   * because there is nothing to render.
   */
  const verifyPackage = useCallback(
    async (packageId: string): Promise<DmsVerification | null> => {
      setBusy('verify');
      const outcome = await runtime.invoke('data.command', {
        command: 'dms.package.verify',
        payload: { packageId },
      });
      setBusy(null);
      const title = t(w('تعذّر التحقّق', 'Vérification impossible', 'Could not verify'));
      if (!outcome.ok) {
        await runtime.toast({ kind: 'error', title, body: outcome.error.message });
        return null;
      }
      const row = outcome.value.result;
      const verification = row === null ? null : toVerification(row);
      if (verification === null) {
        await runtime.toast({
          kind: 'error',
          title,
          body: t(
            w(
              'لم يُرجع الخادم نتيجة يمكن قراءتها.',
              'Le serveur n’a rien renvoyé de lisible.',
              'The server returned nothing readable.',
            ),
          ),
        });
        return null;
      }
      return verification;
    },
    [runtime, setBusy, t],
  );

  /**
   * Abandoning a package that was never sealed.
   *
   * `reason` is required by the broker and the dialog is therefore a confirmation
   * rather than a prompt: the caller has already collected the reason in a field, and
   * asking for it twice would be the dialog people learn to click through. The body
   * says what void means — the row stays, greyed, with the reason on it — because the
   * word reads like a delete and is not one.
   */
  const voidPackage = useCallback(
    async (id: string, reason: string): Promise<boolean> => {
      const agreed = await runtime.confirm({
        kind: 'warning',
        title: tr('إلغاء الحزمة؟', 'Annuler le dossier ?', 'Void this package?'),
        body: tr(
          'تبقى الحزمة ظاهرة مع سببها، ولا يمكن ختمها بعد الإلغاء. الحزم المختومة لا تُلغى.',
          'Le dossier reste visible avec son motif et ne peut plus être scellé. Un dossier scellé ne s’annule pas.',
          'The package stays visible with its reason attached and can never be sealed. A sealed package cannot be voided at all.',
        ),
        confirmLabel: { ar: 'ألغِ', fr: 'Annuler le dossier', en: 'Void' },
      });
      if (!agreed) return false;
      return act('void', 'dms.package.void', { id, reason }, {
        ok: w('أُلغيت الحزمة', 'Dossier annulé', 'Package voided'),
        bad: w('تعذّر الإلغاء', 'Annulation impossible', 'Could not void the package'),
      });
    },
    [act, runtime, tr],
  );

  /** The documents themselves survive: a package is a list, and deleting the list
   *  deletes the list. The seal does not survive, which is what the dialog says. */
  const deletePackage = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const agreed = await runtime.confirm({
        kind: 'warning',
        destructive: true,
        title: tr('حذف الحزمة؟', 'Supprimer le dossier ?', 'Delete this package?'),
        body: tr(
          `يُحذف «${name}» بأعضائه وختمه. تبقى المستندات نفسها. لا يوجد تراجع.`,
          `« ${name} » part avec ses membres et son sceau. Les documents eux-mêmes restent. Il n'y a pas d'annulation.`,
          `“${name}” goes with its members and its seal. The documents themselves stay. There is no undo.`,
        ),
        confirmLabel: { ar: 'احذف', fr: 'Supprimer', en: 'Delete' },
      });
      if (!agreed) return false;
      return act('purge', 'dms.package.delete', { id }, {
        ok: w('حُذفت الحزمة', 'Dossier supprimé', 'Package deleted'),
        bad: w('تعذّر الحذف', 'Suppression impossible', 'Could not delete the package'),
      });
    },
    [act, runtime, tr],
  );

  return {
    createPackage,
    updatePackage,
    setMember,
    sealPackage,
    verifyPackage,
    voidPackage,
    deletePackage,
  };
}

/* ------------------------------------------------------------------ *
 * Out of the app
 * ------------------------------------------------------------------ */

/**
 * What the save dialog offers to call the file.
 *
 * The view is in the name because six tabs export six different tables and a folder
 * of `dms-2026-09-05.csv`, `dms-2026-09-05 (1).csv` tells nobody which is which. The
 * date is the caller's — `format.ts`'s `isoToday()` — rather than a `new Date()` here,
 * so a report exported from a screen that says "as of the 4th" is not stamped the 5th
 * because the clock turned over while it was open.
 */
const fileName = (view: DmsView, today: string): string => `dms-${view}-${today}.csv`;

export interface TransferActions {
  readonly exportCsv: (view: DmsView, content: string, today: string) => void;
  readonly copy: (text: string) => void;
  /** Cross-app, carrying an argument: every neighbour reads a document id. */
  readonly openApp: (app: AppId, args?: Readonly<Record<string, string>>) => void;
}

/**
 * The three verbs that move something out of the window.
 *
 * All three return `void` rather than a promise, and that is the difference between
 * this group and every other one in the file: nothing downstream branches on whether
 * a copy succeeded. A dialog needs to know whether its save worked so it can stay
 * open; a toolbar button does not, so the promise is consumed here and the caller gets
 * a plain click handler.
 *
 * `openApp` takes arguments where Customers' does not, because the DMS is the app
 * neighbours are pointed *at* and the app that points back: an invoice with a scanned
 * bill filed against it is reachable from the document, and `{ invoiceId }` is how the
 * accounting app is told which one.
 */
function useTransferActions(setBusy: (busy: DmsBusy) => void): TransferActions {
  const runtime = useApp();
  const { tr } = runtime.locale;

  const exportCsv = useCallback(
    (view: DmsView, content: string, today: string): void => {
      const run = async (): Promise<void> => {
        setBusy('export');
        const chosen = await runtime.invoke('shell.fileDialog', {
          mode: 'save',
          title: tr('تصدير CSV', 'Exporter en CSV', 'Export as CSV'),
          startPath: REPORTS,
          suggestedName: fileName(view, today),
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
        setBusy(null);
        await runtime.toast(
          written.ok
            ? { kind: 'success', title: tr('تم التصدير', 'Exporté', 'Exported'), body: path }
            : {
                kind: 'error',
                title: tr('تعذّر التصدير', 'Export impossible', 'Export failed'),
                body: written.error.message,
              },
        );
      };
      void run();
    },
    [runtime, setBusy, tr],
  );

  /**
   * A checksum, a document number, a storage path — the three things somebody copies
   * out of this app to paste into a ticket. Nothing to copy is not a failure: the row
   * was simply one the server sent without that column.
   */
  const copy = useCallback(
    (text: string): void => {
      if (text === '') return;
      void runtime.invoke('shell.clipboardWrite', { text }).then((result) =>
        runtime.toast(
          result.ok
            ? { kind: 'success', title: tr('تم النسخ', 'Copié', 'Copied') }
            : { kind: 'error', title: tr('تعذّر النسخ', 'Copie impossible', 'Copy failed') },
        ),
      );
    },
    [runtime, tr],
  );

  const openApp = useCallback(
    (app: AppId, args?: Readonly<Record<string, string>>) => void runtime.launch(app, args),
    [runtime],
  );

  return { exportCsv, copy, openApp };
}

/* ------------------------------------------------------------------ *
 * The composition root
 * ------------------------------------------------------------------ */

/**
 * Everything a DMS pane can do, flat.
 *
 * Flat and not nested — `actions.approve(id)` rather than `actions.review.approve(id)`
 * — because a grid cell already knows which verb it renders and does not need to be
 * told which family it came from. The seven groups above are how this file is read;
 * they are not a shape the views should have to navigate.
 *
 * `busy` is the one field, and it is singular for a reason: the twenty-seven keys in
 * {@link DmsBusy} name controls, not families, so `busy === 'approve'` disables the
 * Approve button and nothing else. One state and one setter also mean two commands
 * cannot both believe they are the one in flight — the second overwrites the first,
 * and the spinner follows the click that actually happened last.
 */
export interface DmsActions
  extends ByteActions,
    ReviewActions,
    MetadataActions,
    FilingActions,
    ExtractionActions,
    PackageActions,
    TransferActions {
  readonly busy: DmsBusy;
}

/**
 * One `useLedgerCommand` for all twenty-six commands, one `busy` for all of them.
 *
 * The hook is called once here and threaded down rather than called inside each group,
 * because `useLedgerCommand` carries its own `running` and `error` and seven copies
 * would be seven answers to "is something happening" — none of which the views ask.
 * They ask `busy`, which is finer.
 */
export function useDmsActions(): DmsActions {
  const ledger = useLedgerCommand();
  const [busy, setBusy] = useState<DmsBusy>(null);
  const bytes = useByteActions(setBusy);
  const review = useReviewCommands(ledger, setBusy);
  const metadata = useMetadataCommands(ledger, setBusy);
  const filing = useFilingCommands(ledger, setBusy);
  const extraction = useExtractionCommands(ledger, setBusy);
  const packages = usePackageCommands(ledger, setBusy);
  const transfer = useTransferActions(setBusy);
  return {
    busy,
    ...bytes,
    ...review,
    ...metadata,
    ...filing,
    ...extraction,
    ...packages,
    ...transfer,
  };
}
