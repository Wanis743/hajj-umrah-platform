/**
 * Everything the DMS window knows about itself.
 *
 * `model.ts` reads, `actions.ts` writes, and this is the third thing an app needs and the
 * one that has no home in either: which tab is open, which row is selected on each tab,
 * which dialog is up, what has been typed into it, and which of thirty-odd command ids the
 * menu bar just fired. Same shape as `crm/shell.ts` — five cooperating hooks assembled by
 * one `useDmsShell()` that returns a single flat surface — because a reader who has learned
 * one app of this OS should not have to learn a second vocabulary for the next.
 *
 * Three places it departs from CRM, each forced rather than chosen:
 *
 * Five command tiers rather than four. DMS has thirty-six verbs against CRM's twenty-three,
 * and the review transitions are gated — `approve` is legal from `UNDER_REVIEW` and from
 * nowhere else — so they cannot share a tier with the ungated document verbs. A flat switch
 * over all thirty-six measures far past the `complexity` ceiling of 20; five callbacks of
 * six to ten branches each sit comfortably under it and read as the five groups they are.
 *
 * Fourteen dialog members rather than eight. Documents carry bytes, expiry dates, links,
 * relations, packages and extracted fields, and each of those is a form. Two of the fourteen
 * hold a *result* rather than a draft — `preview` holds a signed URL, `verify` holds a seal
 * report — because `shell.openUrl` does not exist in this ABI and `verifyPackage` is silent
 * on success by design, so a pane is the only place either can land.
 *
 * Two of the six tabs have no selectable row. `dashboard` and `extraction` are report
 * surfaces: the extraction-quality report is an aggregate over fields and engines whose rows
 * carry no document id. `EMPTY_SELECTION` still declares all six keys so the record is
 * complete from the first render and a tab added later fails typecheck here.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, Ref } from 'react';

import { APP_IDS, useLocale, type AppId } from '@/platform/sdk';

import { hotkey, useDmsActions, useDmsFocus } from './actions';
import type { DmsActions, DmsBusy, DmsTarget, FieldReviewAction } from './actions';
import type { MetadataDraft, PackageDraft, UploadDraft } from './actions';
import { dmsClipboard, dmsCsv } from './export';
import type { Translate } from './export';
import { isoToday } from './format';
import { useDmsModel } from './model';
import type { DmsModel } from './model';
import { DMS_REVIEW_TRANSITIONS } from './types';
import type {
  DmsConfidentiality,
  DmsDocument,
  DmsDocumentRelation,
  DmsExpiryDocument,
  DmsField,
  DmsJob,
  DmsLink,
  DmsLinkEntityType,
  DmsLinkRelation,
  DmsPackage,
  DmsQueueRow,
  DmsReviewStatus,
  DmsVerification,
  DmsVersion,
  DmsView,
} from './types';


/* ------------------------------------------------------------------ *
 * The four kinds of row a selection can hold
 * ------------------------------------------------------------------ */

/**
 * What is selected, whichever tab is open.
 *
 * Four row types and not one, because the four grids read four different datasets and
 * flattening them into a common shape would mean either dropping the columns each one is
 * uniquely for — a queue row's wait, an expiring document's linked entities — or inventing
 * nulls for them everywhere. The union keeps every column and the guards below recover the
 * member, which is what a toolbar needs when it has to decide whether Approve applies.
 */
export type DmsRow = DmsDocument | DmsQueueRow | DmsExpiryDocument | DmsPackage;

/**
 * Four guards, each on the one key its member carries alone.
 *
 * `row` is the document's raw `SourceRow`, `waitingHours` is computed by the queue's RPC,
 * `linkedEntityTypes` is aggregated by the expiry report, `documentCount` by the package
 * list. No two of them appear on any other member, so the guards are order-independent and
 * a reader does not have to know which was tested first.
 */
export const isDocument = (row: DmsRow): row is DmsDocument => 'row' in row;
export const isQueued = (row: DmsRow): row is DmsQueueRow => 'waitingHours' in row;
export const isExpiring = (row: DmsRow): row is DmsExpiryDocument => 'linkedEntityTypes' in row;
export const isPackage = (row: DmsRow): row is DmsPackage => 'documentCount' in row;

/** What to call it in a dialog body or a toast. Packages have a name; documents have a title. */
export const labelOf = (row: DmsRow): string => (isPackage(row) ? row.name : row.title);

/**
 * The document behind a row, or null if the row is not one.
 *
 * Three of the four members *are* documents under different projections, so their `id` is a
 * document id and every document verb can take it. A package's id is not, which is why this
 * returns null rather than `row.id` — passing a package id to `dms.document.approve` would
 * be a `PGRST116` in front of a user.
 */
export const documentIdOf = (row: DmsRow): string | null => (isPackage(row) ? null : row.id);

/**
 * Where a row sits in the approval machine, or null for a package.
 *
 * No cast: all three document projections type the column as `DmsReviewStatus`, because all
 * three read it from the same CHECK-constrained column. This is what gates the review tier.
 */
export const reviewStatusOf = (row: DmsRow): DmsReviewStatus | null =>
  isPackage(row) ? null : row.reviewStatus;

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

/** The manifest's four jump-list entries plus the two tabs it does not advertise. */
const VIEW_COMMAND: Readonly<Record<string, DmsView>> = {
  'view:dashboard': 'dashboard',
  'view:library': 'library',
  'view:review': 'review',
  'view:expiry': 'expiry',
  'view:extraction': 'extraction',
  'view:packages': 'packages',
};

/**
 * Nothing selected anywhere, declared for all six tabs.
 *
 * `dashboard` and `extraction` will never hold a value — their surfaces are reports whose
 * rows have no ids — and they are in the record anyway so that the type is exhaustive over
 * `DmsView` and a seventh tab added to `DMS_VIEWS` fails typecheck here rather than reading
 * `undefined` out of this object at runtime.
 */
const EMPTY_SELECTION: Readonly<Record<DmsView, string | null>> = {
  dashboard: null,
  library: null,
  review: null,
  expiry: null,
  extraction: null,
  packages: null,
};

/**
 * The row the id names, looked up in the *whole* list rather than the filtered one.
 *
 * A selection survives typing in the search box: the row scrolls out of the grid and the
 * toolbar keeps describing it, which is what lets somebody search for a second document,
 * link it to the first, and still see the first named on the button they press. Reading the
 * visible list instead would blank the toolbar mid-keystroke.
 */
function findRow(model: DmsModel, view: DmsView, id: string | null): DmsRow | null {
  if (id === null) return null;
  if (view === 'library') return model.documents.rows.find((row) => row.id === id) ?? null;
  if (view === 'review') return model.queue.rows.find((row) => row.id === id) ?? null;
  if (view === 'expiry') {
    return model.expiry.value?.documents.find((row) => row.id === id) ?? null;
  }
  if (view === 'packages') return model.packages.rows.find((row) => row.id === id) ?? null;
  return null;
}

