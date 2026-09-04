/**
 * Customers — what a press means.
 *
 * `App.tsx` decides what the window looks like; this decides what happens when something
 * in it is pressed. `model.ts` reads, `actions.ts` writes, and this file is the only place
 * that knows which row is selected, which dialog is open, and which of the verbs a given
 * surface is allowed to offer.
 *
 * Four hooks rather than one, for the reason `close` has four: the command path alone is a
 * third of the file, and folded into `useCrmShell` it would push the wiring at the bottom —
 * which is what somebody opens this file to read — two hundred lines out of sight.
 *
 * The selection is per surface rather than global. Seven grids of unrelated nouns share one
 * toolbar, and coming back to the quotes tab to find it describing a campaign is worse than
 * coming back to find nothing selected at all.
 *
 * Every dialog is one member of one union, which is safe because `Dialog` unmounts its
 * children when it closes: a draft held in state cannot flicker on the way out, so there is
 * nothing to gain by keeping eight drafts alive to preserve eight animations that do not
 * exist. A refused commit keeps its dialog and its text — the server's message says what
 * was wrong, and retyping it is not part of the answer.
 */
import {
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocale } from '@/platform/sdk';
import {
  type CrmActions,
  type CrmBusy,
  type CrmTarget,
  hotkey,
  useCrmActions,
  useCrmFocus,
} from './actions';
import { type Translate, crmCsv, gridClipboardText, recordClipboardText } from './export';
import {
  type CrmEntity,
  type RecordDraft,
  canEdit,
  emptyRecord,
  patchRecord,
  recordFrom,
} from './form';
import {
  type AcceptDraft,
  type ConvertDraft,
  type StageDraft,
  asStage,
  emptyAccept,
  emptyConvert,
  emptyStage,
  stageChoices,
} from './lifecycle';
import {
  type Activity,
  type Campaign,
  type CrmModel,
  type CrmView,
  type CrmVisible,
  type Customer,
  type Followup,
  type Lead,
  type Opportunity,
  type Quote,
  type QuoteLine,
  type SourceRow,
  useCrmModel,
} from './model';

/* ------------------------------------------------------------------ *
 * The seven kinds of row
 * ------------------------------------------------------------------ */

/**
 * Anything a grid can hand back. Seven members and no discriminant: the projections are
 * shaped by what the columns hold, and adding a tag to each of them so that this file
 * could switch on it would put a field in the database's way for the sake of one caller.
 */
export type CrmRow = Lead | Customer | Opportunity | Quote | Activity | Followup | Campaign;

/**
 * The five guards the verbs need, each testing the one key its subject alone carries.
 *
 * The obvious keys are all shared — `code` is on a customer and a campaign, `title` on a
 * deal and a follow-up, `name` on three of the seven — and a guard built from those would
 * send a campaign into the convert dialog. `score`, `wilaya`, `reference`, `number` and
 * `dueAt` each appear in exactly one interface.
 */
const isLead = (row: CrmRow): row is Lead => 'score' in row;
const isCustomer = (row: CrmRow): row is Customer => 'wilaya' in row;
const isOpportunity = (row: CrmRow): row is Opportunity => 'reference' in row;
const isQuote = (row: CrmRow): row is Quote => 'number' in row;
const isFollowup = (row: CrmRow): row is Followup => 'dueAt' in row;

/**
 * The row as its own database columns, or null when there are none to edit from.
 *
 * Six of the seven projections carry the source row they were built from, because
 * `recordFrom` indexes by column name while every projected field is camelCase. An
 * activity does not: there is no update command to route a save to, so nothing prefills.
 */
const sourceOf = (row: CrmRow): SourceRow | null => ('row' in row ? row.row : null);

