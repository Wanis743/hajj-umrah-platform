/**
 * The spine's vocabulary: the words twelve stages use to hand work to each other.
 *
 * A handoff is the only row in this suite that belongs to two applications at
 * once. CRM writes it, Operations reads it, and neither owns it — so the shapes
 * and the words live here rather than in either app, on the same argument
 * `ledger.ts` makes for a journal entry: written once per app that reads one,
 * "what a handoff is" would be five copies drifting apart one renamed column at
 * a time.
 *
 * The vocabularies below are data, not code, and they are total: adding a stage
 * to the migration's twelve without adding it here is a compile error, not a
 * blank cell. That is the whole reason they are `Readonly<Record<Union, ...>>`
 * instead of lookup functions with a fallback.
 *
 * Nothing here formats and nothing here fetches. `fmt` owns locale policy and
 * the broker owns the wire; these are values.
 */
import type { DatasetRow, Localized, Tone } from '@/platform/sdk';
import { asBoolean, asString, num, str } from './guards';

/* ------------------------------------------------------------------ *
 * Stages
 * ------------------------------------------------------------------ */

/**
 * The twelve places work can sit.
 *
 * Named for the subsystem rather than the verb, because the verb is what
 * `SpineIntent` carries: APPROVAL is where a decision gets made, and whether
 * that decision is approve, reject or escalate is the handoff's business.
 *
 * The order is display order — roughly the path a booking takes — and it is
 * deliberately not enforced anywhere. A flow may skip stages, and CRM handing
 * straight to ACCOUNTING for a prepayment is a real flow, not a violation.
 */
export type SpineStage =
  | 'CRM'
  | 'OPERATIONS'
  | 'DMS'
  | 'ACCOUNTING'
  | 'BI'
  | 'MODELING'
  | 'PLANNING'
  | 'SIMULATION'
  | 'DECISION'
  | 'APPROVAL'
  | 'EXECUTION'
  | 'AUDIT';

export const SPINE_STAGES: readonly SpineStage[] = [
  'CRM',
  'OPERATIONS',
  'DMS',
  'ACCOUNTING',
  'BI',
  'MODELING',
  'PLANNING',
  'SIMULATION',
  'DECISION',
  'APPROVAL',
  'EXECUTION',
  'AUDIT',
];

export const STAGE_LABEL: Readonly<Record<SpineStage, Localized>> = {
  CRM: { ar: 'العلاقات', fr: 'CRM', en: 'CRM' },
  OPERATIONS: { ar: 'العمليات', fr: 'Opérations', en: 'Operations' },
  DMS: { ar: 'الوثائق', fr: 'Documents', en: 'Documents' },
  ACCOUNTING: { ar: 'المحاسبة', fr: 'Comptabilité', en: 'Accounting' },
  BI: { ar: 'التحليلات', fr: 'Analytique', en: 'Analytics' },
  MODELING: { ar: 'النمذجة', fr: 'Modélisation', en: 'Modelling' },
  PLANNING: { ar: 'التخطيط', fr: 'Planification', en: 'Planning' },
  SIMULATION: { ar: 'المحاكاة', fr: 'Simulation', en: 'Simulation' },
  DECISION: { ar: 'القرار', fr: 'Décision', en: 'Decision' },
  APPROVAL: { ar: 'الموافقة', fr: 'Approbation', en: 'Approval' },
  EXECUTION: { ar: 'التنفيذ', fr: 'Exécution', en: 'Execution' },
  AUDIT: { ar: 'التدقيق', fr: 'Audit', en: 'Audit' },
};

/**
 * Text to a stage, or `null`.
 *
 * `null` rather than a default, because a stage is not a display detail: a
 * handoff shown as CRM when the database said ACCOUNTING sends a person to the
 * wrong desk. A row whose stage will not narrow is a projection that changed
 * shape, and `toHandoff` drops it for the same reason it drops a row with no id.
 */
export function toStage(value: unknown): SpineStage | null {
  const text = (asString(value) ?? '').toUpperCase();
  return SPINE_STAGES.find((stage) => stage === text) ?? null;
}

