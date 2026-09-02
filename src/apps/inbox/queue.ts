/**
 * Inbox — what is waiting, normalised.
 *
 * Four sources, one row shape. A draft journal entry, an uncertified close step, a
 * handoff another department has addressed to this one, and a decision already
 * recorded in the audit trail are not the same object, but they are the same *kind*
 * of thing to the person reading this window: something that needs a decision, or
 * the record of one. So each is mapped to a `WorkItem` and the grid, the search, the
 * ageing and the export are written once.
 *
 * The interesting work here is the pre-flight. Every act this app offers is an RPC
 * with its own refusals, and an inbox that lets you press Approve on something the
 * server will reject has taught you nothing except to distrust the button. So the
 * server's rules are mirrored, and where a rule bites the item carries the sentence
 * that says why instead of a disabled button with no explanation:
 *
 *   • `approve_journal_entry` accepts DRAFT only, and stamps an open fiscal period
 *     onto the entry — so an entry whose date falls in a closed period is blocked
 *     here rather than at the server.
 *   • The balance trigger fires on the update, so an entry whose two sides disagree
 *     is blocked too.
 *   • `complete_close_task` refuses to certify out of dependency order, naming the
 *     first uncertified dependency by task name. This file names the same one, in
 *     the same order, because it sorts the candidates the way the RPC's `ORDER BY`
 *     does.
 *   • The three handoff RPCs guard on status and nothing else: accept demands OPEN,
 *     complete and decline demand a live row. That rule is a total function of the
 *     status, so a waiting handoff always has exactly one act available and is never
 *     blocked — which is why the handoff mirror below is three predicates and no
 *     sentence. The one refusal it cannot mirror is `has_permission`, held by the
 *     server; that one surfaces as a failed command, not a disabled button.
 *
 * Nothing below formats or fetches. It is a function of the page the broker
 * returned and of `today`, which is passed in so the same page renders the same
 * ages in a test.
 */
import type { DatasetRow, Localized, Tone } from '@/platform/sdk';
import { csvDocument } from '../shared/csv';
import { asString, str } from '../shared/guards';
import {
  type CloseTask,
  type Currency,
  ENTRY_STATUS_LABEL,
  type EntryStatus,
  entryTone,
  EPSILON,
  type FiscalPeriod,
  isBalanced,
  type JournalEntry,
  type JournalLine,
  TASK_STATUS_LABEL,
  type TaskStatus,
  taskTone,
  withinPeriod,
} from '../shared/ledger';
import {
  canAcceptHandoff,
  canCompleteHandoff,
  canDeclineHandoff,
  HANDOFF_STATUS_LABEL,
  handoffTone,
  INTENT_LABEL,
  isHandoffLive,
  type SpineInboxItem,
  STAGE_LABEL,
} from '../shared/spine';

/** The broker's page ceiling, mirrored so the status bar can say when it bit. */
export const PAGE_LIMIT = 500;

/** Decisions kept in the archive. The Event Viewer is where the whole log lives. */
export const DECISION_LIMIT = 200;

/**
 * Live handoffs read per page.
 *
 * `private.spine_inbox` defaults to 200 and clamps to `least(p_limit, 1000)`, so
 * this is the RPC's own default restated rather than a number chosen here. It is
 * sent explicitly anyway: a limit that only exists as a server default is a limit
 * the status bar cannot honestly report as having bitten.
 */
export const HANDOFF_LIMIT = 200;

/** Lines loaded for the selected entry. A journal entry with more is pathological. */
export const LINE_LIMIT = 200;

/** Days before an item's age is worth colouring. */
export const AGE_WARNING = 3;
export const AGE_DANGER = 7;

/* ------------------------------------------------------------------ *
 * Decisions
 * ------------------------------------------------------------------ */

/**
 * The audit actions this app is the archive of.
 *
 * Pushed down to the broker as an `in`, which is why it is a module constant: the
 * dataset cache keys on the query's content, so a stable array is one round trip
 * rather than one per render.
 */
export const DECISION_ACTIONS: readonly string[] = ['POST', 'VOID', 'REVERSE', 'CLOSE_TASK_CERTIFY'];