/**
 * What to call the row in a prompt, a toast, a notification or a menu header.
 *
 * Ordered by specificity rather than by surface, because the same function names the row a
 * delete is about and the sale an announcement is about. A quote is its number, a deal and
 * a follow-up their title, an activity its subject, and the other three their name. It is
 * exported so a menu header and the confirmation its acts raise cannot disagree.
 */
export function labelOf(row: CrmRow): string {
  if (isQuote(row)) return row.number;
  if (isOpportunity(row)) return row.title;
  if (isFollowup(row)) return row.title;
  if ('subject' in row) return row.subject;
  return row.name;
}

/* ------------------------------------------------------------------ *
 * The seven surfaces
 * ------------------------------------------------------------------ */

/** Which noun each surface creates, edits and deletes. */
const VIEW_ENTITY: Readonly<Record<CrmView, CrmEntity>> = {
  leads: 'lead',
  customers: 'customer',
  pipeline: 'opportunity',
  quotes: 'quote',
  activities: 'activity',
  followups: 'followup',
  campaigns: 'campaign',
};

/**
 * Which array of the model each surface renders. Six of the seven names match their view;
 * `pipeline` is the one asymmetry, because the tab is named after the board people read
 * and the rows on it are opportunities.
 */
const VIEW_ROWS: Readonly<Record<CrmView, keyof CrmVisible>> = {
  leads: 'leads',
  customers: 'customers',
  pipeline: 'opportunities',
  quotes: 'quotes',
  activities: 'activities',
  followups: 'followups',
  campaigns: 'campaigns',
};

/**
 * The seven navigation commands. The value type admits `undefined` deliberately: the key
 * is any command id the palette or an accelerator can produce, and most of them are verbs
 * rather than surfaces, so a miss has to be a legal answer rather than a lie.
 */
const VIEW_COMMAND: Readonly<Record<string, CrmView | undefined>> = {
  'view:leads': 'leads',
  'view:customers': 'customers',
  'view:pipeline': 'pipeline',
  'view:quotes': 'quotes',
  'view:activities': 'activities',
  'view:followups': 'followups',
  'view:campaigns': 'campaigns',
};

/** Nothing selected anywhere. The seven keys exist from the first render, so a read of
 *  the current surface's selection never has to cope with a missing entry. */
const EMPTY_SELECTION: Readonly<Record<CrmView, string | null>> = {
  leads: null,
  customers: null,
  pipeline: null,
  quotes: null,
  activities: null,
  followups: null,
  campaigns: null,
};

/** One prefilled link: a column name and the id it should carry, if there is one. */
type SeedPair = readonly [string, string | null];

/**
 * A seed for a new record, dropping the pairs that have nothing to say.
 *
 * `emptyRecord` writes `seed[key] ?? ''`, so a null carried through as the string `"null"`
 * would prefill a lookup with a value no row has. Leaving the pair out leaves the field
 * empty, which is what an absent link means.
 */
function seeded(pairs: readonly SeedPair[]): Readonly<Record<string, string>> {
  const seed: Record<string, string> = {};
  for (const [column, value] of pairs) {
    if (value !== null && value !== '') seed[column] = value;
  }
  return seed;
}

/**
 * The links a new activity or follow-up should arrive carrying, read off whichever row was
 * selected when the verb was pressed.
 *
 * Both tables hold a CHECK that at least one target is set, so a log opened from the quotes
 * grid has to arrive knowing the quote — and, because a quote knows its customer, the
 * customer with it. The keys are database column names: `emptyRecord` seeds by column,
 * while every field on the projections is camelCase.
 */
function targetSeed(row: CrmRow | null): Readonly<Record<string, string>> {
  if (row === null) return {};
  if (isLead(row)) return seeded([['lead_id', row.id]]);
  if (isCustomer(row)) return seeded([['customer_id', row.id]]);
  if (isOpportunity(row)) {
    return seeded([
      ['opportunity_id', row.id],
      ['customer_id', row.customerId],
    ]);
  }
  if (isQuote(row)) {
    return seeded([
      ['quote_id', row.id],
      ['customer_id', row.customerId],
    ]);
  }
  if (isFollowup(row)) {
    return seeded([
      ['customer_id', row.customerId],
      ['lead_id', row.leadId],
      ['opportunity_id', row.opportunityId],
    ]);
  }
  // An activity and a campaign are not targets: neither table has a column for one.
  return {};
}