/**
 * What the status bar says: rows shown of rows held.
 *
 * `dashboard` reports zero of zero rather than a document count, because the tab shows tiles
 * and charts and a row count next to them would describe something that is not on screen.
 * `extraction` counts the quality report's per-field rows, which is what its grid renders,
 * and reports them as unfiltered — the search box does not narrow an aggregate.
 */
function tally(model: DmsModel, view: DmsView): { shown: number; total: number } {
  if (view === 'library') return { shown: model.visible.length, total: model.documents.rows.length };
  if (view === 'review') {
    return { shown: model.visibleQueue.length, total: model.queue.rows.length };
  }
  if (view === 'expiry') {
    return {
      shown: model.visibleExpiry.length,
      total: model.expiry.value?.documents.length ?? 0,
    };
  }
  if (view === 'extraction') {
    const fields = model.quality.value?.byField.length ?? 0;
    return { shown: fields, total: fields };
  }
  if (view === 'packages') {
    return { shown: model.visiblePackages.length, total: model.packages.rows.length };
  }
  return { shown: 0, total: 0 };
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

/**
 * What the upload dialog holds, which is not what `upload()` takes.
 *
 * A form is all strings and a nullable file, because that is what an `<input>` produces and
 * because a half-typed `30` in the notice-days box is the string `"3"` before it is the number
 * 3. `UploadDraft` is the typed thing the action wants, and `toUploadDraft` below is the one
 * place the conversion — and the refusal, when there is no file — happens.
 *
 * `documentId` is how a new version reaches the same dialog: set, and the bytes attach to an
 * existing document rather than creating one, which is the difference between "upload" and
 * "upload a corrected scan of this passport".
 */
export interface UploadForm {
  readonly file: File | null;
  readonly documentId: string | null;
  readonly title: string;
  readonly documentType: string;
  readonly description: string;
  readonly confidentiality: DmsConfidentiality;
  readonly issuedOn: string;
  readonly expiresOn: string;
  readonly noticeDays: string;
  readonly tags: string;
  readonly queueExtraction: boolean;
}

/** A fresh upload. `INTERNAL` is the default the migration's column default also uses. */
const EMPTY_UPLOAD: UploadForm = {
  file: null,
  documentId: null,
  title: '',
  documentType: '',
  description: '',
  confidentiality: 'INTERNAL',
  issuedOn: '',
  expiresOn: '',
  noticeDays: '',
  tags: '',
  queueExtraction: false,
};

/**
 * The same dialog, aimed at an existing document.
 *
 * Type, confidentiality and expiry carry over from the document being replaced, because a
 * corrected scan of a passport is still a passport and still expires when the passport does.
 * The title carries over too and stays editable: the server takes it per version, and the one
 * time it should change is when the old title was wrong.
 */
const newVersionForm = (document: DmsDocument): UploadForm => ({
  ...EMPTY_UPLOAD,
  documentId: document.id,
  title: document.title,
  documentType: document.documentType,
  confidentiality: document.confidentiality,
  issuedOn: document.issuedOn ?? '',
  expiresOn: document.expiresOn ?? '',
});

/** What the metadata editor holds. `clearExpiry` is a checkbox because null is not a date. */
export interface MetaForm {
  readonly title: string;
  readonly description: string;
  readonly documentType: string;
  readonly confidentiality: DmsConfidentiality;
  readonly issuedOn: string;
  readonly expiresOn: string;
  readonly noticeDays: string;
  readonly clearExpiry: boolean;
}

/** Prefilled from the row rather than from a second fetch — this is why `DmsDocument` is wide. */
const metaFormOf = (document: DmsDocument): MetaForm => ({
  title: document.title,
  description: document.description,
  documentType: document.documentType,
  confidentiality: document.confidentiality,
  issuedOn: document.issuedOn ?? '',
  expiresOn: document.expiresOn ?? '',
  noticeDays: String(document.expiryNoticeDays),
  clearExpiry: false,
});

/** Filing a document against a business record. `ABOUT` is the broker's own default. */
export interface LinkForm {
  readonly entityType: DmsLinkEntityType;
  readonly entityId: string;
  readonly relation: DmsLinkRelation;
  readonly note: string;
}

const EMPTY_LINK: LinkForm = {
  entityType: 'booking',
  entityId: '',
  relation: 'ABOUT',
  note: '',
};

/** Filing a document against another document. */
export interface RelateForm {
  readonly toDocumentId: string;
  readonly relation: DmsDocumentRelation;
  readonly note: string;
}

const EMPTY_RELATE: RelateForm = {
  toDocumentId: '',
  relation: 'SUPPORTS',
  note: '',
};

/** An evidence package, new or being renamed. The same four fields serve both. */
export interface PackForm {
  readonly name: string;
  readonly purpose: string;
  readonly reference: string;
  readonly notes: string;
}

const EMPTY_PACK: PackForm = { name: '', purpose: '', reference: '', notes: '' };

const packFormOf = (pack: DmsPackage): PackForm => ({
  name: pack.name,
  purpose: pack.purpose,
  reference: pack.reference,
  notes: pack.notes,
});

/* ------------------------------------------------------------------ *
 * Form to draft
 * ------------------------------------------------------------------ */

/** A field left blank is absent, not empty. The broker treats `''` as a value and stores it. */
const said = (text: string): string | undefined => {
  const value = text.trim();
  return value === '' ? undefined : value;
};

/** A whole non-negative count, or absent. A half-typed `""` must not become `NaN` days. */
const counted = (text: string): number | undefined => {
  if (text.trim() === '') return undefined;
  const value = Number.parseInt(text.trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

/**
 * A comma-separated box into the array the column holds.
 *
 * Trims, drops blanks, and de-duplicates, because `passport, passport` typed into a box is a
 * slip and not a request for a repeated tag. Order is preserved: the first mention wins, so
 * the list reads back the way it was typed.
 */
export function splitTags(text: string): readonly string[] {
  const seen = new Set<string>();
  for (const part of text.split(',')) {
    const tag = part.trim();
    if (tag !== '') seen.add(tag);
  }
  return [...seen];
}

/**
 * The upload form as the action wants it, or null when it is not yet sendable.
 *
 * Two things are required and neither can be defaulted: the bytes, and the document type,
 * which is the workspace's own filing vocabulary and the column the whole library sorts by.
 * The title *can* be defaulted, and is — to the file's own name, which is what somebody
 * dropping four scans in a row expects rather than four dialogs demanding a title.
 *
 * Returning null rather than throwing is what lets the dialog's Upload button use this same
 * function as its enabled test: one definition of "sendable", checked in both places.
 */
export function toUploadDraft(form: UploadForm): UploadDraft | null {
  if (form.file === null) return null;
  const documentType = form.documentType.trim();
  if (documentType === '') return null;
  const tags = splitTags(form.tags);
  return {
    file: form.file,
    title: said(form.title) ?? form.file.name,
    documentType,
    documentId: form.documentId ?? undefined,
    description: said(form.description),
    confidentiality: form.confidentiality,
    issuedOn: said(form.issuedOn),
    expiresOn: said(form.expiresOn),
    expiryNoticeDays: counted(form.noticeDays),
    tags: tags.length === 0 ? undefined : tags,
    queueExtraction: form.queueExtraction,
  };
}

/**
 * The metadata form as the action wants it.
 *
 * Every field is sent because every field was prefilled from the row, so an unchanged box is
 * the value that is already there and re-sending it is a no-op the server absorbs. Blank means
 * two different things and the difference is per column: an emptied description is a real
 * instruction — somebody deleted the text and meant it, and the column holds `''` — while an
 * emptied date or type cannot be sent at all, because `''` is not a date and a document with
 * no type has left the filing system. Those go as absent. Removing an expiry outright is
 * `clearExpiry`, which the broker reads as an instruction rather than as a value.
 */
export const toMetadataDraft = (form: MetaForm): MetadataDraft => ({
  title: said(form.title),
  description: form.description.trim(),
  documentType: said(form.documentType),
  confidentiality: form.confidentiality,
  issuedOn: said(form.issuedOn),
  expiresOn: form.clearExpiry ? undefined : said(form.expiresOn),
  expiryNoticeDays: counted(form.noticeDays),
  clearExpiry: form.clearExpiry ? true : undefined,
});

/** A package's four optional fields. `name` blank means "leave it" on an update. */
export const toPackageDraft = (form: PackForm): PackageDraft => ({
  name: said(form.name),
  purpose: said(form.purpose),
  reference: said(form.reference),
  notes: said(form.notes),
});

/* ------------------------------------------------------------------ *
 * Dialogs
 * ------------------------------------------------------------------ */

/**
 * Fourteen members, which is one per thing a document can have done to it that needs words.
 *
 * Twelve carry a draft and are committed. Two carry a *result* and are not: `preview` holds the
 * signed URL that `previewUrl` returned, because the eight shell syscalls do not include one
 * that opens a URL and rendering it in-pane is therefore the only legal way to show a document;
 * `verify` holds what `verifyPackage` returned, because that command reports a match and a
 * mismatch as equally ordinary results and says nothing itself. Both start `loading: true` so
 * the pane can open immediately and fill in when the round trip lands, rather than making
 * somebody wait on a blank screen wondering whether the click registered.
 */
export type DmsDialog =
  | { readonly kind: 'upload'; readonly form: UploadForm }
  | { readonly kind: 'metadata'; readonly id: string; readonly title: string; readonly form: MetaForm }
  | { readonly kind: 'tags'; readonly id: string; readonly title: string; readonly text: string }
  | { readonly kind: 'reject'; readonly id: string; readonly title: string; readonly text: string }
  | { readonly kind: 'changes'; readonly id: string; readonly title: string; readonly text: string }
  | { readonly kind: 'link'; readonly id: string; readonly title: string; readonly form: LinkForm }
  | { readonly kind: 'relate'; readonly id: string; readonly title: string; readonly form: RelateForm }
  | { readonly kind: 'package'; readonly id: string | null; readonly form: PackForm }
  | {
      readonly kind: 'member';
      readonly packageId: string | null;
      readonly documentId: string | null;
      readonly text: string;
    }
  | { readonly kind: 'void'; readonly id: string; readonly title: string; readonly text: string }
  | { readonly kind: 'correct'; readonly id: string; readonly title: string; readonly text: string }
  | { readonly kind: 'failJob'; readonly id: string; readonly title: string; readonly text: string }
  | {
      readonly kind: 'preview';
      readonly id: string;
      readonly title: string;
      readonly url: string | null;
      readonly loading: boolean;
    }
  | {
      readonly kind: 'verify';
      readonly id: string;
      readonly title: string;
      readonly report: DmsVerification | null;
      readonly loading: boolean;
    };

/**
 * Which end of a membership is being chosen.
 *
 * One dialog serves both directions — "add this document to a package" and "add a document to
 * this package" — because the command is the same one and only the blank differs. Whichever id
 * arrives null is the select the dialog renders.
 */
export interface MemberEnd {
  readonly packageId?: string | null;
  readonly documentId?: string | null;
}

export interface DmsDialogs {
  readonly dialog: DmsDialog | null;
  readonly open: (next: DmsDialog) => void;
  readonly close: () => void;
  readonly setUpload: (patch: Partial<UploadForm>) => void;
  readonly setMeta: (patch: Partial<MetaForm>) => void;
  readonly setLink: (patch: Partial<LinkForm>) => void;
  readonly setRelate: (patch: Partial<RelateForm>) => void;
  readonly setPack: (patch: Partial<PackForm>) => void;
  readonly setText: (text: string) => void;
  readonly setMemberEnd: (patch: MemberEnd) => void;
  /**
   * Both take the id they were asked for and drop the answer if it no longer matches.
   *
   * A signed URL and a seal report are the two things in this app that arrive after a round
   * trip into a dialog that is still on screen. Somebody who previews one document, closes it
   * and previews another would otherwise see the first document's bytes under the second one's
   * title — which in a documents system is not a cosmetic race.
   */
  readonly setPreview: (id: string, url: string | null) => void;
  readonly setVerify: (id: string, report: DmsVerification | null) => void;
}

/**
 * The open dialog and the eight ways to type into it.
 *
 * Every setter re-checks the member inside the updater rather than trusting the closure it was
 * created in. That is not defensiveness: a keystroke that was in flight when the dialog changed
 * — a paste landing as the previous commit resolved and reopened something else — would
 * otherwise write a rejection reason into a package's name. Re-reading the current member costs
 * one comparison and makes that impossible.
 *
 * Seven members carry their one string under the same key, `text`, which is why there is one
 * `setText` rather than seven near-identical setters. The uniformity is deliberate: a reason, a
 * note, a tag list and an error message are all "the one thing this dialog collects", and giving
 * them different key names would only mean the dialog component had to remember which.
 */
export function useDmsDialogs(): DmsDialogs {
  const [dialog, setDialog] = useState<DmsDialog | null>(null);
  const open = useCallback((next: DmsDialog): void => setDialog(next), []);
  const close = useCallback((): void => setDialog(null), []);

  const setUpload = useCallback((patch: Partial<UploadForm>): void => {
    setDialog((current) =>
      current?.kind === 'upload' ? { ...current, form: { ...current.form, ...patch } } : current,
    );
  }, []);

  const setMeta = useCallback((patch: Partial<MetaForm>): void => {
    setDialog((current) =>
      current?.kind === 'metadata' ? { ...current, form: { ...current.form, ...patch } } : current,
    );
  }, []);

  const setLink = useCallback((patch: Partial<LinkForm>): void => {
    setDialog((current) =>
      current?.kind === 'link' ? { ...current, form: { ...current.form, ...patch } } : current,
    );
  }, []);

  const setRelate = useCallback((patch: Partial<RelateForm>): void => {
    setDialog((current) =>
      current?.kind === 'relate' ? { ...current, form: { ...current.form, ...patch } } : current,
    );
  }, []);

  const setPack = useCallback((patch: Partial<PackForm>): void => {
    setDialog((current) =>
      current?.kind === 'package' ? { ...current, form: { ...current.form, ...patch } } : current,
    );
  }, []);

  const setText = useCallback((text: string): void => {
    setDialog((current) => (current !== null && 'text' in current ? { ...current, text } : current));
  }, []);

  const setMemberEnd = useCallback((patch: MemberEnd): void => {
    setDialog((current) => (current?.kind === 'member' ? { ...current, ...patch } : current));
  }, []);

  /** The signed URL landing. `loading` goes false either way — a null url is a failed fetch. */
  const setPreview = useCallback((id: string, url: string | null): void => {
    setDialog((current) =>
      current?.kind === 'preview' && current.id === id
        ? { ...current, url, loading: false }
        : current,
    );
  }, []);

  const setVerify = useCallback((id: string, report: DmsVerification | null): void => {
    setDialog((current) =>
      current?.kind === 'verify' && current.id === id
        ? { ...current, report, loading: false }
        : current,
    );
  }, []);

  return {
    dialog, open, close, setUpload, setMeta, setLink, setRelate, setPack,
    setText, setMemberEnd, setPreview, setVerify,
  };
}

/* ------------------------------------------------------------------ *
 * Tab, selection, search, menu
 * ------------------------------------------------------------------ */

/** Where a context menu was raised and over what. */
export interface DmsAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: DmsRow;
}

export interface DmsUi {
  readonly view: DmsView;
  readonly search: string;
  readonly selectedId: string | null;
  readonly menu: DmsAnchor | null;
  readonly windowDays: number;
  readonly horizonDays: number;
  readonly changeView: (next: DmsView) => void;
  readonly setSearch: (text: string) => void;
  readonly pickRow: (id: string | null) => void;
  readonly openMenu: (event: MouseEvent<Element>, row: DmsRow) => void;
  readonly closeMenu: () => void;
  readonly setWindowDays: (days: number) => void;
  readonly setHorizonDays: (days: number) => void;
}

/**
 * The window's own state, which is to say everything the server does not know.
 *
 * A selection per tab rather than one shared: moving from the review queue to the library and
 * back should find the same row still under the cursor, and it is the same document seen twice
 * from two angles rather than two selections competing for one slot.
 *
 * Two ranges live here because they are questions the *reader* asks and not properties of the
 * data: thirty days is how far back the extraction-quality report looks, ninety is how far
 * forward the expiry report does. Both are handed to `useDmsModel`, which re-reads when they
 * change, so a clerk widening the horizon to a year gets a second round trip and not a
 * client-side filter over a page that never held the rows.
 */
export function useDmsUi(): DmsUi {
  const [view, setView] = useState<DmsView>('dashboard');
  const [search, setSearch] = useState('');
  const [selection, setSelection] =
    useState<Readonly<Record<DmsView, string | null>>>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<DmsAnchor | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [horizonDays, setHorizonDays] = useState(90);

  const changeView = useCallback((next: DmsView): void => {
    setView(next);
    setMenu(null);
  }, []);

  const pickRow = useCallback((id: string | null): void => {
    setSelection((current) => ({ ...current, [view]: id }));
  }, [view]);

  /**
   * Select first, then place the menu.
   *
   * A right-click on an unselected row has to move the selection before the flyout appears, or
   * the menu's own verbs — Approve, Seal, Delete — would act on whatever was selected before,
   * which is the worst possible bug to ship on a menu whose last item deletes a document.
   */
  const openMenu = useCallback((event: MouseEvent<Element>, row: DmsRow): void => {
    event.preventDefault();
    setSelection((current) => ({ ...current, [view]: row.id }));
    setMenu({ x: event.clientX, y: event.clientY, row });
  }, [view]);

  const closeMenu = useCallback((): void => setMenu(null), []);

  /**
   * Another window asking DMS to show one row.
   *
   * `useDmsFocus` listens on the shared focus channel, so a CRM quote or a booking can hand
   * over a document id and have the library open on it. The tab moves with the selection —
   * pointing at a row on a tab nobody is looking at would be a silent no-op.
   */
  useDmsFocus(
    useCallback((target: DmsTarget): void => {
      setView(target.view);
      setMenu(null);
      setSelection((current) => ({ ...current, [target.view]: target.id }));
    }, []),
  );

  return {
    view,
    search,
    selectedId: selection[view],
    menu,
    windowDays,
    horizonDays,
    changeView,
    setSearch,
    pickRow,
    openMenu,
    closeMenu,
    setWindowDays,
    setHorizonDays,
  };
}

/* ------------------------------------------------------------------ *
 * Committing a dialog
 * ------------------------------------------------------------------ */

export interface DmsCommits {
  readonly commitUpload: () => Promise<void>;
  readonly commitMetadata: () => Promise<void>;
  readonly commitTags: () => Promise<void>;
  readonly commitReject: () => Promise<void>;
  readonly commitChanges: () => Promise<void>;
  readonly commitLink: () => Promise<void>;
  readonly commitRelate: () => Promise<void>;
  readonly commitPackage: () => Promise<void>;
  readonly commitMember: () => Promise<void>;
  readonly commitVoid: () => Promise<void>;
  readonly commitCorrect: () => Promise<void>;
  readonly commitFailJob: () => Promise<void>;
}

/**
 * Twelve savers, all built the same way: check the member, run the verb, close only if it took.
 *
 * Closing on failure is the bug this shape exists to prevent. A rejected upload — wrong mime
 * type, too many bytes, a permission the principal does not hold — has already toasted its own
 * reason through `useAct`, and a dialog that vanishes at the same moment throws away the form
 * the person spent a minute filling in. So every one of these reads the boolean and leaves the
 * dialog standing when it is false.
 *
 * Each commit re-checks `dialog.kind` rather than trusting the caller. The dialog component
 * knows which member it rendered, but a stale click landing after a `close()` would otherwise
 * commit the wrong shape, and the narrowing costs one comparison.
 *
 * The required-field guards return silently rather than toasting. A reject with no reason cannot
 * be sent — the broker refuses it — but the button that would send it is disabled by the same
 * predicate, so reaching this branch means a keyboard shortcut got ahead of the render, and a
 * toast for that would be noise about a thing the person cannot see.
 */
export function useDmsCommits(
  dialog: DmsDialog | null,
  close: () => void,
  actions: DmsActions,
): DmsCommits {
  const commitUpload = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'upload') return;
    const draft = toUploadDraft(dialog.form);
    if (draft === null) return;
    const id = await actions.upload(draft);
    if (id !== null) close();
  }, [dialog, actions, close]);

  const commitMetadata = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'metadata') return;
    if (await actions.saveMetadata(dialog.id, toMetadataDraft(dialog.form))) close();
  }, [dialog, actions, close]);

  /** An emptied tag box is a real instruction: it clears every tag. No guard. */
  const commitTags = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'tags') return;
    if (await actions.setTags(dialog.id, splitTags(dialog.text))) close();
  }, [dialog, actions, close]);

  const commitReject = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'reject') return;
    const reason = dialog.text.trim();
    if (reason === '') return;
    if (await actions.reject(dialog.id, reason)) close();
  }, [dialog, actions, close]);

  const commitChanges = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'changes') return;
    const note = dialog.text.trim();
    if (note === '') return;
    if (await actions.requestChanges(dialog.id, note)) close();
  }, [dialog, actions, close]);

  const commitLink = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'link') return;
    const { entityType, entityId, relation, note } = dialog.form;
    const target = entityId.trim();
    if (target === '') return;
    if (await actions.link(dialog.id, entityType, target, relation, said(note))) close();
  }, [dialog, actions, close]);

  const commitRelate = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'relate') return;
    const { toDocumentId, relation, note } = dialog.form;
    const target = toDocumentId.trim();
    if (target === '' || target === dialog.id) return;
    if (await actions.relate(dialog.id, target, relation, said(note))) close();
  }, [dialog, actions, close]);

  /**
   * One dialog for two commands, on whether it carries an id.
   *
   * `draft.name` doubles as the create guard: `toPackageDraft` puts the trimmed name there or
   * leaves it absent, and a package with no name is the one field the server will not default.
   * Update needs no such guard — an unnamed edit simply does not send `name`, and the row keeps
   * the name it had.
   */
  const commitPackage = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'package') return;
    const draft = toPackageDraft(dialog.form);
    if (dialog.id !== null) {
      if (await actions.updatePackage(dialog.id, draft)) close();
      return;
    }
    if (draft.name === undefined) return;
    if (await actions.createPackage(draft.name, draft)) close();
  }, [dialog, actions, close]);

  /**
   * Filing a document into a package, always inwards.
   *
   * `include: false` is never reached from here: removing a member is a one-click verb on the
   * package's own document list, where the row to remove is the row under the cursor. This
   * dialog exists for the other direction — a document open in the library, going into a package
   * chosen from a list — and both ends have to be picked before it can send.
   */
  const commitMember = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'member') return;
    const { packageId, documentId, text } = dialog;
    if (packageId === null || documentId === null) return;
    if (await actions.setMember(packageId, documentId, true, said(text))) close();
  }, [dialog, actions, close]);

  const commitVoid = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'void') return;
    const reason = dialog.text.trim();
    if (reason === '') return;
    if (await actions.voidPackage(dialog.id, reason)) close();
  }, [dialog, actions, close]);

  /** A correction to an empty string is not a correction; that is what REJECT is for. */
  const commitCorrect = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'correct') return;
    const value = dialog.text.trim();
    if (value === '') return;
    if (await actions.reviewField(dialog.id, 'CORRECT', value)) close();
  }, [dialog, actions, close]);

  /**
   * Marking a job failed, which is the only extraction outcome a human may report.
   *
   * `recordExtraction` can also write `completed`, and the app deliberately never calls it that
   * way: a person clicking a button has not run an engine, and a job marked complete with no
   * fields behind it would put a lie in the quality report. The message is optional — "it did not
   * work" is a complete statement — so this is the one commit with no guard at all.
   */
  const commitFailJob = useCallback(async (): Promise<void> => {
    if (dialog?.kind !== 'failJob') return;
    const done = await actions.recordExtraction(
      dialog.id,
      'failed',
      undefined,
      undefined,
      said(dialog.text),
    );
    if (done) close();
  }, [dialog, actions, close]);

  return {
    commitUpload,
    commitMetadata,
    commitTags,
    commitReject,
    commitChanges,
    commitLink,
    commitRelate,
    commitPackage,
    commitMember,
    commitVoid,
    commitCorrect,
    commitFailJob,
  };
}