export type DecisionKind = 'post' | 'void' | 'reverse' | 'certify';

export const DECISION_LABEL: Readonly<Record<DecisionKind, Localized>> = {
  post: { ar: 'اعتماد', fr: 'Approbation', en: 'Approved' },
  void: { ar: 'إلغاء', fr: 'Annulation', en: 'Voided' },
  reverse: { ar: 'قيد معاكس', fr: 'Contre-passation', en: 'Reversed' },
  certify: { ar: 'تصديق', fr: 'Certification', en: 'Certified' },
};

export const decisionTone = (kind: DecisionKind): Tone =>
  kind === 'post' ? 'success' : kind === 'certify' ? 'accent' : kind === 'reverse' ? 'warning' : 'danger';

function decisionKind(action: string): DecisionKind | null {
  const text = action.trim().toUpperCase();
  if (text === 'POST') return 'post';
  if (text === 'VOID') return 'void';
  if (text === 'REVERSE') return 'reverse';
  if (text === 'CLOSE_TASK_CERTIFY') return 'certify';
  return null;
}

/**
 * One field out of an audit row's `details`.
 *
 * `details` is jsonb, so it arrives as `unknown`: an object, or a string, or null,
 * depending on what the trigger wrote. Reading it defensively is the difference
 * between a missing reason and a window that will not render.
 */
function detail(details: unknown, key: string): string {
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return '';
  return str((details as Readonly<Record<string, unknown>>)[key]);
}

export interface Decision {
  readonly id: string;
  readonly kind: DecisionKind;
  readonly resource: string;
  readonly resourceId: string | null;
  /** The e-mail the RPC recorded, which is the only name of the actor it keeps. */
  readonly actor: string;
  readonly at: string | null;
  /** `reference` for an entry, `task_name` for a checklist step. */
  readonly subject: string;
  readonly reason: string;
  readonly requestId: string | null;
}

/** Audit rows outside the four actions above are not decisions this app made. */
export function toDecision(row: DatasetRow): Decision | null {
  const id = asString(row.id);
  const kind = decisionKind(str(row.action));
  if (id === null || kind === null) return null;
  const subject = detail(row.details, 'reference');
  return {
    id,
    kind,
    resource: str(row.resource),
    resourceId: asString(row.resource_id),
    actor: str(row.user_email),
    at: asString(row.timestamp) ?? asString(row.created_at),
    subject: subject !== '' ? subject : detail(row.details, 'task_name'),
    reason: detail(row.details, 'reason'),
    requestId: asString(row.request_id),
  };
}

/* ------------------------------------------------------------------ *
 * Work items
 * ------------------------------------------------------------------ */

export type QueueId = 'approvals' | 'checklist' | 'handoffs' | 'decided';

export const QUEUES: readonly QueueId[] = ['approvals', 'checklist', 'handoffs', 'decided'];

export type ItemKind = 'entry' | 'task' | 'handoff' | 'decision';

/** `waiting` needs a decision, `blocked` cannot take one yet, `done` is history. */
export type ItemState = 'waiting' | 'blocked' | 'done';

export interface WorkItem {
  /** Unique across the four sources, because one grid shows all of them. */
  readonly key: string;
  readonly kind: ItemKind;
  readonly id: string;
  readonly queue: QueueId;
  readonly title: string;
  readonly subtitle: string;
  /**
   * The identity the row names, as the row spells it: an e-mail for a decision,
   * an auth uid for an entry's author or a task's owner. A uid is not a name, so
   * the grid prints it only when it has nothing better — which is what `mine` is
   * for. It is exact: `principal.sid` *is* `created_by`/`owner_id`, and
   * `principal.email` *is* `audit_logs.user_email`.
   *
   * A handoff is the one row that may name a *role* here rather than a person,
   * because that is what the database holds: `assigned_to` is null until someone
   * takes it, and until then the only answer to "whose is this" is `assigned_role`.
   * Roles are the seven uppercase words in `spine.ts`, so the two never blur.
   */
  readonly who: string;
  readonly mine: boolean;
  /** The date the age is measured from — entry date, last update, or decision. */
  readonly at: string;
  readonly amount: number | null;
  readonly currency: Currency;
  readonly state: ItemState;
  readonly badge: Localized;
  readonly tone: Tone;
  /** Whole days between `at` and today, floored at zero. */
  readonly age: number;
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly canCertify: boolean;
  /** Why the primary act is unavailable, in the reader's language. */
  readonly block: Localized | null;
  readonly entry: JournalEntry | null;
  readonly task: CloseTask | null;
  readonly handoff: SpineInboxItem | null;
  readonly decision: Decision | null;
}