/**
 * The selected row of a surface, or null.
 *
 * Reads `all` rather than `visible`, so typing in the search box does not empty the
 * inspector and grey the toolbar out from under the row somebody is reading. The grid
 * loses the row; the description of it stays.
 */
function findRow(all: CrmVisible, view: CrmView, id: string | null): CrmRow | null {
  if (id === null) return null;
  const rows: readonly CrmRow[] = all[VIEW_ROWS[view]];
  return rows.find((row) => row.id === id) ?? null;
}

/** Where a context menu was raised, and on what. */
export interface CrmAnchor {
  readonly x: number;
  readonly y: number;
  readonly row: CrmRow;
}

/* ------------------------------------------------------------------ *
 * The eight dialogs
 * ------------------------------------------------------------------ */

/**
 * Whatever stands in front of the grid, or null when nothing does.
 *
 * `record` covers all eight entity editors at once: a `RecordDraft` already carries which
 * noun it is about and whether it is a create or an update, so a second discriminant here
 * would only repeat it. The other seven each hold exactly the fields their form collects.
 */
export type CrmDialog =
  | { readonly kind: 'record'; readonly draft: RecordDraft }
  | { readonly kind: 'convert'; readonly draft: ConvertDraft }
  | { readonly kind: 'tags'; readonly customerId: string; readonly text: string }
  | { readonly kind: 'stage'; readonly draft: StageDraft }
  | { readonly kind: 'send'; readonly quoteId: string; readonly validDays: string }
  | {
      readonly kind: 'accept';
      readonly draft: AcceptDraft;
      /** The quote's number and customer — what the confirmed-booking notice announces. */
      readonly label: string;
      /** Both carried so the capacity advisory needs no second lookup while typing. */
      readonly travelers: number;
      readonly seatsLeft: number | null;
    }
  | { readonly kind: 'decline'; readonly quoteId: string; readonly reason: string }
  | { readonly kind: 'complete'; readonly followupId: string; readonly note: string };

/**
 * Five setters for eight forms.
 *
 * The three draft-carrying dialogs take a patch of their own draft; the four whose whole
 * body is a single string share `setText`, because a dialog with one box does not need to
 * name the box. `editField` is the record editors', keyed by database column.
 */
export interface CrmDialogs {
  readonly dialog: CrmDialog | null;
  readonly open: (dialog: CrmDialog) => void;
  readonly close: () => void;
  readonly editField: (key: string, text: string) => void;
  readonly setConvert: (patch: Partial<ConvertDraft>) => void;
  readonly setStage: (patch: Partial<StageDraft>) => void;
  readonly setAccept: (patch: Partial<AcceptDraft>) => void;
  readonly setText: (text: string) => void;
}

/**
 * The one piece of dialog state.
 *
 * Every setter checks the member it belongs to and returns the state untouched otherwise,
 * so a late input event from a form that has just closed cannot land in the one that
 * opened next.
 */