/* ------------------------------------------------------------------ *
 * Intents
 * ------------------------------------------------------------------ */

/**
 * What is being asked for.
 *
 * Ten, and that number is the design rather than an accident of what fitted. An
 * open text field here would have produced "please check", "pls check" and
 * "CHECK" as three different kinds of request, and a board that cannot count its
 * own work is a board nobody reads twice. The intent says what kind; the note
 * says the rest.
 */
export type SpineIntent =
  | 'REVIEW'
  | 'APPROVE'
  | 'RECORD'
  | 'FULFIL'
  | 'INVESTIGATE'
  | 'CERTIFY'
  | 'PUBLISH'
  | 'SETTLE'
  | 'ESCALATE'
  | 'INFORM';

export const SPINE_INTENTS: readonly SpineIntent[] = [
  'REVIEW',
  'APPROVE',
  'RECORD',
  'FULFIL',
  'INVESTIGATE',
  'CERTIFY',
  'PUBLISH',
  'SETTLE',
  'ESCALATE',
  'INFORM',
];

export const INTENT_LABEL: Readonly<Record<SpineIntent, Localized>> = {
  REVIEW: { ar: 'مراجعة', fr: 'Révision', en: 'Review' },
  APPROVE: { ar: 'موافقة', fr: 'Approbation', en: 'Approve' },
  RECORD: { ar: 'تسجيل', fr: 'Enregistrement', en: 'Record' },
  FULFIL: { ar: 'تنفيذ', fr: 'Exécution', en: 'Fulfil' },
  INVESTIGATE: { ar: 'تحقيق', fr: 'Investigation', en: 'Investigate' },
  CERTIFY: { ar: 'تصديق', fr: 'Certification', en: 'Certify' },
  PUBLISH: { ar: 'نشر', fr: 'Publication', en: 'Publish' },
  SETTLE: { ar: 'تسوية', fr: 'Règlement', en: 'Settle' },
  ESCALATE: { ar: 'تصعيد', fr: 'Escalade', en: 'Escalate' },
  INFORM: { ar: 'إبلاغ', fr: 'Information', en: 'Inform' },
};

/** Defaulted to REVIEW: an unreadable intent is a display question, and a row
 *  dropped for it would hide work that genuinely is waiting on someone. */
export function toIntent(value: unknown): SpineIntent {
  const text = (asString(value) ?? '').toUpperCase();
  return SPINE_INTENTS.find((intent) => intent === text) ?? 'REVIEW';
}

/* ------------------------------------------------------------------ *
 * Statuses
 * ------------------------------------------------------------------ */

/**
 * Where a handoff is in its life.
 *
 * OPEN and ACCEPTED are live; the other three are terminal, and the database
 * enforces that — there is no reopen. The way to ask a question twice is to ask
 * it again, on a new handoff, where the ledger can show that you did.
 *
 * SUPERSEDED is the one worth naming carefully: asked, never answered, no longer
 * expected. It is what an abandoned chain leaves behind, and calling it DECLINED
 * would blame a person for a decision nobody made.
 */
export type HandoffStatus = 'OPEN' | 'ACCEPTED' | 'DONE' | 'DECLINED' | 'SUPERSEDED';

export const HANDOFF_STATUSES: readonly HandoffStatus[] = [
  'OPEN',
  'ACCEPTED',
  'DONE',
  'DECLINED',
  'SUPERSEDED',
];

export const HANDOFF_STATUS_LABEL: Readonly<Record<HandoffStatus, Localized>> = {
  OPEN: { ar: 'مفتوحة', fr: 'Ouverte', en: 'Open' },
  ACCEPTED: { ar: 'مقبولة', fr: 'Prise en charge', en: 'Accepted' },
  DONE: { ar: 'منجزة', fr: 'Terminée', en: 'Done' },
  DECLINED: { ar: 'مرفوضة', fr: 'Refusée', en: 'Declined' },
  SUPERSEDED: { ar: 'ملغاة', fr: 'Abandonnée', en: 'Superseded' },
};