const DAY_MS = 86_400_000;

/** Whole days between two ISO dates, floored at zero. Timestamps are truncated. */
export function ageInDays(at: string, today: string): number {
  if (at === '') return 0;
  const from = Date.parse(`${at.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

export const ageTone = (age: number, state: ItemState): Tone => {
  if (state !== 'waiting') return 'neutral';
  if (age >= AGE_DANGER) return 'danger';
  if (age >= AGE_WARNING) return 'warning';
  return 'neutral';
};

/* ------------------------------------------------------------------ *
 * The server's refusals, mirrored
 * ------------------------------------------------------------------ */

/**
 * Entry statuses the approvals queue is about, in the table's own casing.
 *
 * Pushed to the broker as an `in`, so it is a module constant for the same reason
 * `DECISION_ACTIONS` is: the dataset cache keys on the query's content.
 */
export const OPEN_ENTRY_STATUS: readonly string[] = ['DRAFT', 'PENDING'];

const entryState = (state: EntryStatus): ItemState => (state === 'draft' || state === 'pending' ? 'waiting' : 'done');

const taskState = (state: TaskStatus): ItemState => (state === 'certified' ? 'done' : 'waiting');

/** The period covering a date, or null when this page holds none that does. */
export function periodFor(periods: readonly FiscalPeriod[], date: string): FiscalPeriod | null {
  if (date === '') return null;
  return periods.find((period) => withinPeriod(period, date)) ?? null;
}

/**
 * Why `approve_journal_entry` would refuse this entry, or null if it would not.
 *
 * The three refusals in the order the RPC hits them: the status guard (DRAFT only,
 * anything else is P0002), `assert_open_fiscal_period` on the entry date, and the
 * balance trigger that fires on the update it makes.
 */
export function approveBlock(entry: JournalEntry, periods: readonly FiscalPeriod[]): Localized | null {
  if (entry.status === 'posted') {
    return { ar: 'مرحّل بالفعل.', fr: 'Déjà comptabilisée.', en: 'Already posted.' };
  }
  if (entry.status === 'void') {
    return { ar: 'ملغى، فلا يمكن اعتماده.', fr: 'Annulée : rien à approuver.', en: 'Voided — nothing to approve.' };
  }
  if (entry.status === 'pending') {
    return {
      ar: 'ينتظر خطوة سابقة: الاعتماد يقبل المسودات فقط.',
      fr: 'En attente d’une étape antérieure : l’approbation n’accepte que les brouillons.',
      en: 'Waiting on an earlier step — approval accepts drafts only.',
    };
  }
  const period = periodFor(periods, entry.date);
  if (period === null) {
    return {
      ar: 'لا فترة مالية تغطي تاريخ القيد.',
      fr: 'Aucune période fiscale ne couvre la date de l’écriture.',
      en: 'No fiscal period covers the entry date.',
    };
  }
  if (period.status === 'closed') {
    return {
      ar: `الفترة ${period.label} مقفلة.`,
      fr: `La période ${period.label} est clôturée.`,
      en: `The ${period.label} period is closed.`,
    };
  }
  if (!isBalanced(entry)) {
    return {
      ar: 'الطرفان غير متساويين.',
      fr: 'Les deux côtés ne s’équilibrent pas.',
      en: 'The two sides do not balance.',
    };
  }
  return null;
}

/** Dependency names, resolved. Only a name with a row can block, as at the server. */
export interface DependencyState {
  /** The first uncertified dependency by name — the one the RPC would name. */
  readonly blocker: CloseTask | null;
  /** Dependency names with no task on this page. These do not block anything. */
  readonly unknown: readonly string[];
}

/** Close tasks by name, because `dependencies` holds names rather than ids. */
export const taskIndex = (tasks: readonly CloseTask[]): ReadonlyMap<string, CloseTask> =>
  new Map(tasks.map((task) => [task.name, task]));

/**
 * What stands between a close task and its certification.
 *
 * `complete_close_task` looks for `task_name = ANY(dependencies)` with a status
 * other than certified, `ORDER BY task_name LIMIT 1`, and raises P0001 naming that
 * one. The names are sorted here for the same reason, so the sentence this window
 * shows is the sentence the server would have shown.
 */
export function dependencyState(task: CloseTask, index: ReadonlyMap<string, CloseTask>): DependencyState {
  const unknown: string[] = [];
  let blocker: CloseTask | null = null;
  for (const name of [...task.dependencies].sort((a, b) => a.localeCompare(b))) {
    const found = index.get(name);
    if (found === undefined) unknown.push(name);
    else if (found.status !== 'certified' && blocker === null) blocker = found;
  }
  return { blocker, unknown };
}

/** Why `complete_close_task` would refuse to certify, or null if it would not. */
export function certifyBlock(task: CloseTask, index: ReadonlyMap<string, CloseTask>): Localized | null {
  if (task.status === 'certified') {
    return { ar: 'مصدّقة بالفعل.', fr: 'Déjà certifiée.', en: 'Already certified.' };
  }
  const { blocker } = dependencyState(task, index);
  if (blocker === null) return null;
  return {
    ar: `تعتمد على «${blocker.name}» وهي غير مصدّقة.`,
    fr: `Dépend de « ${blocker.name} », qui n’est pas certifiée.`,
    en: `Depends on “${blocker.name}”, which is not certified.`,
  };
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

/** A uuid is not a title. When a row has no human name, the first block will do. */
const shortId = (id: string): string => id.slice(0, 8);

/** Who the caller is. Both fields are exact keys, not display names — see `WorkItem.who`. */
export interface Viewer {
  readonly sid: string;
  readonly email: string;
}

export interface ItemContext {
  readonly viewer: Viewer;
  readonly periods: readonly FiscalPeriod[];
  readonly tasks: ReadonlyMap<string, CloseTask>;
  /** The book's currency. `journal_entries` carries totals but no currency column. */
  readonly currency: Currency;
  readonly today: string;
}

export function entryItem(entry: JournalEntry, context: ItemContext): WorkItem {
  const block = approveBlock(entry, context.periods);
  const state = entryState(entry.status);
  const at = entry.date;
  return {
    key: `entry:${entry.id}`,
    kind: 'entry',
    id: entry.id,
    queue: 'approvals',
    title: entry.reference !== '' ? entry.reference : `#${shortId(entry.id)}`,
    subtitle: entry.description !== '' ? entry.description : entry.sourceType,
    who: entry.createdBy ?? '',
    mine: entry.createdBy !== null && entry.createdBy === context.viewer.sid,
    at,
    // The larger side, so an unbalanced entry still states a magnitude instead of
    // the zero one of its two columns might hold.
    amount: Math.max(entry.debit, entry.credit),
    currency: context.currency,
    state: state === 'waiting' && block !== null ? 'blocked' : state,
    badge: ENTRY_STATUS_LABEL[entry.status],
    tone: entryTone(entry.status),
    age: ageInDays(at, context.today),
    canApprove: state === 'waiting' && block === null,
    // Rejecting a draft is not period-gated: `void_journal_entry` only asserts an
    // open period for the reversal it writes when the entry was already posted.
    canReject: entry.status !== 'void',
    canCertify: false,
    block,
    entry,
    task: null,
    handoff: null,
    decision: null,
  };
}