/* ------------------------------------------------------------------ *
 * The command path
 * ------------------------------------------------------------------ */

/**
 * The review verb each command asks for.
 *
 * Six ids against the six states a human can move a document to. Keeping them in a table
 * rather than in six branches is what lets one `includes` against
 * `DMS_REVIEW_TRANSITIONS` guard all of them: the gate reads "is this move legal from where
 * the document currently is", once, instead of six per-verb conditionals that would each
 * have to remember the graph.
 */
const REVIEW_TARGET: Readonly<Record<string, DmsReviewStatus>> = {
  submit: 'PENDING_REVIEW',
  start: 'UNDER_REVIEW',
  approve: 'APPROVED',
  reject: 'REJECTED',
  changes: 'CHANGES_REQUESTED',
  reopen: 'DRAFT',
};

/** Where a link can actually send somebody, and under what argument name. */
interface Jump {
  readonly app: AppId;
  readonly key: string;
}

/**
 * The three entity types another app can be aimed at.
 *
 * Seventeen types can be linked; three can be jumped to. `useCrmFocus` reads `customerId`,
 * `quoteId` and `opportunityId` off a launch, and CRM is — with DMS itself — one of only two
 * apps in the image that reads launch arguments at all. A `journal_entry` link is therefore
 * *not* here: `shell.launch(APP_IDS.journal)` would open the Journal on its own default
 * period, and an "Open in Journal" that lands nowhere near the entry is worse than no verb
 * at all. Widening this table is a change to the destination app, not to this one.
 */