export function toHandoffStatus(value: unknown): HandoffStatus {
  const text = (asString(value) ?? '').toUpperCase();
  return HANDOFF_STATUSES.find((state) => state === text) ?? 'OPEN';
}

/** Live means someone still owes an answer. Everything else is history. */
export const isHandoffLive = (state: HandoffStatus): boolean => state === 'OPEN' || state === 'ACCEPTED';

/**
 * The colour a status wears.
 *
 * SUPERSEDED is neutral rather than danger on purpose: nothing went wrong, the
 * question simply stopped mattering, and a queue full of red rows for chains
 * somebody tidily abandoned teaches people to ignore red.
 */
export const handoffTone = (state: HandoffStatus): Tone =>
  state === 'DONE'
    ? 'success'
    : state === 'DECLINED'
      ? 'danger'
      : state === 'ACCEPTED'
        ? 'accent'
        : state === 'OPEN'
          ? 'warning'
          : 'neutral';

export type ChainStatus = 'OPEN' | 'CLOSED' | 'ABANDONED';

export const CHAIN_STATUS_LABEL: Readonly<Record<ChainStatus, Localized>> = {
  OPEN: { ar: 'جارية', fr: 'En cours', en: 'Open' },
  CLOSED: { ar: 'مغلقة', fr: 'Clôturée', en: 'Closed' },
  ABANDONED: { ar: 'متروكة', fr: 'Abandonnée', en: 'Abandoned' },
};

export const CHAIN_STATUSES: readonly ChainStatus[] = ['OPEN', 'CLOSED', 'ABANDONED'];

export function toChainStatus(value: unknown): ChainStatus {
  const text = (asString(value) ?? '').toUpperCase();
  return CHAIN_STATUSES.find((state) => state === text) ?? 'OPEN';
}

/** A chain still running is `accent` rather than `warning`: work in progress is
 *  the normal state of a spine, and only a handoff nobody answered is a warning. */
export const chainTone = (state: ChainStatus): Tone =>
  state === 'CLOSED' ? 'success' : state === 'OPEN' ? 'accent' : 'neutral';

/* ------------------------------------------------------------------ *
 * Priority
 * ------------------------------------------------------------------ */

/**
 * How loudly a chain asks.
 *
 * Four, and NORMAL is the default the database applies when the caller says
 * nothing — which is most of the time, and should be. A priority field where
 * everything arrives URGENT is a priority field that has stopped carrying
 * information, so nothing in this suite sets it automatically.
 */
export type SpinePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export const SPINE_PRIORITIES: readonly SpinePriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export const PRIORITY_LABEL: Readonly<Record<SpinePriority, Localized>> = {
  LOW: { ar: 'منخفضة', fr: 'Basse', en: 'Low' },
  NORMAL: { ar: 'عادية', fr: 'Normale', en: 'Normal' },
  HIGH: { ar: 'عالية', fr: 'Haute', en: 'High' },
  URGENT: { ar: 'عاجلة', fr: 'Urgente', en: 'Urgent' },
};

export function toPriority(value: unknown): SpinePriority {
  const text = (asString(value) ?? '').toUpperCase();
  return SPINE_PRIORITIES.find((level) => level === text) ?? 'NORMAL';
}

/** NORMAL and LOW both read `neutral`, because a badge on every row is wallpaper. */
export const priorityTone = (level: SpinePriority): Tone =>
  level === 'URGENT' ? 'danger' : level === 'HIGH' ? 'warning' : 'neutral';

/* ------------------------------------------------------------------ *
 * Transitions
 * ------------------------------------------------------------------ */

/**
 * What may still happen to a handoff.
 *
 * These are transcribed from `private.spine_guard_handoff` and the three command
 * bodies, and they are deliberately the weaker check: the database also asks
 * whether your role may touch the row and whether the row is inside your branch
 * scope, and it has the last word on both. What these buy is a button that is
 * disabled instead of a button that raises 22023 — the same answer, arrived at
 * before the click rather than after it.
 *
 * `canAccept` is the narrow one: accept refuses anything that is not exactly
 * OPEN, because taking a handoff someone else already took is not a second
 * claim, it is a disagreement, and the ledger cannot record who won.
 */