export function taskItem(task: CloseTask, context: ItemContext): WorkItem {
  const block = certifyBlock(task, context.tasks);
  const state = taskState(task.status);
  const at = task.updatedAt ?? '';
  return {
    key: `task:${task.id}`,
    kind: 'task',
    id: task.id,
    queue: 'checklist',
    title: task.name !== '' ? task.name : `#${shortId(task.id)}`,
    subtitle: task.dependencies.join(' · '),
    who: task.ownerId ?? '',
    mine: task.ownerId !== null && task.ownerId === context.viewer.sid,
    at,
    amount: null,
    currency: context.currency,
    state: state === 'waiting' && block !== null ? 'blocked' : state,
    badge: TASK_STATUS_LABEL[task.status],
    tone: taskTone(task.status),
    age: ageInDays(at, context.today),
    canApprove: false,
    canReject: false,
    canCertify: state === 'waiting' && block === null,
    block,
    entry: null,
    task,
    handoff: null,
    decision: null,
  };
}

export function decisionItem(decision: Decision, context: ItemContext): WorkItem {
  const at = decision.at ?? '';
  return {
    key: `decision:${decision.id}`,
    kind: 'decision',
    id: decision.id,
    queue: 'decided',
    title:
      decision.subject !== ''
        ? decision.subject
        : `#${shortId(decision.resourceId ?? decision.id)}`,
    subtitle: decision.reason,
    who: decision.actor,
    mine: decision.actor !== '' && decision.actor === context.viewer.email,
    at,
    amount: null,
    currency: context.currency,
    state: 'done',
    badge: DECISION_LABEL[decision.kind],
    tone: decisionTone(decision.kind),
    age: ageInDays(at, context.today),
    canApprove: false,
    canReject: false,
    canCertify: false,
    block: null,
    entry: null,
    task: null,
    handoff: null,
    decision,
  };
}