const JUMP: Readonly<Partial<Record<DmsLinkEntityType, Jump>>> = {
  crm_customer: { app: APP_IDS.crm, key: 'customerId' },
  crm_quote: { app: APP_IDS.crm, key: 'quoteId' },
  crm_opportunity: { app: APP_IDS.crm, key: 'opportunityId' },
};

interface CommandDeps {
  readonly ui: DmsUi;
  readonly model: DmsModel;
  readonly dialogs: DmsDialogs;
  readonly actions: DmsActions;
  readonly selectedRow: DmsRow | null;
  /** Resolved once at mount. It names the exported file and does nothing else. */
  readonly today: string;
  readonly tr: Translate;
  /** Read side only. The shell hands the same ref out for the search box to attach to. */
  readonly searchRef: { readonly current: HTMLInputElement | null };
}

export interface DmsCommands {
  /** Run `id` against an explicit row — what a context menu does. */
  readonly perform: (id: string, row: DmsRow | null) => void;
  /** Run `id` against the current selection — what a menu bar and a hotkey do. */
  readonly command: (id: string) => void;
  readonly keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Accept or reject an extracted field outright; a correction needs the value first. */
  readonly judgeField: (field: DmsField) => (action: FieldReviewAction) => void;
  /** Report one extraction job as failed. Opens for the message; see {@link DmsCommits}. */
  readonly failJob: (job: DmsJob) => void;
  /** Mint a signed URL for one specific version and show it in the pane. */
  readonly previewVersion: (documentId: string, title: string, version: DmsVersion) => void;
  /** Follow a link into the app that owns the thing it points at, where one exists. */
  readonly openEntity: (link: DmsLink) => void;
  /** Whether `openEntity` would do anything for this link. Drives the menu item. */
  readonly canOpenEntity: (link: DmsLink) => boolean;
}