export const isHandoffTerminal = (state: HandoffStatus): boolean => !isHandoffLive(state);

export const canAcceptHandoff = (state: HandoffStatus): boolean => state === 'OPEN';

export const canCompleteHandoff = (state: HandoffStatus): boolean => isHandoffLive(state);

export const canDeclineHandoff = (state: HandoffStatus): boolean => isHandoffLive(state);

/* ------------------------------------------------------------------ *
 * Handoffs
 * ------------------------------------------------------------------ */

/**
 * `payload` narrowed, or an empty object.
 *
 * The column has a CHECK saying `jsonb_typeof(payload) = 'object'`, so this
 * should never fall through — and it is written anyway, because the projection
 * that feeds it is a `jsonb_agg` over a join and a future column rename lands
 * here as `undefined` long before it lands in the CHECK.
 */
function asPayload(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

/**
 * One request, from one stage to another.
 *
 * The nullable fields are nullable in the table and mean different things when
 * empty: no `assignedRole` and no `assignedTo` is "anyone who can see this", no
 * `dueOn` is "when you can", no `parentId` is "this is the first ask". None of
 * them are missing data, so none of them get defaults.
 *
 * `decidedBy` / `decidedAt` / `decidedNote` fill in together or not at all, and
 * they are the only record of who answered — the events table says a status
 * changed, this says who owned the change.
 */
export interface SpineHandoff {
  id: string;
  chainId: string;
  seq: number;
  parentId: string | null;
  fromStage: SpineStage;
  toStage: SpineStage;
  intent: SpineIntent;
  status: HandoffStatus;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  titleAr: string | null;
  note: string | null;
  payload: Readonly<Record<string, unknown>>;
  assignedRole: string | null;
  assignedTo: string | null;
  dueOn: string | null;
  openedBy: string | null;
  openedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decidedNote: string | null;
}

/**
 * A projection row to a handoff, or `null`.
 *
 * Four things make a row unusable rather than merely incomplete: no `id` (there
 * is nothing to accept), no `chainId` (there is nowhere to go back to), and
 * either stage failing to narrow (the row would name a desk that does not
 * exist). Everything else has a defensible empty value, so everything else gets
 * one.
 *
 * Dropping beats guessing here for a reason specific to this table: a handoff is
 * an obligation. A row rendered with a plausible default is a person told they
 * owe an answer to a question the database did not actually ask.
 */
export function toHandoff(row: DatasetRow): SpineHandoff | null {
  const id = asString(row.id);
  const chainId = asString(row.chain_id);
  const from = toStage(row.from_stage);
  const to = toStage(row.to_stage);
  if (id === null || chainId === null || from === null || to === null) return null;
  return {
    id,
    chainId,
    seq: num(row.seq),
    parentId: asString(row.parent_id),
    fromStage: from,
    toStage: to,
    intent: toIntent(row.intent),
    status: toHandoffStatus(row.status),
    subjectType: asString(row.subject_type),
    subjectId: asString(row.subject_id),
    title: str(row.title),
    titleAr: asString(row.title_ar),
    note: asString(row.note),
    payload: asPayload(row.payload),
    assignedRole: asString(row.assigned_role),
    assignedTo: asString(row.assigned_to),
    dueOn: asString(row.due_on),
    openedBy: asString(row.opened_by),
    openedAt: asString(row.opened_at),
    decidedBy: asString(row.decided_by),
    decidedAt: asString(row.decided_at),
    decidedNote: asString(row.decided_note),
  };
}

/**
 * A handoff as the Inbox sees it: the row, plus the chain it belongs to, plus
 * whether it is addressed to the person reading.
 *
 * The chain fields are denormalised into the projection rather than fetched per
 * row, because a queue that renders "Review the Ramadan rooming list" without
 * saying which booking it belongs to is a queue people have to click through to
 * triage — and clicking through twelve rows to find the one that matters is how
 * a queue stops being read.
 */
export interface SpineInboxItem extends SpineHandoff {
  mine: boolean;
  chainTitle: string;
  chainTitleAr: string | null;
  chainStatus: ChainStatus;
  chainPriority: SpinePriority;
  chainStage: SpineStage | null;
  chainOrigin: SpineStage | null;
}

/**
 * `mine` defaults to `false`, and that is not laziness about a boolean.
 *
 * The function computes it as `assigned_to = uid or (assigned_to is null and
 * assigned_role = role) or (assigned_to is null and assigned_role is null)`,
 * which yields SQL NULL when the row names an assignee and the session has no
 * `auth.uid()` — an unauthenticated read of an assigned row. `false` is the
 * honest reading of that: not yours in particular. Defaulting the other way
 * would put someone else's work under "Waiting on you".
 */
export function toInboxItem(row: DatasetRow): SpineInboxItem | null {
  const base = toHandoff(row);
  if (base === null) return null;
  return {
    ...base,
    mine: asBoolean(row.mine) ?? false,
    chainTitle: str(row.chain_title),
    chainTitleAr: asString(row.chain_title_ar),
    chainStatus: toChainStatus(row.chain_status),
    chainPriority: toPriority(row.chain_priority),
    chainStage: toStage(row.chain_stage),
    chainOrigin: toStage(row.chain_origin),
  };
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

/**
 * The seven things that get written down.
 *
 * REASSIGNED and NOTED are the two that no command in `abi.ts` produces yet, and
 * they are here because the table's CHECK lists them: this map is total against
 * the database, not against the buttons currently on screen. A label that exists
 * before its button is a blank cell avoided later.
 */
export type SpineAction =
  | 'OPENED'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'SUPERSEDED'
  | 'REASSIGNED'
  | 'NOTED';

export const SPINE_ACTIONS: readonly SpineAction[] = [
  'OPENED',
  'ACCEPTED',
  'COMPLETED',
  'DECLINED',
  'SUPERSEDED',
  'REASSIGNED',
  'NOTED',
];

export const ACTION_LABEL: Readonly<Record<SpineAction, Localized>> = {
  OPENED: { ar: 'فُتحت', fr: 'Ouverte', en: 'Opened' },
  ACCEPTED: { ar: 'قُبلت', fr: 'Prise en charge', en: 'Accepted' },
  COMPLETED: { ar: 'أُنجزت', fr: 'Terminée', en: 'Completed' },
  DECLINED: { ar: 'رُفضت', fr: 'Refusée', en: 'Declined' },
  SUPERSEDED: { ar: 'أُلغيت', fr: 'Abandonnée', en: 'Superseded' },
  REASSIGNED: { ar: 'أُعيد تعيينها', fr: 'Réattribuée', en: 'Reassigned' },
  NOTED: { ar: 'ملاحظة', fr: 'Annotée', en: 'Noted' },
};

export function toAction(value: unknown): SpineAction {
  const text = (asString(value) ?? '').toUpperCase();
  return SPINE_ACTIONS.find((action) => action === text) ?? 'NOTED';
}

/**
 * One line of the ledger.
 *
 * `fromStatus` is null on the first event of a handoff — nothing preceded OPENED
 * — and both statuses are plain text rather than `HandoffStatus` on purpose: the
 * history is what the database wrote at the time, and narrowing it would mean a
 * row written before a vocabulary change either disappears or lies. A timeline
 * is the one place where an unrecognised word should be printed, not dropped.
 *
 * `actor` and `actorEmail` are both kept because neither is enough: the uid is
 * what row scoping uses and the e-mail is what a person recognises. The renderer
 * prefers the e-mail and falls back to the uid.
 */
export interface SpineEvent {
  id: string;
  handoffId: string | null;
  action: SpineAction;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string | null;
  actorEmail: string | null;
  detail: Readonly<Record<string, unknown>>;
  at: string | null;
}

export function toEvent(row: DatasetRow): SpineEvent | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    handoffId: asString(row.handoff_id),
    action: toAction(row.action),
    fromStatus: asString(row.from_status),
    toStatus: asString(row.to_status),
    actor: asString(row.actor),
    actorEmail: asString(row.actor_email),
    detail: asPayload(row.detail),
    at: asString(row.at),
  };
}