export function useCrmDialogs(): CrmDialogs {
  const [dialog, setDialog] = useState<CrmDialog | null>(null);

  const open = useCallback((next: CrmDialog): void => setDialog(next), []);
  const close = useCallback((): void => setDialog(null), []);

  const editField = useCallback((key: string, text: string): void => {
    setDialog((current) =>
      current?.kind === 'record'
        ? { kind: 'record', draft: patchRecord(current.draft, key, text) }
        : current,
    );
  }, []);

  const setConvert = useCallback((patch: Partial<ConvertDraft>): void => {
    setDialog((current) =>
      current?.kind === 'convert' ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );
  }, []);

  const setStage = useCallback((patch: Partial<StageDraft>): void => {
    setDialog((current) =>
      current?.kind === 'stage' ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );
  }, []);

  // Spread over the whole member rather than the draft alone: `label`, `travelers` and
  // `seatsLeft` were resolved when the dialog opened, and a keystroke does not re-derive
  // them.
  const setAccept = useCallback((patch: Partial<AcceptDraft>): void => {
    setDialog((current) =>
      current?.kind === 'accept' ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );
  }, []);

  const setText = useCallback((text: string): void => {
    setDialog((current) => {
      if (current === null) return current;
      if (current.kind === 'tags') return { ...current, text };
      if (current.kind === 'send') return { ...current, validDays: text };
      if (current.kind === 'decline') return { ...current, reason: text };
      if (current.kind === 'complete') return { ...current, note: text };
      return current;
    });
  }, []);

  return { dialog, open, close, editField, setConvert, setStage, setAccept, setText };
}

/* ------------------------------------------------------------------ *
 * Where you are, and what is under the pointer
 * ------------------------------------------------------------------ */

export interface CrmUi {
  readonly view: CrmView;
  readonly search: string;
  /** The selected row of the surface you are on. The other six keep theirs. */
  readonly selectedId: string | null;
  readonly menu: CrmAnchor | null;
  readonly changeView: (view: CrmView) => void;
  readonly setSearch: (text: string) => void;
  readonly pickRow: (id: string | null) => void;
  /**
   * `Element`, not `HTMLElement`. The event is raised by the SDK grid, whose
   * `onRowContextMenu` hands out a `MouseEvent<Element>`, and this reads nothing off it but
   * `preventDefault` and the two client coordinates. Asking for the narrower element would
   * not make the handler safer — it would make it unassignable to the slot that feeds it.
   */
  readonly openMenu: (event: MouseEvent<Element>, row: CrmRow) => void;
  readonly closeMenu: () => void;
}

/**
 * The view, the search box and the seven selections.
 *
 * Changing surface clears the search, because the seven searches mean different things: a
 * wilaya typed against the customers grid matches nothing at all in campaigns, and being
 * shown an empty grid you did not filter is worse than being shown all of it.
 */
export function useCrmUi(): CrmUi {
  const [view, setView] = useState<CrmView>('leads');
  const [search, setSearch] = useState('');
  const [selection, setSelection] =
    useState<Readonly<Record<CrmView, string | null>>>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<CrmAnchor | null>(null);

  const changeView = useCallback((next: CrmView): void => {
    setView(next);
    setSearch('');
    setMenu(null);
  }, []);

  const pickRow = useCallback(
    (id: string | null): void => setSelection((current) => ({ ...current, [view]: id })),
    [view],
  );

  // The selection moves before the menu opens: a right-click that anchored a menu without
  // moving it would leave the toolbar describing one row and the menu another.
  const openMenu = useCallback(
    (event: MouseEvent<Element>, row: CrmRow): void => {
      event.preventDefault();
      setSelection((current) => ({ ...current, [view]: row.id }));
      setMenu({ x: event.clientX, y: event.clientY, row });
    },
    [view],
  );

  const closeMenu = useCallback((): void => setMenu(null), []);

  // A launch or an activation that names a record. The search clears with it: an inbound
  // link that landed on a row hidden by whatever was typed an hour ago would look broken.
  const focus = useCallback((target: CrmTarget): void => {
    setView(target.view);
    setSearch('');
    setMenu(null);
    setSelection((current) => ({ ...current, [target.view]: target.id }));
  }, []);
  useCrmFocus(focus);

  return {
    view,
    search,
    selectedId: selection[view],
    menu,
    changeView,
    setSearch,
    pickRow,
    openMenu,
    closeMenu,
  };
}