/**
 * The verbs that take a thing out of the detail pane rather than a row out of a grid.
 *
 * Lifted out of {@link useDmsCommandPath} because they share none of its machinery: no tier
 * asks them anything, `perform` never reaches them, and a field id, a job id and a link are
 * none of them a `DmsRow`. They need two things between them — the action layer and the
 * dialog opener — and reading them here rather than through `CommandDeps` says so.
 */
function useDmsDetailVerbs(
  actions: DmsActions,
  open: (next: DmsDialog) => void,
): Pick<DmsCommands, 'judgeField' | 'failJob' | 'openEntity' | 'canOpenEntity'> {
  /**
   * Two of the three field verdicts are one click; the third needs a value.
   *
   * Curried so a field cell renders its three buttons from one call. ACCEPT and REJECT go
   * straight out — the reviewer has already read the field, and a confirmation dialog for
   * "yes, that is what it says" is friction with no decision in it. CORRECT opens prefilled
   * with the corrected value if one exists and the engine's reading otherwise, because a
   * correction almost always starts from what is already there.
   */
  const judgeField = useCallback(
    (field: DmsField) => (action: FieldReviewAction): void => {
      if (action !== 'CORRECT') {
        void actions.reviewField(field.id, action);
        return;
      }
      open({
        kind: 'correct',
        id: field.id,
        title: field.fieldLabel,
        text: field.value === '' ? field.rawValue : field.value,
      });
    },
    [actions, open],
  );

  /**
   * Report one job as failed, which is the only extraction outcome a person may record.
   *
   * Opens rather than commits, because a failure with no message is legal but a failure with
   * one is useful, and the engine's own `errorMessage` is the right thing to start from — a
   * reviewer marking a job failed is usually copying the reason out of the row in front of
   * them. `commitFailJob` sends it; see the note there for why `completed` is unreachable.
   */
  const failJob = useCallback((job: DmsJob): void => {
    open({ kind: 'failJob', id: job.id, title: job.engine, text: job.errorMessage });
  }, [open]);

  const openEntity = useCallback((link: DmsLink): void => {
    const jump = JUMP[link.entityType];
    if (jump === undefined) return;
    actions.openApp(jump.app, { [jump.key]: link.entityId });
  }, [actions]);

  const canOpenEntity = useCallback(
    (link: DmsLink): boolean => JUMP[link.entityType] !== undefined,
    [],
  );

  return { judgeField, failJob, openEntity, canOpenEntity };
}