/* ------------------------------------------------------------------ *
 * Chains
 * ------------------------------------------------------------------ */

/**
 * A nested array to a list of mapped rows, skipping what will not map.
 *
 * Two reads in this file answer with one document that has arrays inside it, and
 * a nested array is where a projection change hides best: `rows.length === 1`
 * looks healthy whatever is underneath. Anything that is not an object is
 * skipped rather than coerced, so a shape change costs a missing row instead of
 * a rendered `undefined`.
 */
function mapRows<T>(value: unknown, to: (row: DatasetRow) => T | null): readonly T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const mapped = to(item as DatasetRow);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

/**
 * The flow itself: what it is about, where it started, where it has got to.
 *
 * `currentStage` is maintained by a trigger from the handoffs rather than set by
 * a caller, so it is the one field here nobody can lie about. `steps` and `live`
 * are counts the overview computes; the chain read does not carry them, and
 * `toChainDoc` fills them from the handoffs it already has rather than leaving a
 * header that says nought steps above a list of five.
 */
export interface SpineChain {
  id: string;
  title: string;
  titleAr: string | null;
  subjectType: string | null;
  subjectId: string | null;
  originStage: SpineStage | null;
  currentStage: SpineStage | null;
  status: ChainStatus;
  priority: SpinePriority;
  openedBy: string | null;
  openedAt: string | null;
  closedAt: string | null;
  closedNote: string;
  steps: number;
  live: number;
}