/* ------------------------------------------------------------------ *
 * Committing what a dialog collected
 * ------------------------------------------------------------------ */

export interface CrmCommits {
  readonly saveRecord: () => void;
  readonly commitConvert: () => void;
  readonly commitTags: () => void;
  readonly commitStage: () => void;
  readonly commitSend: () => void;
  readonly commitAccept: () => void;
  readonly commitDecline: () => void;
  readonly commitComplete: () => void;
}

/**
 * Eight commits of one shape: check the member, run the act, close only if it took.
 *
 * A refusal keeps the dialog and everything typed into it. The command already raised a
 * toast carrying what the server objected to, and retyping six fields is not part of the
 * answer to it.
 */
export function useCrmCommits(actions: CrmActions, dialogs: CrmDialogs): CrmCommits {
  const { dialog, close } = dialogs;

  const done = useCallback(
    (ok: boolean): void => {
      if (ok) close();
    },
    [close],
  );

  const saveRecord = useCallback((): void => {
    if (dialog?.kind !== 'record') return;
    void actions.save(dialog.draft).then(done);
  }, [actions, dialog, done]);

  const commitConvert = useCallback((): void => {
    if (dialog?.kind !== 'convert') return;
    void actions.convert(dialog.draft).then(done);
  }, [actions, dialog, done]);

  const commitTags = useCallback((): void => {
    if (dialog?.kind !== 'tags') return;
    void actions.retag(dialog.customerId, dialog.text).then(done);
  }, [actions, dialog, done]);

  const commitStage = useCallback((): void => {
    if (dialog?.kind !== 'stage') return;
    void actions.moveStage(dialog.draft).then(done);
  }, [actions, dialog, done]);

  const commitSend = useCallback((): void => {
    if (dialog?.kind !== 'send') return;
    void actions.send(dialog.quoteId, dialog.validDays).then(done);
  }, [actions, dialog, done]);

  // The label goes with it: the notification is raised after the transaction returns, and
  // by then the dialog that knew which quote this was is gone.
  const commitAccept = useCallback((): void => {
    if (dialog?.kind !== 'accept') return;
    void actions.accept(dialog.draft, dialog.label).then(done);
  }, [actions, dialog, done]);

  const commitDecline = useCallback((): void => {
    if (dialog?.kind !== 'decline') return;
    void actions.decline(dialog.quoteId, dialog.reason).then(done);
  }, [actions, dialog, done]);

  const commitComplete = useCallback((): void => {
    if (dialog?.kind !== 'complete') return;
    void actions.complete(dialog.followupId, dialog.note).then(done);
  }, [actions, dialog, done]);

  return {
    saveRecord,
    commitConvert,
    commitTags,
    commitStage,
    commitSend,
    commitAccept,
    commitDecline,
    commitComplete,
  };
}

/* ------------------------------------------------------------------ *
 * What the window is handed
 * ------------------------------------------------------------------ */

/**
 * One flat surface for `App.tsx`, the toolbar, the grids, the inspector and the eight
 * dialogs — the same shape `close` hands its own chrome.
 *
 * Flat rather than three nested objects, because a control that needs the view, the busy
 * act and one commit should not have to know which of the four hooks each came from. The
 * hooks are the seam; this is the surface.
 */