/**
 * A handoff addressed to this desk.
 *
 * `who` may hold a role rather than a person, and that is the row talking: until
 * somebody accepts, `assigned_to` is null and the only answer to "whose is this"
 * is `assigned_role`. `mine` is not recomputed here — the projection computes it
 * server-side against `auth.uid()` and `staff_role()`, which is the only place
 * that knows both.
 *
 * No `block` is ever produced, and that is a fact about the guard rather than an
 * omission: `spine_guard_handoff` refuses on permission and row scope, both of
 * which are already spent by the time a row reaches this function, and then on
 * status. Every live status has exactly one act available — OPEN accepts,
 * ACCEPTED completes, both decline — so a waiting handoff is never blocked, and
 * `state` is therefore only ever `waiting` or `done`.
 */
export function handoffItem(handoff: SpineInboxItem, context: ItemContext): WorkItem {
  const at = handoff.openedAt ?? '';
  return {
    key: `handoff:${handoff.id}`,
    kind: 'handoff',
    id: handoff.id,
    queue: 'handoffs',
    title: handoff.title !== '' ? handoff.title : `#${shortId(handoff.id)}`,
    // The chain, because a queue that says "Review the rooming list" without saying
    // which booking it belongs to is a queue that has to be clicked through to read.
    subtitle: handoff.chainTitle !== '' ? handoff.chainTitle : (handoff.note ?? ''),
    who: handoff.assignedTo ?? handoff.assignedRole ?? '',
    mine: handoff.mine,
    at,
    amount: null,
    currency: context.currency,
    state: isHandoffLive(handoff.status) ? 'waiting' : 'done',
    badge: HANDOFF_STATUS_LABEL[handoff.status],
    tone: handoffTone(handoff.status),
    age: ageInDays(at, context.today),
    canApprove: false,
    canReject: false,
    canCertify: false,
    block: null,
    entry: null,
    task: null,
    handoff,
    decision: null,
  };
}

/** The three acts a handoff row offers. Empty for every other kind. */
export interface HandoffActs {
  readonly accept: boolean;
  readonly complete: boolean;
  readonly decline: boolean;
}

const NO_ACTS: HandoffActs = { accept: false, complete: false, decline: false };

/**
 * `spine_guard_handoff`'s status rule, mirrored once so five call sites agree.
 *
 * Accept demands exactly OPEN; complete and decline demand a live row. The
 * permission check the guard runs first is not mirrored — this app cannot see the
 * role's grant table, and a button disabled on a guess is worse than an act that
 * fails with the server's own sentence.
 *
 * A null row answers the same as a row with no handoff, because the toolbar asks this
 * question about whatever is selected and most of the time nothing is: nothing
 * selected is nothing permitted, and that is cheaper stated once here than guarded at
 * every call site.
 */
