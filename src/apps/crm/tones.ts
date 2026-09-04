/**
 * What colour a code is, and what word it is in the reader's language.
 *
 * Every enum in this app arrives as a bare uppercase code — `QUALIFIED`, `NO_ANSWER`,
 * `CORPORATE` — because the database's CHECK constraints are the authority on those columns
 * and `model.ts` refuses to narrow them to unions a seventh value would falsify. Two
 * questions therefore have to be answered at the moment a cell renders: which of the six
 * badge tones it wears, and which of three languages it speaks.
 *
 * Both answers live here rather than in `list.tsx` because both are pure lookups over
 * strings, and a `.tsx` file may only export components — `react-refresh` is error-level in
 * this repository, so a tone table exported from a grid file would fail lint. The grids
 * import from here; nothing here imports a grid.
 *
 * The tables are keyed by the UPPERCASE code and read through `toneOf`, which upper-cases
 * before looking up. That is deliberate and not defensive: `guards.ts:40` lower-cases most
 * status columns on the way in (`status()`), a handful arrive raw (`str()`), and two are
 * explicitly upper-cased — so the same logical value reaches this file in three different
 * shapes depending on which projection it came through. Keying on one canonical case is the
 * only way a single table serves them all. `optionLabel` in `form.ts` already does exactly
 * this (`const wanted = value.toUpperCase()`), so the two agree by construction.
 *
 * A code with no row falls back to `neutral` rather than throwing. The tables cover what the
 * schema declares today; a value added to a CHECK constraint tomorrow should arrive grey and
 * legible, not crash the register it appears in.
 */
import type { Localized } from '@/platform/sdk';
import type { CrmEntity } from './form';
import { optionLabel } from './form';
import type { Quote } from './model';

/**
 * The six tones `.fx-badge[data-tone]` is already styled for. Written out rather than
 * imported from the SDK's `Tone` because this is a closed local vocabulary — the same
 * choice `close/list.tsx` makes for its own state tones — and because a table typed on the
 * SDK union would silently accept a tone this app never uses.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

/**
 * `| undefined` on the value is not decoration. `noUncheckedIndexedAccess` is off in this
 * project, so `TABLE[key]` would otherwise type as `BadgeTone` and the `?? 'neutral'` in
 * `toneOf` would read as dead code to anyone maintaining it.
 */
export type ToneTable = Readonly<Record<string, BadgeTone | undefined>>;

/** A lead walks left to right; `CONVERTED` is the only ending anyone celebrates. */
export const LEAD_STATUS_TONE: ToneTable = {
  NEW: 'info',
  CONTACTED: 'neutral',
  QUALIFIED: 'accent',
  PROPOSAL: 'accent',
  LOST: 'danger',
  CONVERTED: 'success',
};

/** Shared by leads and follow-ups; only follow-ups reach `URGENT`. */
export const PRIORITY_TONE: ToneTable = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

export const CUSTOMER_TYPE_TONE: ToneTable = {
  INDIVIDUAL: 'neutral',
  FAMILY: 'info',
  CORPORATE: 'accent',
};

export const CUSTOMER_STATUS_TONE: ToneTable = {
  ACTIVE: 'success',
  DORMANT: 'neutral',
  BLOCKED: 'danger',
};

/**
 * The six stages, coloured by how much of the work is behind them. `NEGOTIATION` is amber
 * rather than green: a deal that has been in negotiation for a month is a deal in trouble,
 * and the colour should not congratulate anyone before the quote is accepted.
 */
export const STAGE_TONE: ToneTable = {
  NEW: 'info',
  QUALIFYING: 'neutral',
  PROPOSAL: 'accent',
  NEGOTIATION: 'warning',
  WON: 'success',
  LOST: 'danger',
};

export const DIRECTION_TONE: ToneTable = {
  INBOUND: 'info',
  OUTBOUND: 'neutral',
};

/** What came of the exchange. `FOLLOW_UP` is blue because it is an instruction, not a verdict. */
export const OUTCOME_TONE: ToneTable = {
  CONNECTED: 'success',
  NO_ANSWER: 'warning',
  INTERESTED: 'accent',
  NOT_INTERESTED: 'danger',
  FOLLOW_UP: 'info',
  CLOSED: 'neutral',
};

/**
 * `DONE` is here although `form.ts` deliberately omits it from the editor's status list:
 * only `crm.followup.complete` writes it, and a row that carries it still has to be drawn.
 */
export const FOLLOWUP_STATUS_TONE: ToneTable = {
  OPEN: 'info',
  DONE: 'success',
  CANCELLED: 'neutral',
};

export const CAMPAIGN_STATUS_TONE: ToneTable = {
  PLANNED: 'info',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

/** Grey for anything the tables do not know. See the head of this file. */
export const toneOf = (table: ToneTable, value: string): BadgeTone =>
  table[value.toUpperCase()] ?? 'neutral';

/**
 * The code as a word, or the code itself.
 *
 * `optionLabel` returns `null` for exactly the values its own tables omit because the server
 * owns them — a lead's `CONVERTED`, an activity's `SYSTEM`, a follow-up's `DONE` — and its
 * doc says what to do about it: *'Show the raw code there. A blank cell is worse than an
 * unfamiliar word.'* An empty column, though, stays empty: `''` means the row has no value,
 * not that the value is unrecognised, and the caller draws an em-dash for it.
 */
export function wordFor(
  t: (value: Localized) => string,
  entity: CrmEntity,
  key: string,
  value: string,
): string {
  if (value.trim() === '') return '';
  const label = optionLabel(entity, key, value);
  return label === null ? value.toUpperCase() : t(label);
}

/**
 * A quote's state, read off its timestamps rather than its `status` column.
 *
 * This is the one enum in the app with no `FieldSpec` anywhere in `form.ts`: the column is
 * written only by `crm.quote.send`, `crm.quote.accept` and `crm.quote.decline`, so there is
 * no editor for it and therefore no option table to borrow labels from. Deriving the state
 * from the three stamps instead keeps this file agreeing with `chrome.tsx`'s `allowed()`,
 * which decides whether Send/Accept/Decline are live on precisely the same two nulls.
 *
 * `expired` is the reading the stamps alone do not give. A sent quote past its `validUntil`
 * is still `SENT` in the database and still answerable — `crm.quote.accept` refuses it with
 * `22023`, which is why `lifecycle.ts` restates that refusal in words — but a register that
 * drew it identically to a live one would be hiding the single most useful fact about it.
 */
export interface QuoteState {
  readonly text: Localized;
  readonly tone: BadgeTone;
  /** True once `validUntil` is behind us and nobody has answered. */
  readonly expired: boolean;
}

const state = (tone: BadgeTone, expired: boolean, ar: string, fr: string, en: string): QuoteState => ({
  text: { ar, fr, en },
  tone,
  expired,
});

export function quoteState(quote: Quote, now: number): QuoteState {
  if (quote.acceptedAt !== null) return state('success', false, 'مقبول', 'Accepté', 'Accepted');
  if (quote.declinedAt !== null) return state('danger', false, 'مرفوض', 'Refusé', 'Declined');
  if (quote.sentAt === null) return state('neutral', false, 'مسودة', 'Brouillon', 'Draft');
  const until = quote.validUntil === null ? null : new Date(`${quote.validUntil}T23:59:59`).getTime();
  if (until !== null && Number.isFinite(until) && until < now) {
    return state('warning', true, 'منتهي الصلاحية', 'Expiré', 'Expired');
  }
  return state('info', false, 'مُرسل', 'Envoyé', 'Sent');
}