/**
 * Every verb in the app, behind one string.
 *
 * Five tiers, tried in order, each answering "was that mine?". A menu bar item, a hotkey, a
 * context-menu entry and a toolbar button all arrive here as the same id, so a verb is
 * written once and gains three more ways to be invoked for free — and the kernel's own
 * `app.command` traffic (the manifest's six commands and four jumps) lands in exactly the
 * same place as a click.
 *
 * The tiers are five cooperating callbacks rather than one switch because a single function
 * over forty ids would breach `complexity` 20 several times over. They also read as the
 * question each one asks: which tab, which app-wide verb, which review move, which document,
 * which package.
 */
function useDmsCommandPath(deps: CommandDeps): DmsCommands {
  const { ui, model, dialogs, actions, selectedRow, today, tr, searchRef } = deps;
  const { dialog, open, setPreview, setVerify } = dialogs;
  const { view, changeView } = ui;

  const runView = useCallback((id: string): boolean => {
    const next = VIEW_COMMAND[id];
    if (next === undefined) return false;
    changeView(next);
    return true;
  }, [changeView]);

  /**
   * The verbs that need no row.
   *
   * `export` and `copy` render whatever the open tab is currently showing — the filtered,
   * sorted page a person is looking at, not the whole table — because the honest answer to
   * "export this" is the thing on screen.
   */
  const runGlobal = useCallback((id: string): boolean => {
    if (id === 'refresh') { model.refreshAll(); return true; }
    if (id === 'search') { searchRef.current?.focus(); return true; }
    if (id === 'upload') { open({ kind: 'upload', form: EMPTY_UPLOAD }); return true; }
    if (id === 'export') {
      actions.exportCsv(view, dmsCsv(view, model, tr), today);
      return true;
    }
    if (id === 'copy') { actions.copy(dmsClipboard(view, model, tr)); return true; }
    if (id === 'sweep') { void actions.sweepExpiry(); return true; }
    if (id === 'package:new') {
      open({ kind: 'package', id: null, form: EMPTY_PACK });
      return true;
    }
    return false;
  }, [actions, model, open, searchRef, today, tr, view]);

  /**
   * Moving a document through review, and only where the graph allows it.
   *
   * The gate is one `includes` against `DMS_REVIEW_TRANSITIONS`, which is the app's copy of
   * the same CHECK the server enforces. An illegal move returns `true` — claimed and
   * silently refused — rather than `false`, because falling through to the tiers below would
   * let `approve` on an already-approved document be reinterpreted as something else. The
   * server would reject it anyway; refusing here means no round trip and no error toast for
   * a button that should not have been enabled.
   *
   * `archive` and `unarchive` are handled above the gate on purpose: they move `status`, not
   * `reviewStatus`, so the transition graph has nothing to say about them. An approved
   * document can be archived, and archiving it does not un-approve it.
   */
  const runReview = useCallback((id: string, row: DmsRow): boolean => {
    const documentId = documentIdOf(row);
    if (documentId === null) return false;

    if (id === 'archive') { void actions.setArchived(documentId, true); return true; }
    if (id === 'unarchive') { void actions.setArchived(documentId, false); return true; }

    const target = REVIEW_TARGET[id];
    if (target === undefined) return false;
    const from = reviewStatusOf(row);
    if (from === null || !DMS_REVIEW_TRANSITIONS[from].includes(target)) return true;

    const title = labelOf(row);
    if (target === 'REJECTED') {
      open({ kind: 'reject', id: documentId, title, text: '' });
      return true;
    }
    if (target === 'CHANGES_REQUESTED') {
      open({ kind: 'changes', id: documentId, title, text: '' });
      return true;
    }
    if (target === 'PENDING_REVIEW') { void actions.submit(documentId); return true; }
    if (target === 'UNDER_REVIEW') { void actions.startReview(documentId); return true; }
    if (target === 'APPROVED') { void actions.approve(documentId); return true; }
    void actions.reopen(documentId);
    return true;
  }, [actions, open]);

  /**
   * The full document behind a row, from whichever read happens to have it.
   *
   * A library row *is* a `DmsDocument`; a queue, expiry or 360 row is a projection with only
   * the columns its own dataset selected. Three sources are tried because the three grids page
   * independently — a document sitting in the review queue is not necessarily on the loaded
   * library page — and the verbs that prefill a form (metadata, tags, a new version) need the
   * real record rather than a subset. A miss means the form would open half-blank, so the
   * caller declines instead.
   */
  const documentOf = useCallback((row: DmsRow): DmsDocument | null => {
    if (isDocument(row)) return row;
    const paged = model.byId.get(row.id);
    if (paged !== undefined) return paged;
    const detail = model.selected.value;
    return detail !== null && detail.document.id === row.id ? detail.document : null;
  }, [model]);

  /**
   * Show one version's bytes.
   *
   * Opens the pane first and fills it when the URL lands, and hands the document id back to
   * `setPreview` so a URL that arrives after somebody has moved on is dropped rather than
   * shown under the wrong title. Any version, not only the current one: the version list is
   * where a reviewer compares what changed, and a signed URL is per storage path.
   */
  const previewVersion = useCallback(
    (documentId: string, title: string, version: DmsVersion): void => {
      open({ kind: 'preview', id: documentId, title, url: null, loading: true });
      void actions
        .previewUrl(documentId, version.storagePath)
        .then((url) => setPreview(documentId, url));
    },
    [actions, open, setPreview],
  );

  /**
   * The current version of a document, if the detail read has landed for that document.
   *
   * `storagePath` lives on `DmsVersion`, never on a grid row, so preview and copy-link are
   * genuinely unavailable until the 360 arrives — the app does not know where the bytes are
   * before then. Returning null rather than guessing is the whole point: a fabricated path
   * would mint a signed URL for a file that is not there.
   */
  const currentVersion = useCallback((documentId: string): DmsVersion | null => {
    const detail = model.selected.value;
    if (detail === null || detail.document.id !== documentId) return null;
    return detail.versions.find((version) => version.isCurrent) ?? null;
  }, [model]);

  /** Everything done to one document. Ordered cheapest-first: id, then bytes, then record. */
  const runDocument = useCallback((id: string, row: DmsRow): boolean => {
    const documentId = documentIdOf(row);
    if (documentId === null) return false;
    const title = labelOf(row);

    if (id === 'link') {
      open({ kind: 'link', id: documentId, title, form: EMPTY_LINK });
      return true;
    }
    if (id === 'relate') {
      open({ kind: 'relate', id: documentId, title, form: EMPTY_RELATE });
      return true;
    }
    if (id === 'member') {
      open({ kind: 'member', packageId: null, documentId, text: '' });
      return true;
    }
    if (id === 'queue') { void actions.queueExtraction(documentId); return true; }
    if (id === 'delete') { void actions.remove(documentId, title); return true; }

    if (id === 'preview' || id === 'link:copy') {
      const version = currentVersion(documentId);
      if (version === null) return true;
      if (id === 'preview') previewVersion(documentId, title, version);
      if (id === 'link:copy') void actions.copyLink(documentId, version.storagePath);
      return true;
    }

    const full = documentOf(row);
    if (full === null) return false;
    if (id === 'metadata') {
      open({ kind: 'metadata', id: documentId, title, form: metaFormOf(full) });
      return true;
    }
    if (id === 'tags') {
      open({ kind: 'tags', id: documentId, title, text: full.tags.join(', ') });
      return true;
    }
    if (id === 'version:new') { open({ kind: 'upload', form: newVersionForm(full) }); return true; }
    return false;
  }, [actions, currentVersion, documentOf, open, previewVersion]);

  /**
   * Everything done to one evidence package.
   *
   * `package:verify` opens its pane and fills it the same way `preview` does, because a seal
   * check is a question with two ordinary answers — matches, or does not — and the command
   * itself says nothing. Seal, void and delete each raise their own confirmation inside
   * `actions`, so there is none here: one dialog per destructive act, owned by the layer that
   * knows what it is about to do.
   */
  const runPackage = useCallback((id: string, row: DmsRow): boolean => {
    if (!isPackage(row)) return false;
    if (id === 'package:edit') {
      open({ kind: 'package', id: row.id, form: packFormOf(row) });
      return true;
    }
    if (id === 'package:add') {
      open({ kind: 'member', packageId: row.id, documentId: null, text: '' });
      return true;
    }
    if (id === 'package:seal') { void actions.sealPackage(row.id, row.name); return true; }
    if (id === 'package:verify') {
      open({ kind: 'verify', id: row.id, title: row.name, report: null, loading: true });
      void actions.verifyPackage(row.id).then((report) => setVerify(row.id, report));
      return true;
    }
    if (id === 'package:void') {
      open({ kind: 'void', id: row.id, title: row.name, text: '' });
      return true;
    }
    if (id === 'package:delete') { void actions.deletePackage(row.id, row.name); return true; }
    return false;
  }, [actions, open, setVerify]);

  const detail = useDmsDetailVerbs(actions, open);

  const perform = useCallback((id: string, row: DmsRow | null): void => {
    if (runView(id)) return;
    if (runGlobal(id)) return;
    if (row === null) return;
    if (runReview(id, row)) return;
    if (runDocument(id, row)) return;
    runPackage(id, row);
  }, [runDocument, runGlobal, runPackage, runReview, runView]);

  const command = useCallback((id: string): void => perform(id, selectedRow),
    [perform, selectedRow]);

  /**
   * Keyboard first, but never over a dialog.
   *
   * A dialog owns the keyboard while it is open: F5 behind a half-filled upload form would
   * refetch under it, and Ctrl+E would export the list nobody is looking at. `preventDefault`
   * comes before the verb because Ctrl+U, Ctrl+F and Ctrl+E are the browser's shortcuts first
   * and the app's second.
   */
  const keyDown = useCallback((event: KeyboardEvent<HTMLElement>): void => {
    if (dialog !== null) return;
    const id = hotkey(event, view);
    if (id === null) return;
    event.preventDefault();
    command(id);
  }, [command, dialog, view]);

  return {
    perform,
    command,
    keyDown,
    previewVersion,
    ...detail,
  };
}