export interface CrmShell {
  readonly model: CrmModel;
  readonly view: CrmView;
  readonly search: string;
  readonly searchRef: Ref<HTMLInputElement>;
  readonly busy: CrmBusy;
  readonly selectedId: string | null;
  /** The selected row itself, resolved against every row rather than the visible ones. */
  readonly selectedRow: CrmRow | null;
  readonly menu: CrmAnchor | null;
  readonly dialog: CrmDialog | null;
  /** Rows the active grid is showing, and how many there are in all, for the status bar. */
  readonly shown: number;
  readonly total: number;
  setSearch: (text: string) => void;
  pickRow: (id: string | null) => void;
  changeView: (view: CrmView) => void;
  /** One path in for the toolbar, the accelerators, the jump list and the palette. */
  command: (id: string) => void;
  /** The same path, on the row a menu names rather than the one selected. */
  perform: (id: string, row: CrmRow | null) => void;
  keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  openMenu: (event: MouseEvent<Element>, row: CrmRow) => void;
  closeMenu: () => void;
  closeDialog: () => void;
  editField: (key: string, text: string) => void;
  setConvert: (patch: Partial<ConvertDraft>) => void;
  setStage: (patch: Partial<StageDraft>) => void;
  setAccept: (patch: Partial<AcceptDraft>) => void;
  setText: (text: string) => void;
  saveRecord: () => void;
  commitConvert: () => void;
  commitTags: () => void;
  commitStage: () => void;
  commitSend: () => void;
  commitAccept: () => void;
  commitDecline: () => void;
  commitComplete: () => void;
  /** The three verbs the quote inspector owns. No accelerator reaches them. */
  addLine: (quote: Quote) => void;
  editLine: (line: QuoteLine) => void;
  removeLine: (line: QuoteLine) => void;
}

/* ------------------------------------------------------------------ *
 * The command path
 * ------------------------------------------------------------------ */

/**
 * What a command needs to run.
 *
 * `searchRef` is declared as the read side of a ref rather than as `Ref<HTMLInputElement>`,
 * because this layer only ever focuses the box; the box is what owns it.
 */
interface CommandDeps {
  readonly view: CrmView;
  readonly model: CrmModel;
  readonly selectedRow: CrmRow | null;
  readonly actions: CrmActions;
  readonly dialogs: CrmDialogs;
  /** Resolved once at mount. It names the exported file and does nothing else. */
  readonly today: string;
  readonly tr: Translate;
  readonly searchRef: { readonly current: HTMLInputElement | null };
  readonly changeView: (view: CrmView) => void;
}

/** The one way in, and the three the quote inspector needs beside it. */
interface CrmCommands {
  readonly perform: (id: string, row: CrmRow | null) => void;
  readonly command: (id: string) => void;
  readonly keyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly addLine: (quote: Quote) => void;
  readonly editLine: (line: QuoteLine) => void;
  readonly removeLine: (line: QuoteLine) => void;
}

/**
 * Twenty-three verbs in four tiers, which is the honest shape of them: seven only move
 * you between surfaces, seven work on the grid you are looking at, three work on whatever
 * record the surface is made of, and six need a row of a particular kind underneath.
 *
 * Four cooperating callbacks rather than one switch. A flat version measures near
 * complexity 29 against a ceiling of 20, and the tiers are also where the honest
 * differences are — a `view:` id needs nothing, `delete` needs a row, `accept` needs a
 * sent quote.
 */
