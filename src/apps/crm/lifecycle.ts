/**
 * The seven CRM commands that are not CRUD.
 *
 * `form.ts` next door writes rows: a payload of column names and a value for each, the
 * same shape for all eight tables, saved with one of three commands. The seven commands
 * here are the opposite of that. Each has a payload of its own invention, each moves a
 * record between states rather than editing its columns, and one of them — accepting a
 * quote — books a trip, takes a deposit, posts a journal and decrements a package's seats
 * inside a single transaction.
 *
 * Every builder in this file omits rather than blanks. The RPCs behind them declare
 * defaults (`p_valid_days integer default 14`, `p_payment_method text default 'Cash'`,
 * `p_travelers integer default 1`), and a key that is absent gets the default while a key
 * that is present and null gets null. Sending `{ note: null }` to a text parameter is not
 * the same as not mentioning it, and on the ones with `not null` server-side it is a
 * refusal. So the builders return sparse objects, assembled key by key.
 *
 * The validators mirror the server's own refusals, in the same spirit as
 * `validateRecord`: a dialog that lets a person press Accept on an expired quote and then
 * shows them `22023` has explained nothing. Where the server's check is cheap to restate
 * it is restated here, in words, before the round trip.
 */
import type { DataCommandName, Localized } from '@/platform/sdk';
import { type Stage, STAGES } from './model';
import type { FieldOption, Problem, ProblemField } from './form';
import { paymentMethods } from './form';

const lab = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

type Sink = (field: ProblemField, blocking: boolean, ar: string, fr: string, en: string) => void;

/** Collects into a blocking-first list, exactly as `validateRecord` does. */
function collect(fill: (add: Sink) => void): readonly Problem[] {
  const problems: Problem[] = [];
  const add: Sink = (field, blocking, ar, fr, en) => {
    problems.push({ field, blocking, text: { ar, fr, en } });
  };
  fill(add);
  return [...problems.filter((p) => p.blocking), ...problems.filter((p) => !p.blocking)];
}

const trimmed = (text: string | undefined): string => (text ?? '').trim();

/** A positive amount, or null. Blank and unparseable both mean "no amount was entered". */
const amount = (text: string | undefined): number | null => {
  const value = Number.parseFloat(trimmed(text));
  return Number.isFinite(value) && value > 0 ? value : null;
};