export function toChain(row: DatasetRow): SpineChain | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    title: str(row.title),
    titleAr: asString(row.title_ar),
    subjectType: asString(row.subject_type),
    subjectId: asString(row.subject_id),
    originStage: toStage(row.origin_stage),
    currentStage: toStage(row.current_stage),
    status: toChainStatus(row.status),
    priority: toPriority(row.priority),
    openedBy: asString(row.opened_by),
    openedAt: asString(row.opened_at),
    closedAt: asString(row.closed_at),
    closedNote: str(row.closed_note),
    steps: num(row.steps),
    live: num(row.live),
  };
}

/**
 * A chain read whole: the chain, its handoffs in `seq` order, its events in time
 * order. The ordering arrives from the database and is not re-sorted here — the
 * function orders by the column that defines the sequence, and a client that
 * sorted by `openedAt` instead would reorder two handoffs opened in the same
 * transaction.
 */
export interface SpineChainDoc {
  chain: SpineChain;
  handoffs: readonly SpineHandoff[];
  events: readonly SpineEvent[];
}

export function toChainDoc(row: DatasetRow): SpineChainDoc | null {
  const chainRow = row.chain;
  if (typeof chainRow !== 'object' || chainRow === null || Array.isArray(chainRow)) return null;
  const chain = toChain(chainRow as DatasetRow);
  if (chain === null) return null;
  const handoffs = mapRows(row.handoffs, toHandoff);
  const events = mapRows(row.events, toEvent);
  return {
    chain: { ...chain, steps: handoffs.length, live: handoffs.filter((h) => isHandoffLive(h.status)).length },
    handoffs,
    events,
  };
}

/* ------------------------------------------------------------------ *
 * The board
 * ------------------------------------------------------------------ */

/**
 * A jsonb count map to a total record: every key present, missing ones zero.
 *
 * `jsonb_object_agg` over a `group by` emits only the groups that exist, so a
 * stage with nothing waiting is simply absent. Filling it with zero is what makes
 * a board that keeps its shape — a column that disappears the week its queue
 * empties is a column nobody can compare against last week.
 */
function countsFor<K extends string>(value: unknown, keys: readonly K[]): Readonly<Record<K, number>> {
  const source = asPayload(value);
  const out = {} as Record<K, number>;
  for (const key of keys) out[key] = num(source[key]);
  return out;
}