function useCrmCommandPath(deps: CommandDeps): CrmCommands {
  const { view, model, selectedRow, actions, dialogs, today, tr, searchRef, changeView } = deps;
  const { dialog, open } = dialogs;

  /** The seven `view:*` ids, which are the jump list and a third of the palette. */
  const runView = useCallback(
    (id: string): boolean => {
      const next = VIEW_COMMAND[id];
      if (next === undefined) return false;
      changeView(next);
      return true;
    },
    [changeView],
  );

  /**
   * The verbs that need no row. `log` and `followup` sit here rather than a tier down
   * because a row only seeds them: both are legal from an empty grid, and both then open
   * with the target unset for somebody to choose.
   */
  const runGlobal = useCallback(
    (id: string, row: CrmRow | null): boolean => {
      if (id === 'refresh') {
        model.refresh();
        return true;
      }
      if (id === 'find') {
        searchRef.current?.focus();
        return true;
      }
      if (id === 'export') {
        actions.exportCsv(view, crmCsv(view, model.visible, model, tr), today);
        return true;
      }
      if (id === 'copy') {
        actions.copy(gridClipboardText(view, model.visible, model, tr));
        return true;
      }
      if (id === 'new') {
        open({ kind: 'record', draft: emptyRecord(VIEW_ENTITY[view]) });
        return true;
      }
      if (id === 'log' || id === 'followup') {
        const entity: CrmEntity = id === 'log' ? 'activity' : 'followup';
        open({ kind: 'record', draft: emptyRecord(entity, targetSeed(row)) });
        return true;
      }
      return false;
    },
    [actions, model, open, searchRef, today, tr, view],
  );

  /**
   * The three that read the surface rather than the row: whatever grid you are on, this is
   * the record you are editing, deleting or copying. `edit` needs both a source row to
   * read the database's own column names out of and an update command to route to, and the
   * activity log has neither — nothing opens, and the log stays what it is.
   */
  const runRecord = useCallback(
    (id: string, row: CrmRow): boolean => {
      const entity = VIEW_ENTITY[view];
      if (id === 'edit') {
        const source = sourceOf(row);
        if (source !== null && canEdit(entity)) {
          open({ kind: 'record', draft: recordFrom(entity, source) });
        }
        return true;
      }
      if (id === 'delete') {
        void actions.remove(entity, row.id, labelOf(row));
        return true;
      }
      if (id !== 'copyRow') return false;
      actions.copy(recordClipboardText(view, model.visible, model, tr, row.id));
      return true;
    },
    [actions, model, open, tr, view],
  );

  /**
   * The six that need a row of a particular kind. A verb that does not match the row falls
   * through and nothing happens: the toolbar disables what it can, and a menu offering
   * `convert` on a campaign would be a bug in the menu rather than something to report from
   * here.
   */
  const runRow = useCallback(
    (id: string, row: CrmRow): void => {
      // The quote's three, nested so the guard is written once rather than three times.
      const runQuote = (quote: Quote): boolean => {
        if (id === 'send') {
          // Blank, not fourteen: `sendPayload` drops the field when it is empty and the RPC
          // applies the agency's own default.
          open({ kind: 'send', quoteId: quote.id, validDays: '' });
          return true;
        }
        if (id === 'decline') {
          open({ kind: 'decline', quoteId: quote.id, reason: '' });
          return true;
        }
        // Only a sent quote can be accepted. A draft has not been offered to anybody yet,
        // and one already accepted or declined has an answer.
        if (id !== 'accept' || quote.status !== 'sent') return false;
        const pack = quote.packageId === null ? undefined : model.packageById.get(quote.packageId);
        const customer =
          quote.customerId === null ? undefined : model.customerById.get(quote.customerId);
        open({
          kind: 'accept',
          draft: emptyAccept(quote.id, quote.currency, quote.total),
          label: customer === undefined ? quote.number : `${quote.number} — ${customer.name}`,
          travelers: quote.travelers,
          seatsLeft: pack?.seats ?? null,
        });
        return true;
      };

      if (isQuote(row) && runQuote(row)) return;
      if (id === 'convert' && isLead(row)) {
        open({ kind: 'convert', draft: emptyConvert(row.id, row.name) });
        return;
      }
      if (id === 'stage' && isOpportunity(row)) {
        const from = asStage(row.stage);
        // Won and lost have nowhere to go. Nothing opens, rather than a dialog offering an
        // empty list of stages.
        if (from !== null && stageChoices(from).length > 0) {
          open({ kind: 'stage', draft: emptyStage(row.id, from) });
        }
        return;
      }
      if (id === 'complete' && isFollowup(row)) {
        open({ kind: 'complete', followupId: row.id, note: '' });
        return;
      }
      // The whole list, comma-joined: the box replaces the array rather than adding to it,
      // so what is in it has to be what is on the customer.
      if (id === 'tags' && isCustomer(row)) {
        open({ kind: 'tags', customerId: row.id, text: row.tags.join(', ') });
      }
    },
    [model, open],
  );

  /**
   * The one entry, tiers in order. A row verb that arrives with nothing under the pointer
   * stops at the third line rather than at six separate guards below it.
   */
  const perform = useCallback(
    (id: string, row: CrmRow | null): void => {
      if (runView(id)) return;
      if (runGlobal(id, row)) return;
      if (row === null) return;
      if (runRecord(id, row)) return;
      runRow(id, row);
    },
    [runGlobal, runRecord, runRow, runView],
  );

  /** The toolbar, the palette and the jump list, all of which mean the selected row. */
  const command = useCallback(
    (id: string): void => perform(id, selectedRow),
    [perform, selectedRow],
  );

  /**
   * The nine accelerators. `preventDefault` runs before the dispatch because Ctrl+N, Ctrl+F
   * and Ctrl+E are the browser's own verbs first, and a new window arriving over the top of
   * this one is not what was asked for.
   *
   * Nothing fires while a dialog is open. The dialogs sit inside the element this is bound
   * to, so Ctrl+F typed into a decline reason would otherwise pull focus to the search box
   * behind it.
   */
  const keyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (dialog !== null) return;
      const id = hotkey(event, view);
      if (id === null) return;
      event.preventDefault();
      command(id);
    },
    [command, dialog, view],
  );

  /**
   * The quote inspector's three. They are record editors reached with the quote in hand
   * rather than through the surface, because a quote line is the one child nothing navigates
   * to: there is no line grid, so `VIEW_ENTITY` has no name for it and the command path has
   * no row to key off.
   */
  const addLine = useCallback(
    (quote: Quote): void =>
      open({ kind: 'record', draft: emptyRecord('quoteLine', { quote_id: quote.id }) }),
    [open],
  );

  const editLine = useCallback(
    (line: QuoteLine): void => open({ kind: 'record', draft: recordFrom('quoteLine', line.row) }),
    [open],
  );

  const removeLine = useCallback(
    (line: QuoteLine): void => void actions.remove('quoteLine', line.id, line.description),
    [actions],
  );

  return { perform, command, keyDown, addLine, editLine, removeLine };
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/**
 * The four seams, wired once, in the only order that works: the model needs the surface,
 * the query and the selection before it knows what to fetch, and the command path needs
 * every one of the others.
 */