export function handoffActs(item: WorkItem | null): HandoffActs {
  const handoff = item?.handoff ?? null;
  if (handoff === null) return NO_ACTS;
  return {
    accept: canAcceptHandoff(handoff.status),
    complete: canCompleteHandoff(handoff.status),
    decline: canDeclineHandoff(handoff.status),
  };
}

/**
 * The four sources, in the order each queue is read in.
 *
 * Approvals oldest-first, because the thing that has waited longest is the thing
 * that should be decided next. The checklist by name, which is the order the RPC
 * resolves dependencies in and therefore the order the steps fall. Handoffs
 * oldest-first then by `seq`, which is `private.spine_inbox`'s own `ORDER BY`.
 * Decisions newest-first, because an archive is read from the top.
 *
 * Handoffs are deliberately *not* sorted by chain priority, tempting as it is.
 * The projection picks its page with `order by opened_at, seq limit p_limit`, so
 * re-sorting the page by priority would put URGENT at the top of a list that was
 * chosen by age — a triage the limit cannot actually deliver, since a newer urgent
 * handoff outside the page would still be missing. Priority is shown on the row
 * instead, where it informs without promising.
 */
export function buildItems(
  entries: readonly JournalEntry[],
  tasks: readonly CloseTask[],
  handoffs: readonly SpineInboxItem[],
  decisions: readonly Decision[],
  context: ItemContext,
): readonly WorkItem[] {
  const approvals = entries
    .map((entry) => entryItem(entry, context))
    .sort((a, b) => (a.at === b.at ? a.title.localeCompare(b.title) : a.at.localeCompare(b.at)));
  const checklist = tasks
    .map((task) => taskItem(task, context))
    .sort((a, b) => a.title.localeCompare(b.title));
  const waiting = [...handoffs]
    .sort((a, b) => {
      const opened = (a.openedAt ?? '').localeCompare(b.openedAt ?? '');
      return opened !== 0 ? opened : a.seq - b.seq;
    })
    .map((handoff) => handoffItem(handoff, context));
  const decided = decisions
    .map((decision) => decisionItem(decision, context))
    .sort((a, b) => b.at.localeCompare(a.at));
  return [...approvals, ...checklist, ...waiting, ...decided];
}

/* ------------------------------------------------------------------ *
 * Filtering
 * ------------------------------------------------------------------ */

export interface InboxFilter {
  readonly queue: QueueId;
  readonly search: string;
  /** Rows this person authored, owns, or decided. Exact — see `WorkItem.who`. */
  readonly mineOnly: boolean;
  /** Whole days an item must have waited to show. Zero means every age. */
  readonly minAge: number;
  readonly hideBlocked: boolean;
}

export const DEFAULT_FILTER: InboxFilter = {
  queue: 'approvals',
  search: '',
  mineOnly: false,
  minAge: 0,
  hideBlocked: false,
};

/** The ages the toolbar offers. Zero is "any". */
export const AGE_CHOICES: readonly number[] = [0, 1, AGE_WARNING, AGE_DANGER, 30];

export const isFiltered = (filter: InboxFilter): boolean =>
  filter.search.trim() !== '' || filter.mineOnly || filter.minAge > 0 || filter.hideBlocked;

/** Reference, detail, and whoever the row names. */
export function itemMatches(item: WorkItem, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return (
    item.title.toLowerCase().includes(needle) ||
    item.subtitle.toLowerCase().includes(needle) ||
    item.who.toLowerCase().includes(needle)
  );
}

export function passes(item: WorkItem, filter: InboxFilter): boolean {
  if (item.queue !== filter.queue) return false;
  if (filter.mineOnly && !item.mine) return false;
  if (filter.minAge > 0 && item.age < filter.minAge) return false;
  if (filter.hideBlocked && item.state === 'blocked') return false;
  return itemMatches(item, filter.search);
}

export const filterItems = (items: readonly WorkItem[], filter: InboxFilter): readonly WorkItem[] =>
  items.filter((item) => passes(item, filter));