/* ------------------------------------------------------------------ *
 * The surface
 * ------------------------------------------------------------------ */

/**
 * One flat object for `App.tsx`, the chrome, the four grids, the detail pane and the fourteen
 * dialogs — the same shape CRM and Close hand their own components.
 *
 * Flat rather than five nested hooks, because a control that needs the active view, the busy
 * verb and one commit should not have to know which seam each came from. The hooks are the
 * seam; this is the contract, and it is the only thing the `.tsx` files are allowed to hold.
 *
 * `actions` is here whole and `command` is here beside it, which looks like two ways to do one
 * thing and is not. Anything a menu, a hotkey or a toolbar button can name goes through
 * `command` so that `runReview`'s transition gate cannot be walked around: `shell.command('approve')`
 * consults `DMS_REVIEW_TRANSITIONS`, and a hypothetical `shell.actions.approve(id)` would not.
 * The verbs reached through `actions` are the ones that genuinely cannot be a string — they
 * carry an edge id or a direction (`unlink(linkId)`, `unrelate(relationId)`,
 * `setMember(packageId, documentId, false)`, `noteAccess(...)`) — so writing `shell.actions.…`
 * at a call site reads as the deliberate bypass it is rather than as a shortcut.
 *
 * Data members are `readonly`, function members are not, matching the sibling apps. The twelve
 * commits are typed `() => void` here although they return `Promise<void>`: a promise-returning
 * function is assignable to a void-returning one, and every caller is a DOM handler that must
 * not be handed a floating promise to think about.
 */