const count = (text: string | undefined, fallback: number): number => {
  const value = Number.parseInt(trimmed(text), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

// ---------------------------------------------------------------------------
// The stage machine
// ---------------------------------------------------------------------------

/**
 * A local copy of `CRM_STAGE_TRANSITIONS`, and it is a copy on purpose. The OS boundary
 * lets an app import `@/platform/sdk` and the kernel ABI and nothing else, so the legacy
 * `src/types/crm.ts` is out of reach — but the table is also not really shared knowledge.
 * It is `private.move_crm_opportunity_stage`'s knowledge, and this file's job is to agree
 * with the migration rather than with another client.
 *
 * Two things fall out of the table for free, both of which the RPC would otherwise refuse
 * in postgres error codes:
 *
 *   - WON appears in no list. *'An opportunity is won by accepting its quote, not by
 *     moving its stage'* — so the stage dialog cannot offer it.
 *   - No stage lists itself. *'Opportunity is already at stage %'* — so a no-op move is
 *     never on the menu either.
 *
 * LOST → QUALIFYING is the one way back out of a terminal stage, and it is deliberate:
 * a pilgrim who said no in Ramadan often says yes in Shawwal.
 */
const STAGE_TRANSITIONS: Readonly<Record<Stage, readonly Stage[]>> = {
  NEW: ['QUALIFYING', 'PROPOSAL', 'LOST'],
  QUALIFYING: ['PROPOSAL', 'LOST'],
  PROPOSAL: ['NEGOTIATION', 'QUALIFYING', 'LOST'],
  NEGOTIATION: ['PROPOSAL', 'LOST'],
  WON: [],
  LOST: ['QUALIFYING'],
};

/**
 * What the RPC will set `probability` to. Shown beside each choice so the number is not a
 * surprise after the fact. WON is null because accepting the quote sets it to 100, and
 * this dialog cannot get there.
 */
const STAGE_PROBABILITY: Readonly<Record<Stage, number | null>> = {
  NEW: 10,
  QUALIFYING: 25,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  WON: null,
  LOST: 0,
};

const STAGE_LABEL: Readonly<Record<Stage, Localized>> = {
  NEW: lab('جديدة', 'Nouvelle', 'New'),
  QUALIFYING: lab('قيد التأهيل', 'Qualification', 'Qualifying'),
  PROPOSAL: lab('عرض', 'Proposition', 'Proposal'),
  NEGOTIATION: lab('تفاوض', 'Négociation', 'Negotiation'),
  WON: lab('مكتسبة', 'Gagnée', 'Won'),
  LOST: lab('خسارة', 'Perdue', 'Lost'),
};

/**
 * A stage column as the union every function below takes, or null when the text is
 * something this build does not know.
 *
 * The projections type `stage` as `string`, because the database's CHECK constraint is the
 * authority on that column and a client that narrowed it to six words would start lying the
 * day a seventh is added. This is the one door through, so a stage that arrives unrecognised
 * loses its label and its moves rather than being rendered as a stage it is not.
 */
export const asStage = (text: string): Stage | null =>
  STAGES.find((stage) => stage === text.toUpperCase()) ?? null;

export const stageLabel = (stage: Stage): Localized => STAGE_LABEL[stage];

export const stageProbability = (stage: Stage): number | null => STAGE_PROBABILITY[stage];

/** The moves the server will accept from `from`, verbatim from the table above. */
export const stageChoices = (from: Stage): readonly Stage[] => STAGE_TRANSITIONS[from];

/** Those moves as select options, each carrying the probability the move will write. */
export const stageOptions = (from: Stage): readonly FieldOption[] =>
  STAGE_TRANSITIONS[from].map((stage) => ({ value: stage, label: STAGE_LABEL[stage] }));

// ---------------------------------------------------------------------------
// Converting a lead
// ---------------------------------------------------------------------------

/**
 * `crm.lead.convert` makes a customer, an opportunity and — if the lead named one — a
 * package interest, out of a lead. Only `leadId` is required; everything else on this
 * draft is an opening position for the opportunity the conversion creates, and every
 * blank one is omitted so the RPC's own defaults apply.
 */
export interface ConvertDraft {
  readonly leadId: string;
  readonly title: string;
  readonly packageId: string;
  readonly travelers: string;
  readonly expectedValueDzd: string;
  readonly expectedCloseDate: string;
}

export const emptyConvert = (leadId: string, title = ''): ConvertDraft => ({
  leadId,
  title,
  packageId: '',
  travelers: '1',
  expectedValueDzd: '',
  expectedCloseDate: '',
});

export function convertPayload(draft: ConvertDraft): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = { leadId: draft.leadId };
  const title = trimmed(draft.title);
  if (title !== '') payload.title = title;
  if (trimmed(draft.packageId) !== '') payload.packageId = draft.packageId;
  payload.travelers = count(draft.travelers, 1);
  const value = amount(draft.expectedValueDzd);
  if (value !== null) payload.expectedValueDzd = value;
  if (trimmed(draft.expectedCloseDate) !== '') payload.expectedCloseDate = draft.expectedCloseDate;
  return payload;
}

export const validateConvert = (draft: ConvertDraft): readonly Problem[] =>
  collect((add) => {
    if (count(draft.travelers, 0) < 1) {
      add('travelers', true, 'مسافر واحد على الأقل', 'Au moins un voyageur', 'At least one traveller');
    }
  });

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * `crm.customer.tags` replaces the whole array rather than adding to it, and an absent
 * list is coerced to `[]` by the broker — so clearing every tag is a legal, expressible
 * intention, which is why the editor in `form.ts` leaves `tags` alone and this command
 * owns them outright.
 *
 * Commas and newlines both separate, because a person pasting from a spreadsheet gets
 * one and a person typing gets the other. Duplicates collapse; case is preserved.
 */
export function tagsPayload(id: string, text: string): Readonly<Record<string, unknown>> {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const tag = part.trim();
    if (tag === '' || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return { id, tags };
}

/** The stored array as the text of one input, in the shape `tagsPayload` reads back. */
export const tagsText = (tags: readonly string[]): string => tags.join(', ');

// ---------------------------------------------------------------------------
// Moving a stage
// ---------------------------------------------------------------------------

export interface StageDraft {
  readonly opportunityId: string;
  readonly from: Stage;
  readonly toStage: Stage | '';
  readonly note: string;
  readonly lostReason: string;
}

export const emptyStage = (opportunityId: string, from: Stage): StageDraft => ({
  opportunityId,
  from,
  toStage: '',
  note: '',
  lostReason: '',
});

export function stagePayload(draft: StageDraft): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    opportunityId: draft.opportunityId,
    toStage: draft.toStage,
  };
  const note = trimmed(draft.note);
  if (note !== '') payload.note = note;
  if (draft.toStage === 'LOST') payload.lostReason = trimmed(draft.lostReason);
  return payload;
}