/**
 * Where work piles up.
 *
 * `byStage` counts the *destination* of live handoffs, which is the number a
 * stage can act on: work Operations has sent to Accounting is Accounting's
 * backlog, not Operations'. `byStatus` counts every handoff in scope including
 * the terminal ones, so the two maps do not sum to each other and are not meant
 * to.
 *
 * `oldestOpenAt` is the single most useful number on the board: a queue of four
 * where the oldest is from this morning is a working spine, and a queue of four
 * where the oldest is from March is a broken one.
 */
export interface SpineBoard {
  byStage: Readonly<Record<SpineStage, number>>;
  byStatus: Readonly<Record<HandoffStatus, number>>;
  oldestOpenAt: string | null;
  chains: readonly SpineChain[];
  liveTotal: number;
}

export function toBoard(row: DatasetRow): SpineBoard {
  const byStatus = countsFor(row.byStatus, HANDOFF_STATUSES);
  return {
    byStage: countsFor(row.byStage, SPINE_STAGES),
    byStatus,
    oldestOpenAt: asString(row.oldestOpenAt),
    chains: mapRows(row.chains, toChain),
    liveTotal: byStatus.OPEN + byStatus.ACCEPTED,
  };
}

/** An empty board, for the first render and for a read that returned nothing. A
 *  dashboard with no rows yet should say nought, not blank. */
export const EMPTY_BOARD: SpineBoard = {
  byStage: countsFor(null, SPINE_STAGES),
  byStatus: countsFor(null, HANDOFF_STATUSES),
  oldestOpenAt: null,
  chains: [],
  liveTotal: 0,
};

/* ------------------------------------------------------------------ *
 * Subjects
 * ------------------------------------------------------------------ */

/**
 * The twenty-five things a chain can be about.
 *
 * Lower snake case, unlike every other vocabulary in this file, because that is
 * how `private.spine_subject_target` spells them and neither the wrappers nor the
 * function bodies fold case. Upper-casing one on the way in produces a constraint
 * violation that reads like a broken database rather than a bad argument, so the
 * broker leaves these alone and so does this map.
 *
 * The type is `Partial<Record<...>>` in effect — a subject the database gains
 * before this file does renders as its own key, which is ugly and readable, and
 * far better than the alternative for a column whose whole job is telling a
 * person which record to go and look at.
 */
export type SpineSubjectType =
  | 'pilgrim'
  | 'booking'
  | 'group'
  | 'package'
  | 'visa'
  | 'external_operation'
  | 'crm_customer'
  | 'crm_opportunity'
  | 'crm_quote'
  | 'crm_activity'
  | 'crm_campaign'
  | 'invoice'
  | 'payment'
  | 'supplier'
  | 'supplier_bill'
  | 'journal_entry'
  | 'bank_transaction'
  | 'contract'
  | 'hotel_contract'
  | 'dms_document'
  | 'close_task'
  | 'fiscal_period'
  | 'modeling_model'
  | 'bi_dashboard'
  | 'staff_profile';