export interface DmsShell {
  readonly model: DmsModel;
  /** Every verb, for the four calls that carry an edge id instead of a name. See above. */
  readonly actions: DmsActions;
  readonly view: DmsView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: DmsBusy;
  readonly selectedId: string | null;
  /** The selected row itself, resolved against every row of the tab rather than the visible ones. */
  readonly selectedRow: DmsRow | null;
  readonly menu: DmsAnchor | null;
  readonly dialog: DmsDialog | null;
  /** How far back the extraction report looks, and how far forward the expiry report does. */
  readonly windowDays: number;
  readonly horizonDays: number;
  /** Rows the active grid is showing, and how many the tab holds, for the status bar. */
  readonly shown: number;
  readonly total: number;
  setSearch: (text: string) => void;
  pickRow: (id: string | null) => void;
  changeView: (next: DmsView) => void;
  setWindowDays: (days: number) => void;
  setHorizonDays: (days: number) => void;
  /** One path in for the toolbar, the menu bar, the accelerators and the kernel's commands. */
  command: (id: string) => void;
  /** The same path, on the row a context menu names rather than the one selected. */
  perform: (id: string, row: DmsRow | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  openMenu: (event: MouseEvent<Element>, row: DmsRow) => void;
  closeMenu: () => void;
  closeDialog: () => void;
  setUpload: (patch: Partial<UploadForm>) => void;
  setMeta: (patch: Partial<MetaForm>) => void;
  setLink: (patch: Partial<LinkForm>) => void;
  setRelate: (patch: Partial<RelateForm>) => void;
  setPack: (patch: Partial<PackForm>) => void;
  /** The one string seven of the fourteen dialogs collect. */
  setText: (text: string) => void;
  setMemberEnd: (patch: MemberEnd) => void;
  commitUpload: () => void;
  commitMetadata: () => void;
  commitTags: () => void;
  commitReject: () => void;
  commitChanges: () => void;
  commitLink: () => void;
  commitRelate: () => void;
  commitPackage: () => void;
  commitMember: () => void;
  commitVoid: () => void;
  commitCorrect: () => void;
  commitFailJob: () => void;
  /** The five verbs the detail pane owns. No accelerator reaches them. */
  judgeField: (field: DmsField) => (action: FieldReviewAction) => void;
  failJob: (job: DmsJob) => void;
  previewVersion: (documentId: string, title: string, version: DmsVersion) => void;
  openEntity: (link: DmsLink) => void;
  canOpenEntity: (link: DmsLink) => boolean;
}

/**
 * The whole window, assembled once.
 *
 * Order matters and is not alphabetical: `actions` before `ui` because nothing else can run
 * without the syscalls, `dialogs` before `commits` because a commit reads the open member,
 * and `model` after `ui` because the reads are parameterized by what the chrome is currently
 * asking for — the search box narrows in the app, but the two ranges are `where` clauses and
 * a widened horizon is a second round trip rather than a client-side filter.
 *
 * `useDmsCommandPath` comes last because it is the only seam that needs all four others, and
 * `selectedRow` is resolved before it so the command path receives a row rather than an id.
 */
export function useDmsShell(): DmsShell {
  const { tr } = useLocale();
  // Resolved once at mount. It names the exported file and nothing else, and a window left
  // open across midnight naming two files from one grid differently is not worth a clock.
  const today = useMemo(isoToday, []);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useDmsActions();
  const ui = useDmsUi();
  const dialogs = useDmsDialogs();
  const commits = useDmsCommits(dialogs.dialog, dialogs.close, actions);
  const model = useDmsModel({
    query: ui.search,
    selectedId: ui.selectedId,
    windowDays: ui.windowDays,
    horizonDays: ui.horizonDays,
  });

  const selectedRow = findRow(model, ui.view, ui.selectedId);
  const commands = useDmsCommandPath({
    ui,
    model,
    dialogs,
    actions,
    selectedRow,
    today,
    tr,
    searchRef,
  });
  const counts = tally(model, ui.view);

  // Three seams pass their own names straight out. The dialog hook is spelled out instead:
  // `close` on the window's own surface would read as closing the window, and `open`,
  // `setPreview` and `setVerify` belong to the command path rather than to a component.
  return {
    ...ui,
    ...commits,
    ...commands,
    model,
    actions,
    searchRef,
    busy: actions.busy,
    selectedRow,
    shown: counts.shown,
    total: counts.total,
    dialog: dialogs.dialog,
    closeDialog: dialogs.close,
    setUpload: dialogs.setUpload,
    setMeta: dialogs.setMeta,
    setLink: dialogs.setLink,
    setRelate: dialogs.setRelate,
    setPack: dialogs.setPack,
    setText: dialogs.setText,
    setMemberEnd: dialogs.setMemberEnd,
  };
}