/**
 * *'A lost opportunity requires a reason'* is a `not null` check on the column, not a
 * courtesy — `crm_opportunities_terminal_reason` would refuse the row even if the RPC
 * let it through. Asked for here, before the trip.
 */
export const validateStage = (draft: StageDraft): readonly Problem[] =>
  collect((add) => {
    if (draft.toStage === '') {
      add('toStage', true, 'اختر المرحلة', 'Choisissez une étape', 'Pick a stage');
      return;
    }
    if (draft.toStage === 'LOST' && trimmed(draft.lostReason) === '') {
      add(
        'lostReason',
        true,
        'سبب الخسارة مطلوب',
        'Le motif de la perte est requis',
        'A lost opportunity requires a reason',
      );
    }
    if (draft.toStage === 'LOST') {
      add(
        'lostReason',
        false,
        'ستُلغى المتابعات المفتوحة وتنتهي صلاحية العروض غير المقبولة',
        'Les relances ouvertes seront annulées et les devis non acceptés expireront',
        'Open follow-ups will be cancelled and unaccepted quotes will expire',
      );
    }
  });

// ---------------------------------------------------------------------------
// Sending, declining
// ---------------------------------------------------------------------------

/**
 * `validDays` is a count of days, not a date: the RPC computes `valid_until` as
 * `current_date + p_valid_days` so that the clock starts when the quote is actually sent
 * rather than when the dialog was opened. Fourteen days is the server's default and is
 * left to it when the box is empty.
 */
export const sendPayload = (quoteId: string, validDays: string): Readonly<Record<string, unknown>> => {
  const days = Number.parseInt(trimmed(validDays), 10);
  return Number.isInteger(days) && days > 0 ? { quoteId, validDays: days } : { quoteId };
};

export const validateSend = (lines: number, validDays: string): readonly Problem[] =>
  collect((add) => {
    if (lines === 0) {
      add(
        'lines',
        true,
        'يحتاج العرض إلى سطر واحد على الأقل قبل إرساله',
        'Un devis a besoin d’au moins une ligne avant d’être envoyé',
        'A quote needs at least one line before it can be sent',
      );
    }
    const text = trimmed(validDays);
    if (text === '') return;
    const days = Number.parseInt(text, 10);
    if (!Number.isInteger(days) || days < 1) {
      add('validDays', true, 'عدد أيام غير صالح', 'Nombre de jours invalide', 'Not a number of days');
    }
  });

/** The reason is mandatory server-side. A decline with no reason teaches nobody anything. */
export const declinePayload = (quoteId: string, reason: string): Readonly<Record<string, unknown>> => ({
  quoteId,
  reason: trimmed(reason),
});

export const validateDecline = (reason: string): readonly Problem[] =>
  collect((add) => {
    if (trimmed(reason) === '') {
      add('reason', true, 'السبب مطلوب', 'Le motif est requis', 'A reason is required');
    }
  });

// ---------------------------------------------------------------------------
// Completing a follow-up
// ---------------------------------------------------------------------------

/**
 * The command sets `status = 'DONE'` and stamps `completed_at`, which is why DONE is not
 * on the follow-up editor's status list: `crm_followups_done_has_time` requires the two
 * together and only this command writes both.
 */
export const completePayload = (id: string, note: string): Readonly<Record<string, unknown>> => {
  const text = trimmed(note);
  return text === '' ? { id } : { id, note: text };
};

// ---------------------------------------------------------------------------
// Accepting a quote — the one command that touches money
// ---------------------------------------------------------------------------