export const SUBJECT_LABEL: Readonly<Record<SpineSubjectType, Localized>> = {
  pilgrim: { ar: 'معتمر', fr: 'Pèlerin', en: 'Pilgrim' },
  booking: { ar: 'حجز', fr: 'Réservation', en: 'Booking' },
  group: { ar: 'مجموعة', fr: 'Groupe', en: 'Group' },
  package: { ar: 'برنامج', fr: 'Forfait', en: 'Package' },
  visa: { ar: 'تأشيرة', fr: 'Visa', en: 'Visa' },
  external_operation: { ar: 'عملية خارجية', fr: 'Opération externe', en: 'External operation' },
  crm_customer: { ar: 'عميل', fr: 'Client', en: 'Customer' },
  crm_opportunity: { ar: 'فرصة', fr: 'Opportunité', en: 'Opportunity' },
  crm_quote: { ar: 'عرض سعر', fr: 'Devis', en: 'Quote' },
  crm_activity: { ar: 'نشاط', fr: 'Activité', en: 'Activity' },
  crm_campaign: { ar: 'حملة', fr: 'Campagne', en: 'Campaign' },
  invoice: { ar: 'فاتورة', fr: 'Facture', en: 'Invoice' },
  payment: { ar: 'دفعة', fr: 'Paiement', en: 'Payment' },
  supplier: { ar: 'مورّد', fr: 'Fournisseur', en: 'Supplier' },
  supplier_bill: { ar: 'فاتورة مورّد', fr: 'Facture fournisseur', en: 'Supplier bill' },
  journal_entry: { ar: 'قيد يومية', fr: 'Écriture', en: 'Journal entry' },
  bank_transaction: { ar: 'حركة بنكية', fr: 'Opération bancaire', en: 'Bank transaction' },
  contract: { ar: 'عقد', fr: 'Contrat', en: 'Contract' },
  hotel_contract: { ar: 'عقد فندق', fr: 'Contrat hôtelier', en: 'Hotel contract' },
  dms_document: { ar: 'وثيقة', fr: 'Document', en: 'Document' },
  close_task: { ar: 'مهمة إقفال', fr: 'Tâche de clôture', en: 'Close task' },
  fiscal_period: { ar: 'فترة مالية', fr: 'Période', en: 'Fiscal period' },
  modeling_model: { ar: 'نموذج', fr: 'Modèle', en: 'Model' },
  bi_dashboard: { ar: 'لوحة تحليلية', fr: 'Tableau de bord', en: 'Dashboard' },
  staff_profile: { ar: 'موظف', fr: 'Collaborateur', en: 'Staff member' },
};

export const SPINE_SUBJECT_TYPES: readonly SpineSubjectType[] = Object.keys(
  SUBJECT_LABEL,
) as SpineSubjectType[];

/**
 * A subject type to a label, falling back to the raw key.
 *
 * The fallback is the honest one here: printing `close_task` is worse than
 * printing "Close task" and better than printing nothing at all, and a subject
 * this file has not learned yet still tells the reader where to go.
 */
export function subjectLabel(value: unknown): Localized {
  const key = str(value);
  const known = SPINE_SUBJECT_TYPES.find((subject) => subject === key);
  return known === undefined ? { ar: key, fr: key, en: key } : SUBJECT_LABEL[known];
}

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

/**
 * Who a handoff can be addressed to without naming a person.
 *
 * These are the seven `private.spine_role_ok` accepts, and they are a narrower
 * list than the platform's own roles on purpose: a role you cannot hand work to
 * has no business appearing in an assignee picker. Addressing a role rather than
 * a person is the normal case — "somebody in finance, please" — and it is what
 * keeps a queue working while the one accountant who knows is on leave.
 */
export type SpineRole =
  | 'ADMIN'
  | 'FINANCE'
  | 'OPERATIONS_MANAGER'
  | 'CRM'
  | 'AGENT'
  | 'VISA_AGENT'
  | 'GUIDE';

export const SPINE_ROLES: readonly SpineRole[] = [
  'ADMIN',
  'FINANCE',
  'OPERATIONS_MANAGER',
  'CRM',
  'AGENT',
  'VISA_AGENT',
  'GUIDE',
];

export const ROLE_LABEL: Readonly<Record<SpineRole, Localized>> = {
  ADMIN: { ar: 'الإدارة', fr: 'Administration', en: 'Admin' },
  FINANCE: { ar: 'المالية', fr: 'Finance', en: 'Finance' },
  OPERATIONS_MANAGER: { ar: 'مدير العمليات', fr: 'Responsable opérations', en: 'Operations manager' },
  CRM: { ar: 'العلاقات', fr: 'CRM', en: 'CRM' },
  AGENT: { ar: 'موظف مبيعات', fr: 'Agent', en: 'Agent' },
  VISA_AGENT: { ar: 'موظف تأشيرات', fr: 'Agent visas', en: 'Visa agent' },
  GUIDE: { ar: 'مرشد', fr: 'Guide', en: 'Guide' },
};

export function toRole(value: unknown): SpineRole | null {
  const text = (asString(value) ?? '').toUpperCase();
  return SPINE_ROLES.find((role) => role === text) ?? null;
}