/* ------------------------------------------------------------------ *
 * Counting
 * ------------------------------------------------------------------ */

export interface InboxTally {
  readonly byQueue: Readonly<Record<QueueId, number>>;
  /** Needs a decision and can take one. */
  readonly ready: number;
  /** Needs a decision and cannot take one yet. */
  readonly blocked: number;
  readonly waiting: number;
  readonly mine: number;
  /** The longest anything has waited, in whole days. */
  readonly oldest: number;
  /** Waiting past the danger line. The number worth a colour in the status bar. */
  readonly stale: number;
  /** What the waiting approvals add up to, in the book's currency. */
  readonly amount: number;
}

/**
 * Every count in one pass.
 *
 * The rail badges, the status bar and the sweep button all want a different slice
 * of the same page, and three passes over five hundred rows to answer three
 * questions is three times the work for no more truth.
 */
export function tally(items: readonly WorkItem[]): InboxTally {
  const byQueue: Record<QueueId, number> = { approvals: 0, checklist: 0, handoffs: 0, decided: 0 };
  let ready = 0;
  let blocked = 0;
  let waiting = 0;
  let mine = 0;
  let oldest = 0;
  let stale = 0;
  let amount = 0;
  for (const item of items) {
    byQueue[item.queue] += 1;
    if (item.mine) mine += 1;
    if (item.state === 'blocked') blocked += 1;
    if (item.state === 'waiting') {
      waiting += 1;
      if (item.age > oldest) oldest = item.age;
      if (item.age >= AGE_DANGER) stale += 1;
      // A waiting handoff is ready by construction: the projection returns live rows
      // only, and every live status has an act. See `handoffItem`.
      if (item.canApprove || item.canCertify || item.kind === 'handoff') ready += 1;
      if (item.queue === 'approvals' && item.amount !== null) amount += item.amount;
    }
  }
  return { byQueue, ready, blocked, waiting, mine, oldest, stale, amount };
}

/* ------------------------------------------------------------------ *
 * Sweep
 * ------------------------------------------------------------------ */

export interface SweepPlan {
  /** Entries the server would accept, oldest first. */
  readonly ready: readonly WorkItem[];
  /** Considered and left alone, each carrying the sentence that says why. */
  readonly skipped: readonly WorkItem[];
}

/**
 * What "approve everything ready" would actually do.
 *
 * A selection narrows it; without one the whole approvals queue is the candidate
 * set. Blocked rows are never swept — the point of the pre-flight is that a bulk
 * act cannot become a bulk set of server errors — and they are handed back rather
 * than dropped, so the summary can say what it left and why.
 */
export function sweepPlan(items: readonly WorkItem[], keys: ReadonlySet<string> | null): SweepPlan {
  const considered = items.filter(
    (item) => item.kind === 'entry' && item.state !== 'done' && (keys === null || keys.has(item.key)),
  );
  return {
    ready: considered.filter((item) => item.canApprove),
    skipped: considered.filter((item) => !item.canApprove),
  };
}

/* ------------------------------------------------------------------ *
 * The selected entry's lines
 * ------------------------------------------------------------------ */

export interface LineTotals {
  readonly debit: number;
  readonly credit: number;
  readonly difference: number;
}

export function lineTotals(lines: readonly JournalLine[]): LineTotals {
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += line.debit;
    credit += line.credit;
  }
  return { debit, credit, difference: debit - credit };
}

/**
 * Does the entry's own header agree with the lines underneath it?
 *
 * `total_debit`/`total_credit` are stored on the entry and maintained by a trigger,
 * so a disagreement means the page is stale or the trigger did not fire — either
 * way it is worth saying before somebody approves the header's version of events.
 */
export function headerMatchesLines(entry: JournalEntry, lines: readonly JournalLine[]): boolean {
  if (lines.length === 0) return true;
  const totals = lineTotals(lines);
  return Math.abs(totals.debit - entry.debit) < EPSILON && Math.abs(totals.credit - entry.credit) < EPSILON;
}

/* ------------------------------------------------------------------ *
 * Export and clipboard
 * ------------------------------------------------------------------ */