/**
 * Accepting a quote is the seam between CRM and the ledger, and it is the reason this app
 * asks for `ledger.post` at all. In one transaction the RPC confirms a booking, records
 * the deposit as a payment, posts that payment's journal through
 * `private.post_payment_journal`, decrements the package's remaining seats, expires every
 * other draft or sent quote on the same opportunity, and marks the opportunity WON.
 *
 * The draft holds one amount rather than two. The RPC takes `p_payment_amount_dzd` and
 * `p_payment_amount_sar` separately and refuses both at once — *'Multi-currency payment
 * must be posted as separate currency transactions'* — and it also refuses the wrong one
 * for the quote: *'This quote is priced in DZD; record the payment in DZD'*. Since the
 * quote's own `currency_code` decides which of the two is legal, the dialog asks for a
 * number and puts it in the right slot itself. There is no way to get that wrong here.
 *
 * A blank amount is a genuine case, not an oversight: a quote can be accepted with no
 * money down. Both parameters default to 0 and `post_payment_journal` is only reached
 * when one of them is positive, so an empty box books the trip and posts nothing.
 */
export interface AcceptDraft {
  readonly quoteId: string;
  readonly currency: string;
  readonly total: number;
  readonly paymentAmount: string;
  readonly paymentMethod: string;
  readonly groupId: string;
  readonly passportNumber: string;
  readonly notes: string;
}

export const emptyAccept = (quoteId: string, currency: string, total: number): AcceptDraft => ({
  quoteId,
  currency,
  total,
  paymentAmount: '',
  paymentMethod: 'CASH',
  groupId: '',
  passportNumber: '',
  notes: '',
});

export function acceptPayload(draft: AcceptDraft): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = { quoteId: draft.quoteId };
  const paid = amount(draft.paymentAmount);
  if (paid !== null) {
    payload[draft.currency === 'SAR' ? 'paymentAmountSar' : 'paymentAmountDzd'] = paid;
    payload.paymentMethod = draft.paymentMethod;
  }
  if (trimmed(draft.groupId) !== '') payload.groupId = draft.groupId;
  const passport = trimmed(draft.passportNumber);
  if (passport !== '') payload.passportNumber = passport;
  const notes = trimmed(draft.notes);
  if (notes !== '') payload.notes = notes;
  return payload;
}

/**
 * `seatsLeft` is the package's `seats_available` and `travelers` the quote's own count.
 * The capacity check is advisory rather than blocking because both numbers are read from
 * a cached page: the seat that looks free here may have gone in the seconds since. The
 * RPC counts for real — *'Package capacity exceeded: % seat(s) left, % requested'* — and
 * that answer is the authoritative one. Saying it early still saves most of the trips.
 */
export function validateAccept(
  draft: AcceptDraft,
  travelers: number,
  seatsLeft: number | null,
): readonly Problem[] {
  return collect((add) => {
    const text = trimmed(draft.paymentAmount);
    if (text !== '') {
      const paid = Number.parseFloat(text);
      if (!Number.isFinite(paid) || paid <= 0) {
        add('paymentAmount', true, 'مبلغ غير صالح', 'Montant invalide', 'Not an amount');
      } else if (paid > draft.total) {
        add(
          'paymentAmount',
          true,
          'المبلغ يتجاوز إجمالي العرض',
          'Le montant dépasse le total du devis',
          'Payment exceeds the quoted total',
        );
      }
      const legal = paymentMethods(draft.currency).some((m) => m.value === draft.paymentMethod);
      if (!legal) {
        add(
          'paymentMethod',
          true,
          'طريقة الدفع لا تقبل هذه العملة',
          'Ce moyen de paiement n’accepte pas cette devise',
          'That payment method cannot settle this currency',
        );
      }
    }
    if (seatsLeft !== null && travelers > seatsLeft) {
      add(
        'seats',
        false,
        `المقاعد المتبقية ${seatsLeft} والمطلوب ${travelers}`,
        `${seatsLeft} place(s) restante(s), ${travelers} demandée(s)`,
        `${seatsLeft} seat(s) left, ${travelers} requested`,
      );
    }
    if (text === '') {
      add(
        'paymentAmount',
        false,
        'سيتم تأكيد الحجز دون تسجيل أي دفعة',
        'La réservation sera confirmée sans paiement enregistré',
        'The booking will be confirmed with no payment recorded',
      );
    }
  });
}

// ---------------------------------------------------------------------------
// The command ids these builders belong to
// ---------------------------------------------------------------------------

export const LIFECYCLE_COMMANDS = {
  convert: 'crm.lead.convert',
  tags: 'crm.customer.tags',
  stage: 'crm.opportunity.stage',
  send: 'crm.quote.send',
  accept: 'crm.quote.accept',
  decline: 'crm.quote.decline',
  complete: 'crm.followup.complete',
} as const satisfies Readonly<Record<string, DataCommandName>>;