export function useCrmShell(): CrmShell {
  const { tr } = useLocale();
  // Resolved once at mount. It names the exported file and nothing else, and a window left
  // open across midnight naming two files from one grid differently is not worth a clock.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const actions = useCrmActions();
  const ui = useCrmUi();
  const dialogs = useCrmDialogs();
  const commits = useCrmCommits(actions, dialogs);
  const model = useCrmModel(ui.view, ui.search, ui.selectedId);

  // Resolved against every row rather than the visible ones: a selection made before
  // something was typed into the search box still names a real record, and the toolbar
  // should go on describing it rather than emptying itself as the letters arrive.
  const selectedRow = findRow(model.all, ui.view, ui.selectedId);
  const rows = VIEW_ROWS[ui.view];
  const commands = useCrmCommandPath({
    view: ui.view,
    model,
    selectedRow,
    actions,
    dialogs,
    today,
    tr,
    searchRef,
    changeView: ui.changeView,
  });

  // Three of the four seams pass their own names straight out. Only the dialog hook is
  // renamed: `close` on the window's own surface would read as closing the window.
  return {
    ...ui,
    ...commits,
    ...commands,
    model,
    searchRef,
    busy: actions.busy,
    selectedRow,
    shown: model.visible[rows].length,
    total: model.all[rows].length,
    dialog: dialogs.dialog,
    closeDialog: dialogs.close,
    editField: dialogs.editField,
    setConvert: dialogs.setConvert,
    setStage: dialogs.setStage,
    setAccept: dialogs.setAccept,
    setText: dialogs.setText,
  };
}