/** A translator, passed in so this module stays a function of its arguments. */
export type Label = (value: Localized) => string;

const QUEUE_CODE: Readonly<Record<QueueId, string>> = {
  approvals: 'APPROVALS',
  checklist: 'CHECKLIST',
  handoffs: 'HANDOFFS',
  decided: 'DECIDED',
};

const STATE_CODE: Readonly<Record<ItemState, string>> = {
  waiting: 'WAITING',
  blocked: 'BLOCKED',
  done: 'DONE',
};

/**
 * The queue as it stands, for the meeting where it gets discussed.
 *
 * Codes rather than labels in the machine columns, because a CSV outlives the
 * language it was exported in; the two prose columns are translated, since a block
 * reason is a sentence or it is nothing.
 *
 * The last three columns are only ever filled for a handoff, and they are separate
 * columns rather than one packed cell because this file is opened in a spreadsheet
 * and sorted: which desk asked, what it asked for, and how loudly are three
 * different questions somebody will want to filter on.
 */
export function queueCsv(items: readonly WorkItem[], t: Label): string {
  return csvDocument(
    [
      'queue', 'kind', 'id', 'state', 'reference', 'detail', 'who', 'date', 'age_days',
      'amount', 'currency', 'status', 'blocked_because', 'route', 'intent', 'priority',
    ],
    items.map((item) => [
      QUEUE_CODE[item.queue],
      item.kind.toUpperCase(),
      item.id,
      STATE_CODE[item.state],
      item.title,
      item.subtitle,
      item.who,
      item.at,
      String(item.age),
      item.amount === null ? '' : item.amount.toFixed(2),
      item.amount === null ? '' : item.currency,
      t(item.badge),
      item.block === null ? '' : t(item.block),
      item.handoff === null ? '' : `${item.handoff.fromStage}>${item.handoff.toStage}`,
      item.handoff === null ? '' : item.handoff.intent,
      item.handoff === null ? '' : item.handoff.chainPriority,
    ]),
  );
}

export const suggestedFileName = (queue: QueueId, today: string): string =>
  `inbox-${queue}-${today}.csv`;

/**
 * One item as pasteable text.
 *
 * What somebody needs in a chat message when they ask a colleague about a row:
 * what it is, who it came from, what it moves, and — if it cannot be decided —
 * the reason, which is the whole content of the question they are about to ask.
 */
export function itemClipboardText(
  item: WorkItem,
  lines: readonly JournalLine[],
  accountLabelOf: (accountId: string | null) => string,
  t: Label,
): string {
  const out: string[] = [`${item.title} — ${t(item.badge)}`];
  if (item.subtitle !== '') out.push(item.subtitle);
  if (item.at !== '') out.push(item.at);
  if (item.who !== '') out.push(item.who);
  if (item.amount !== null) out.push(`${item.amount.toFixed(2)} ${item.currency}`);
  if (item.block !== null) out.push(t(item.block));
  // A handoff pasted without its route is a sentence with no subject: the colleague
  // being asked needs to know which desk is asking and for what before anything else.
  if (item.handoff !== null) {
    const route = `${t(STAGE_LABEL[item.handoff.fromStage])} → ${t(STAGE_LABEL[item.handoff.toStage])}`;
    out.push(`${route} · ${t(INTENT_LABEL[item.handoff.intent])}`);
    if (item.handoff.dueOn !== null) out.push(item.handoff.dueOn);
    if (item.handoff.note !== null && item.handoff.note !== '') out.push(item.handoff.note);
  }
  if (item.task !== null && item.task.dependencies.length > 0) {
    out.push(item.task.dependencies.join(' · '));
  }
  if (lines.length > 0) {
    out.push('');
    for (const line of lines) {
      const side = line.debit > 0 ? line.debit.toFixed(2) : `(${line.credit.toFixed(2)})`;
      out.push(`${accountLabelOf(line.accountId)}\t${side}\t${line.memo}`);
    }
    const totals = lineTotals(lines);
    out.push(`${totals.debit.toFixed(2)}\t${totals.credit.toFixed(2)}`);
  }
  return out.join('\n');
}





