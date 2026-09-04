/**
 * CRM — the forms.
 *
 * Eight entities, one form. The kernel side of this app is already generic — one
 * `crmCrud` factory, eight instances, a jsonb payload that carries whatever columns
 * the caller names — so the app side mirrors it with a field table rather than eight
 * bespoke drafts. Eight `AccountDraft`-shaped interfaces would have been eight
 * near-identical validators over nine hundred lines, and the ninth entity would have
 * been a ninth copy of the same code.
 *
 * Every union below is a CHECK constraint in
 * `supabase/migrations/20260830120000_crm_vertical_slice.sql`, and every `required`
 * mirrors a NOT NULL. That is the whole discipline of this file: a round trip that
 * comes back `22023` tells a person nothing about which of two fields they left
 * blank, so each server refusal is restated here in the language they are reading.
 *
 * Four kinds of column are deliberately absent from the tables.
 *
 * Server-owned. A quote's number is assigned by a trigger whose comment reads "Never
 * trust a client supplied quote number", and `code` on customers and campaigns and
 * `reference` on opportunities default the same way. A field for a value the server
 * discards is a field that lies about who decides.
 *
 * Derived. A quote line's total is a generated column, and a quote's subtotal and
 * total are re-summed from its lines. Only the discount is typed, because only the
 * discount is a decision.
 *
 * Lifecycle. A quote's status, an opportunity's stage, CONVERTED on a lead and DONE
 * on a follow-up belong to a command rather than to an editor: each is a state with
 * money or a customer record behind it. `probability` joins them, because the stage
 * RPC recomputes it from the stage on every move — offering it would be offering a
 * number the next drag silently overwrites. Those seven commands carry payloads of
 * their own shape, and `lifecycle.ts` next door builds them.
 *
 * Scope. Agency and branch are stamped by the scoped-command RPCs from the caller's
 * own staff row. An app that could name them could write into another agency's book.
 *
 * Tags are absent from the customer editor for a different reason: a text array does
 * not survive a jsonb patch cleanly, which is why `crm.customer.tags` exists as its
 * own command with its own coercion. The editor leaves tags to it.
 */
import type { DataCommandName, Localized } from '@/platform/sdk';

/** The eight things this app writes. One table row each, one command family each. */
export type CrmEntity =
  | 'lead'
  | 'customer'
  | 'opportunity'
  | 'quote'
  | 'quoteLine'
  | 'activity'
  | 'followup'
  | 'campaign';

/**
 * How a value is typed, not what it means.
 *
 * The kinds are deliberately coarse — a renderer needs to know whether to draw a
 * line, a paragraph, a list or a calendar, and everything finer than that belongs to
 * the spec's own `min`, `max` and `options`. `money` and `decimal` differ only in what
 * the field is counted in, which is why they are separate: a renderer aligns money to
 * the right and suffixes the currency, and a discount is money while a score is not.
 */
export type FieldKind =
  | 'text'
  | 'multiline'
  | 'select'
  | 'lookup'
  | 'integer'
  | 'money'
  | 'decimal'
  | 'date'
  | 'datetime';

/** Which of the model's maps a `lookup` field resolves its options from. */
export type LookupName = 'customers' | 'leads' | 'opportunities' | 'quotes' | 'packages' | 'campaigns';

export interface FieldOption {
  readonly value: string;
  readonly label: Localized;
}

export interface FieldSpec {
  /** The snake_case column name. This is what the command payload carries. */
  readonly key: string;
  readonly label: Localized;
  readonly kind: FieldKind;
  /** Mirrors NOT NULL with no default. Blank blocks the save. */
  readonly required?: boolean;
  /**
   * Mirrors NOT NULL *with* a default. Blank means "let the default stand" on create and
   * "leave it alone" on update — never null, which the column would refuse with `23502`.
   * Every such field is a select, and its default is one of the options.
   */
  readonly defaulted?: boolean;
  /** For `select`: the CHECK constraint's members, minus any the server owns. */
  readonly options?: readonly FieldOption[];
  readonly lookup?: LookupName;
  /** Said before the fact rather than after: a rule the server enforces later. */
  readonly hint?: Localized;
  /** Spans both columns of the form grid. Paragraphs and long names. */
  readonly wide?: boolean;
  /** Comes from what was selected, not from the typist. Rendered read-only. */
  readonly fixed?: boolean;
  readonly min?: number;
  readonly max?: number;
}

/**
 * A record being edited, before it is anything the server would recognise.
 *
 * Values are all strings, including the numbers and the dates, because "12." is a
 * state a person passes through on the way to "12.5" and a draft that refused to hold
 * it would delete the keystroke. The conversion happens once, in `recordValues`, at
 * the moment the payload is built — not on every keystroke, and not in eight places.
 *
 * `id === null` means create. It is the only flag distinguishing the two, and it also
 * decides whether a blank optional field is omitted or sent as null: omitting on
 * create lets the column default apply, and sending null on update is how a person
 * clears a field they had filled in.
 */
export interface RecordDraft {
  readonly entity: CrmEntity;
  readonly id: string | null;
  readonly values: Readonly<Record<string, string>>;
}

/** Trilingual label, written positionally because it appears two hundred times. */
const lab = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

const opt = (value: string, ar: string, fr: string, en: string): FieldOption => ({
  value,
  label: { ar, fr, en },
});

const field = (
  key: string,
  kind: FieldKind,
  label: Localized,
  extra: Omit<FieldSpec, 'key' | 'kind' | 'label'> = {},
): FieldSpec => ({ key, kind, label, ...extra });

/**
 * The campaign channels, which are also most of the lead sources.
 *
 * One list rather than two, because a lead that arrived from the mosque notice board
 * and a campaign run on the mosque notice board are the same channel seen from the two
 * ends. Where they differ is the website: a campaign is not run on your own site, and a
 * lead very often arrives from it, so WEBSITE is prepended for leads only.
 */
const CHANNELS: readonly FieldOption[] = [
  opt('FACEBOOK', 'فيسبوك', 'Facebook', 'Facebook'),
  opt('INSTAGRAM', 'إنستغرام', 'Instagram', 'Instagram'),
  opt('GOOGLE', 'غوغل', 'Google', 'Google'),
  opt('WHATSAPP', 'واتساب', 'WhatsApp', 'WhatsApp'),
  opt('SMS', 'رسائل قصيرة', 'SMS', 'SMS'),
  opt('EMAIL', 'بريد إلكتروني', 'E-mail', 'E-mail'),
  opt('REFERRAL', 'توصية', 'Recommandation', 'Referral'),
  opt('WALK_IN', 'زيارة مباشرة', 'Visite spontanée', 'Walk-in'),
  opt('EVENT', 'حدث', 'Événement', 'Event'),
  opt('MOSQUE', 'مسجد', 'Mosquée', 'Mosque'),
  opt('OTHER', 'أخرى', 'Autre', 'Other'),
];

/**
 * Lead source is free text in the schema — no CHECK constraint, default WEBSITE.
 *
 * A select is offered anyway, and that is a choice rather than a mirror: a column
 * where one person types "facebook" and the next types "FB" is a column no campaign
 * report can group by, and the cost of the freedom lands on whoever is asked which
 * channel actually works.
 */
const LEAD_SOURCES: readonly FieldOption[] = [
  opt('WEBSITE', 'الموقع', 'Site web', 'Website'),
  ...CHANNELS,
];

/**
 * Lead status, minus CONVERTED.
 *
 * CONVERTED is what `crm.lead.convert` writes when it creates the customer row, and a
 * person who set it by hand would have a lead marked converted with no customer behind
 * it. The status is a description of what happened, so it is only writable by the thing
 * that makes it true.
 */
const LEAD_STATUS: readonly FieldOption[] = [
  opt('NEW', 'جديد', 'Nouveau', 'New'),
  opt('CONTACTED', 'تم التواصل', 'Contacté', 'Contacted'),
  opt('QUALIFIED', 'مؤهل', 'Qualifié', 'Qualified'),
  opt('PROPOSAL', 'عرض', 'Proposition', 'Proposal'),
  opt('LOST', 'خسارة', 'Perdu', 'Lost'),
];

/** Three levels on leads — the schema's CHECK stops at HIGH. */
const LEAD_PRIORITY: readonly FieldOption[] = [
  opt('LOW', 'منخفضة', 'Basse', 'Low'),
  opt('MEDIUM', 'متوسطة', 'Moyenne', 'Medium'),
  opt('HIGH', 'عالية', 'Haute', 'High'),
];

/** Four on follow-ups, where URGENT is the one that earns a red row in the diary. */
const FOLLOWUP_PRIORITY: readonly FieldOption[] = [
  ...LEAD_PRIORITY,
  opt('URGENT', 'عاجلة', 'Urgente', 'Urgent'),
];

const CUSTOMER_TYPE: readonly FieldOption[] = [
  opt('INDIVIDUAL', 'فرد', 'Particulier', 'Individual'),
  opt('FAMILY', 'عائلة', 'Famille', 'Family'),
  opt('CORPORATE', 'شركة', 'Entreprise', 'Corporate'),
];

const CUSTOMER_STATUS: readonly FieldOption[] = [
  opt('ACTIVE', 'نشط', 'Actif', 'Active'),
  opt('DORMANT', 'خامل', 'Inactif', 'Dormant'),
  opt('BLOCKED', 'محجوب', 'Bloqué', 'Blocked'),
];

/** The two currencies the ledger has receivable accounts for: 1200 and 1201. */
const CURRENCIES: readonly FieldOption[] = [
  opt('DZD', 'دينار جزائري', 'Dinar algérien', 'Algerian dinar'),
  opt('SAR', 'ريال سعودي', 'Riyal saoudien', 'Saudi riyal'),
];

/**
 * Activity kinds, minus SYSTEM.
 *
 * SYSTEM is in the CHECK constraint because the lifecycle RPCs write it — a stage move
 * and an acceptance both leave one behind. It is the log's own handwriting, and offering
 * it in a dropdown would let a person forge it.
 */
const ACTIVITY_TYPES: readonly FieldOption[] = [
  opt('CALL', 'اتصال', 'Appel', 'Call'),
  opt('EMAIL', 'بريد', 'E-mail', 'E-mail'),
  opt('MEETING', 'اجتماع', 'Rendez-vous', 'Meeting'),
  opt('WHATSAPP', 'واتساب', 'WhatsApp', 'WhatsApp'),
  opt('SMS', 'رسالة قصيرة', 'SMS', 'SMS'),
  opt('VISIT', 'زيارة', 'Visite', 'Visit'),
  opt('NOTE', 'ملاحظة', 'Note', 'Note'),
];

/** Who called whom. Nullable in the schema: a note has no direction. */
const DIRECTIONS: readonly FieldOption[] = [
  opt('INBOUND', 'واردة', 'Entrant', 'Inbound'),
  opt('OUTBOUND', 'صادرة', 'Sortant', 'Outbound'),
];

const OUTCOMES: readonly FieldOption[] = [
  opt('CONNECTED', 'تم الاتصال', 'Joint', 'Connected'),
  opt('NO_ANSWER', 'لا جواب', 'Sans réponse', 'No answer'),
  opt('INTERESTED', 'مهتم', 'Intéressé', 'Interested'),
  opt('NOT_INTERESTED', 'غير مهتم', 'Pas intéressé', 'Not interested'),
  opt('FOLLOW_UP', 'يتطلب متابعة', 'À relancer', 'Needs follow-up'),
  opt('CLOSED', 'مغلق', 'Clos', 'Closed'),
];

/**
 * Follow-up status, minus DONE.
 *
 * `crm_followups_done_has_time` requires `completed_at` alongside DONE, and only
 * `crm.followup.complete` sets both. CANCELLED stays here because abandoning a follow-up
 * is an edit rather than an act — nothing else in the system depends on it.
 */
const FOLLOWUP_STATUS: readonly FieldOption[] = [
  opt('OPEN', 'مفتوحة', 'Ouverte', 'Open'),
  opt('CANCELLED', 'ملغاة', 'Annulée', 'Cancelled'),
];

const CAMPAIGN_STATUS: readonly FieldOption[] = [
  opt('PLANNED', 'مخططة', 'Planifiée', 'Planned'),
  opt('ACTIVE', 'نشطة', 'Active', 'Active'),
  opt('PAUSED', 'موقوفة', 'En pause', 'Paused'),
  opt('COMPLETED', 'منتهية', 'Terminée', 'Completed'),
  opt('CANCELLED', 'ملغاة', 'Annulée', 'Cancelled'),
];

/**
 * The six seeded payment methods, with the currencies each one is allowed to settle in.
 *
 * This is a select rather than a text box for a reason worth stating, because the failure
 * it prevents is silent. `private.resolve_payment_account` looks the method up as
 * `upper(replace(method,' ','_'))` against `payment_method_accounts`; when nothing
 * matches it does not refuse — it falls back to the cash account, 1100 for DZD and 1101
 * for SAR. So "Virement" typed by hand posts a bank transfer to the cash account and the
 * journal balances, which is the worst kind of wrong: arithmetically clean and factually
 * false. Only codes the reference table knows are offered.
 *
 * The scope comes from `public.payment_methods.currency_scope`: a cheque, a CCP transfer
 * and BaridiMob are Algerian instruments and cannot settle a riyal quote.
 */
export interface PaymentMethodOption extends FieldOption {
  readonly currencies: readonly string[];
}

const PAYMENT_METHODS: readonly PaymentMethodOption[] = [
  { ...opt('CASH', 'نقدا', 'Espèces', 'Cash'), currencies: ['DZD', 'SAR'] },
  { ...opt('BANK_TRANSFER', 'تحويل بنكي', 'Virement', 'Bank transfer'), currencies: ['DZD', 'SAR'] },
  { ...opt('CARD', 'بطاقة', 'Carte', 'Card'), currencies: ['DZD', 'SAR'] },
  { ...opt('CHECK', 'شيك', 'Chèque', 'Cheque'), currencies: ['DZD'] },
  { ...opt('CCP', 'ح ب ج', 'CCP', 'CCP'), currencies: ['DZD'] },
  { ...opt('BARIDIMOB', 'بريدي موب', 'BaridiMob', 'BaridiMob'), currencies: ['DZD'] },
];

/** The methods that can settle a quote priced in `currency`. Never empty: cash is both. */
export const paymentMethods = (currency: string): readonly PaymentMethodOption[] =>
  PAYMENT_METHODS.filter((method) => method.currencies.includes(currency === 'SAR' ? 'SAR' : 'DZD'));

/**
 * Leads. Nothing here is NOT NULL — `first_name`, `last_name` and `phone` all default to
 * the empty string — so nothing is marked required, and the "who is this?" objection is
 * raised as an advisory problem in `validateRecord` instead of as a locked button.
 *
 * `assigned_to` and `owner_id` are absent throughout the eight tables for the same
 * reason: they are staff uuids, and this app has no dataset of staff to resolve them
 * from. A uuid field a person has to paste into is not an assignment feature.
 */
const LEAD_FIELDS: readonly FieldSpec[] = [
  field('first_name', 'text', lab('الاسم', 'Prénom', 'First name')),
  field('last_name', 'text', lab('اللقب', 'Nom', 'Last name')),
  field('phone', 'text', lab('الهاتف', 'Téléphone', 'Phone')),
  field('email', 'text', lab('البريد الإلكتروني', 'E-mail', 'E-mail')),
  field('source', 'select', lab('المصدر', 'Source', 'Source'), { options: LEAD_SOURCES }),
  field('status', 'select', lab('الحالة', 'Statut', 'Status'), { options: LEAD_STATUS }),
  field('priority', 'select', lab('الأولوية', 'Priorité', 'Priority'), { options: LEAD_PRIORITY }),
  field('score', 'integer', lab('التقييم', 'Score', 'Score'), { min: 0, max: 100 }),
  field('next_action_at', 'datetime', lab('الإجراء التالي', 'Prochaine action', 'Next action')),
  field('campaign_id', 'lookup', lab('الحملة', 'Campagne', 'Campaign'), { lookup: 'campaigns' }),
  field('lost_reason', 'text', lab('سبب الخسارة', 'Raison de la perte', 'Lost reason'), { wide: true }),
  field('notes', 'multiline', lab('ملاحظات', 'Notes', 'Notes'), { wide: true }),
];

/** Customers. `full_name` is the one NOT NULL, and `crm_customers_name_present` also
 *  refuses whitespace — so blank and "   " are both blocked, in that order. */
const CUSTOMER_FIELDS: readonly FieldSpec[] = [
  field('full_name', 'text', lab('الاسم الكامل', 'Nom complet', 'Full name'), {
    required: true,
    wide: true,
  }),
  field('full_name_ar', 'text', lab('الاسم بالعربية', 'Nom en arabe', 'Arabic name'), { wide: true }),
  field('customer_type', 'select', lab('النوع', 'Type', 'Type'), {
    options: CUSTOMER_TYPE,
    defaulted: true,
  }),
  field('status', 'select', lab('الحالة', 'Statut', 'Status'), {
    options: CUSTOMER_STATUS,
    defaulted: true,
  }),
  field('phone', 'text', lab('الهاتف', 'Téléphone', 'Phone')),
  field('email', 'text', lab('البريد الإلكتروني', 'E-mail', 'E-mail')),
  field('wilaya', 'text', lab('الولاية', 'Wilaya', 'Wilaya')),
  field('address', 'text', lab('العنوان', 'Adresse', 'Address'), { wide: true }),
  field('source', 'select', lab('المصدر', 'Source', 'Source'), { options: LEAD_SOURCES }),
  field('campaign_id', 'lookup', lab('الحملة', 'Campagne', 'Campaign'), { lookup: 'campaigns' }),
  field('notes', 'multiline', lab('ملاحظات', 'Notes', 'Notes'), { wide: true }),
];

/** Opportunities. `stage` and `probability` are absent: the stage RPC owns both, and it
 *  recomputes the second from the first on every move. */
const OPPORTUNITY_FIELDS: readonly FieldSpec[] = [
  field('customer_id', 'lookup', lab('العميل', 'Client', 'Customer'), {
    lookup: 'customers',
    required: true,
  }),
  field('title', 'text', lab('العنوان', 'Intitulé', 'Title'), { required: true, wide: true }),
  field('package_id', 'lookup', lab('الباقة', 'Forfait', 'Package'), { lookup: 'packages' }),
  field('campaign_id', 'lookup', lab('الحملة', 'Campagne', 'Campaign'), { lookup: 'campaigns' }),
  field('travelers', 'integer', lab('عدد المسافرين', 'Voyageurs', 'Travellers'), {
    required: true,
    min: 1,
  }),
  field('expected_value_dzd', 'money', lab('القيمة المتوقعة', 'Valeur attendue', 'Expected value'), {
    min: 0,
  }),
  field('expected_close_date', 'date', lab('تاريخ الإغلاق المتوقع', 'Clôture prévue', 'Expected close')),
  field('notes', 'multiline', lab('ملاحظات', 'Notes', 'Notes'), { wide: true }),
];

/**
 * Quotes. Both foreign keys are `fixed`, which is the same as saying a quote is raised
 * from an opportunity rather than assembled from scratch: the opportunity supplies its
 * own id and its customer's, and a quote whose customer differs from its opportunity's
 * would be a quote addressed to the wrong person with nothing in the schema to stop it.
 *
 * `discount_amount` carries a hint instead of a `max`, because the subtotal it is checked
 * against is zero until the lines exist — a client-side cap would refuse every discount
 * typed before the first line, which is exactly when people type them.
 */
const QUOTE_FIELDS: readonly FieldSpec[] = [
  field('opportunity_id', 'lookup', lab('الفرصة', 'Opportunité', 'Opportunity'), {
    lookup: 'opportunities',
    required: true,
    fixed: true,
  }),
  field('customer_id', 'lookup', lab('العميل', 'Client', 'Customer'), {
    lookup: 'customers',
    required: true,
    fixed: true,
  }),
  field('package_id', 'lookup', lab('الباقة', 'Forfait', 'Package'), {
    lookup: 'packages',
    hint: lab(
      'مطلوبة قبل قبول العرض',
      'Requis avant l’acceptation du devis',
      'Required before the quote can be accepted',
    ),
  }),
  field('currency_code', 'select', lab('العملة', 'Devise', 'Currency'), {
    options: CURRENCIES,
    defaulted: true,
  }),
  field('travelers', 'integer', lab('عدد المسافرين', 'Voyageurs', 'Travellers'), {
    required: true,
    min: 1,
  }),
  field('discount_amount', 'money', lab('الخصم', 'Remise', 'Discount'), {
    min: 0,
    hint: lab(
      'لا يمكن أن يتجاوز مجموع البنود',
      'Ne peut dépasser le sous-total des lignes',
      'Cannot exceed the line subtotal',
    ),
  }),
  field('valid_until', 'date', lab('صالح حتى', 'Valable jusqu’au', 'Valid until')),
  field('terms', 'multiline', lab('الشروط', 'Conditions', 'Terms'), { wide: true }),
  field('notes', 'multiline', lab('ملاحظات', 'Notes', 'Notes'), { wide: true }),
];

/**
 * Quote lines. `line_total` is absent because it is `generated always as (round(quantity *
 * unit_price, 2)) stored` — a column the server computes and rejects on write.
 *
 * `quantity`'s floor is 0.01 rather than 0, and that is not a rounder-than-the-server
 * guess: the column is `numeric(10,2)` with `check (quantity > 0)`, so one hundredth is
 * genuinely the smallest quantity that exists. Writing `min: 0` would have offered a zero
 * the server refuses; writing `min: 1` would have refused the half-seat an infant occupies.
 */
const QUOTE_LINE_FIELDS: readonly FieldSpec[] = [
  field('quote_id', 'lookup', lab('العرض', 'Devis', 'Quote'), {
    lookup: 'quotes',
    required: true,
    fixed: true,
  }),
  field('description', 'text', lab('الوصف', 'Description', 'Description'), {
    required: true,
    wide: true,
  }),
  field('quantity', 'decimal', lab('الكمية', 'Quantité', 'Quantity'), { required: true, min: 0.01 }),
  field('unit_price', 'money', lab('سعر الوحدة', 'Prix unitaire', 'Unit price'), {
    required: true,
    min: 0,
  }),
  field('package_id', 'lookup', lab('الباقة', 'Forfait', 'Package'), { lookup: 'packages' }),
  field('sort_order', 'integer', lab('الترتيب', 'Ordre', 'Sort order'), { min: 0 }),
];

/**
 * Activities. Four targets are offered and only three of them count: the CHECK is
 * `customer_id is not null or lead_id is not null or opportunity_id is not null`, so a
 * quote alone is not a target. `validateRecord` says so before the round trip rather than
 * letting `23514` come back and mean nothing.
 *
 * `occurred_at` defaults to `now()` on the server, which is why it is offered but not
 * required — the common case is a call being logged as it ends, and the field exists for
 * the other case, a call being written up the next morning.
 */
const ACTIVITY_FIELDS: readonly FieldSpec[] = [
  field('activity_type', 'select', lab('النوع', 'Type', 'Type'), {
    options: ACTIVITY_TYPES,
    defaulted: true,
  }),
  field('subject', 'text', lab('الموضوع', 'Objet', 'Subject'), { required: true, wide: true }),
  field('customer_id', 'lookup', lab('العميل', 'Client', 'Customer'), { lookup: 'customers' }),
  field('lead_id', 'lookup', lab('العميل المحتمل', 'Prospect', 'Lead'), { lookup: 'leads' }),
  field('opportunity_id', 'lookup', lab('الفرصة', 'Opportunité', 'Opportunity'), {
    lookup: 'opportunities',
  }),
  field('quote_id', 'lookup', lab('العرض', 'Devis', 'Quote'), { lookup: 'quotes' }),
  field('direction', 'select', lab('الاتجاه', 'Sens', 'Direction'), { options: DIRECTIONS }),
  field('outcome', 'select', lab('النتيجة', 'Résultat', 'Outcome'), { options: OUTCOMES }),
  field('duration_minutes', 'integer', lab('المدة (دقائق)', 'Durée (min)', 'Duration (min)'), {
    min: 0,
  }),
  field('occurred_at', 'datetime', lab('وقت الحدوث', 'Survenu le', 'Occurred at')),
  field('body', 'multiline', lab('التفاصيل', 'Détails', 'Details'), { wide: true }),
];

/**
 * Follow-ups. `due_at` is the one `not null` column in the eight tables with no default at
 * all, which makes it the only date a person is genuinely obliged to type: a follow-up
 * without a time is a wish. The three targets carry the same OR-check as activities.
 */
const FOLLOWUP_FIELDS: readonly FieldSpec[] = [
  field('title', 'text', lab('العنوان', 'Intitulé', 'Title'), { required: true, wide: true }),
  field('due_at', 'datetime', lab('تاريخ الاستحقاق', 'Échéance', 'Due at'), { required: true }),
  field('priority', 'select', lab('الأولوية', 'Priorité', 'Priority'), {
    options: FOLLOWUP_PRIORITY,
    defaulted: true,
  }),
  field('status', 'select', lab('الحالة', 'Statut', 'Status'), {
    options: FOLLOWUP_STATUS,
    defaulted: true,
  }),
  field('customer_id', 'lookup', lab('العميل', 'Client', 'Customer'), { lookup: 'customers' }),
  field('lead_id', 'lookup', lab('العميل المحتمل', 'Prospect', 'Lead'), { lookup: 'leads' }),
  field('opportunity_id', 'lookup', lab('الفرصة', 'Opportunité', 'Opportunity'), {
    lookup: 'opportunities',
  }),
  field('notes', 'multiline', lab('ملاحظات', 'Notes', 'Notes'), { wide: true }),
];

/**
 * Campaigns. `spend_dzd` is typed rather than derived, because nothing in this schema
 * knows what an advertisement cost — the number arrives on an invoice from Facebook and
 * somebody enters it. `crm_campaigns_date_order` is mirrored in `validateRecord`.
 */
const CAMPAIGN_FIELDS: readonly FieldSpec[] = [
  field('name', 'text', lab('الاسم', 'Nom', 'Name'), { required: true, wide: true }),
  field('channel', 'select', lab('القناة', 'Canal', 'Channel'), {
    options: CHANNELS,
    defaulted: true,
  }),
  field('status', 'select', lab('الحالة', 'Statut', 'Status'), {
    options: CAMPAIGN_STATUS,
    defaulted: true,
  }),
  field('start_date', 'date', lab('تاريخ البداية', 'Début', 'Start date')),
  field('end_date', 'date', lab('تاريخ النهاية', 'Fin', 'End date')),
  field('budget_dzd', 'money', lab('الميزانية', 'Budget', 'Budget'), { min: 0 }),
  field('spend_dzd', 'money', lab('المصروف', 'Dépensé', 'Spend'), { min: 0 }),
  field('target_segment', 'text', lab('الفئة المستهدفة', 'Segment ciblé', 'Target segment'), {
    wide: true,
  }),
  field('notes', 'multiline', lab('ملاحظات', 'Notes', 'Notes'), { wide: true }),
];

/** The eight tables, keyed by the entity the editor was opened for. */
export const ENTITY_FIELDS: Readonly<Record<CrmEntity, readonly FieldSpec[]>> = {
  lead: LEAD_FIELDS,
  customer: CUSTOMER_FIELDS,
  opportunity: OPPORTUNITY_FIELDS,
  quote: QUOTE_FIELDS,
  quoteLine: QUOTE_LINE_FIELDS,
  activity: ACTIVITY_FIELDS,
  followup: FOLLOWUP_FIELDS,
  campaign: CAMPAIGN_FIELDS,
};

/** What the title bar of the editor says, per entity, in the two directions. */
export const ENTITY_TITLE: Readonly<Record<CrmEntity, Localized>> = {
  lead: lab('عميل محتمل', 'Prospect', 'Lead'),
  customer: lab('عميل', 'Client', 'Customer'),
  opportunity: lab('فرصة', 'Opportunité', 'Opportunity'),
  quote: lab('عرض سعر', 'Devis', 'Quote'),
  quoteLine: lab('بند العرض', 'Ligne de devis', 'Quote line'),
  activity: lab('تواصل', 'Échange', 'Activity'),
  followup: lab('متابعة', 'Relance', 'Follow-up'),
  campaign: lab('حملة', 'Campagne', 'Campaign'),
};

/**
 * The label an option code was written with — for a grid cell that shows the code.
 *
 * The option tables above are private on purpose: a select reads its own `FieldSpec`, and
 * exporting thirteen of them would invite a second copy of the same vocabulary. This is the
 * one seam a *reader* needs, because a badge reading `NOT_INTERESTED` is a database talking
 * to a salesperson.
 *
 * The value is upper-cased first: the projections lower-case enums through the shared
 * `status()` guard so `'POSTED'` and `'posted'` compare equal, while these tables hold the
 * column's own upper-case spelling. `null` means nothing matched — which is exactly what
 * happens for the codes these tables deliberately omit: a lead's `CONVERTED`, an activity's
 * `SYSTEM`, a follow-up's `DONE`, each written only by the command that makes it true. Show
 * the raw code there. A blank cell is worse than an unfamiliar word.
 */
export function optionLabel(entity: CrmEntity, key: string, value: string): Localized | null {
  if (value === '') return null;
  const spec = ENTITY_FIELDS[entity].find((f) => f.key === key);
  const wanted = value.toUpperCase();
  return spec?.options?.find((o) => o.value.toUpperCase() === wanted)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Drafts: the text a person is typing, and the values that text becomes
// ---------------------------------------------------------------------------

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * `2026-09-03T14:30:00+00:00` → `2026-09-03T14:30`, on the reader's own clock.
 *
 * A `datetime-local` input has no timezone, so the only honest thing to put in it is the
 * local wall clock — the same instant a person would read off the wall behind the desk.
 */
const localInput = (value: unknown): string => {
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) return '';
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

/** `2026-09-03T14:30` → an instant. A wall clock is read on the reader's own clock. */
const instant = (text: string): string | null => {
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

/** A column value as the text of an input. Dates are sliced, not reformatted. */
const inputText = (kind: FieldKind, value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (kind === 'datetime') return localInput(value);
  if (kind === 'date') return String(value).slice(0, 10);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

/**
 * Input text as the value the column wants. A number that will not parse becomes `null`
 * rather than `NaN`, which json cannot carry and postgres would refuse anyway — and
 * `validateRecord` has already blocked the save by the time that matters.
 */
const typed = (kind: FieldKind, text: string): unknown => {
  switch (kind) {
    case 'integer': {
      const n = Number.parseInt(text, 10);
      return Number.isFinite(n) ? n : null;
    }
    case 'money':
    case 'decimal': {
      const n = Number.parseFloat(text);
      return Number.isFinite(n) ? n : null;
    }
    case 'datetime':
      return instant(text);
    default:
      return text;
  }
};

/** A blank draft. `seed` pre-fills the keys a caller already knows — a quote line opened
 *  from a quote arrives with `quote_id` filled and `fixed`. */
export function emptyRecord(
  entity: CrmEntity,
  seed: Readonly<Record<string, string>> = {},
): RecordDraft {
  const values: Record<string, string> = {};
  for (const spec of ENTITY_FIELDS[entity]) values[spec.key] = seed[spec.key] ?? '';
  return { entity, id: null, values };
}

/** An existing row as a draft. Columns the editor does not offer are simply not read. */
export function recordFrom(entity: CrmEntity, row: Readonly<Record<string, unknown>>): RecordDraft {
  const values: Record<string, string> = {};
  for (const spec of ENTITY_FIELDS[entity]) values[spec.key] = inputText(spec.kind, row[spec.key]);
  const id = row.id;
  return { entity, id: typeof id === 'string' ? id : null, values };
}

export const patchRecord = (draft: RecordDraft, key: string, text: string): RecordDraft => ({
  ...draft,
  values: { ...draft.values, [key]: text },
});

/**
 * The `values` object the CRUD bindings hand to `p_payload`.
 *
 * A blank field means two different things and the difference is the whole reason this
 * function is not a one-liner. On create it means "say nothing and let the column default
 * apply" — send `full_name: null` to a NOT NULL column and postgres answers `23502`. On
 * update it means "clear this", which is a real intention and null is how it is spelled —
 * except for the columns that are NOT NULL *with* a default, where clearing is not a thing
 * that can happen and blank can only mean "leave it alone".
 */
export function recordValues(draft: RecordDraft): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const spec of ENTITY_FIELDS[draft.entity]) {
    const text = (draft.values[spec.key] ?? '').trim();
    if (text === '') {
      if (draft.id !== null && !spec.required && !spec.defaulted) values[spec.key] = null;
      continue;
    }
    values[spec.key] = typed(spec.kind, text);
  }
  return values;
}

/** `{ values }` creates; `{ id, values }` updates. The broker's factory reads exactly this. */
export const recordPayload = (draft: RecordDraft): Readonly<Record<string, unknown>> =>
  draft.id === null ? { values: recordValues(draft) } : { id: draft.id, values: recordValues(draft) };

/** Whether two drafts hold different text. Drives `setDirty`, and the discard prompt. */
export const recordChanged = (a: RecordDraft, b: RecordDraft): boolean =>
  Object.keys({ ...a.values, ...b.values }).some(
    (key) => (a.values[key] ?? '') !== (b.values[key] ?? ''),
  );

// ---------------------------------------------------------------------------
// Validation: every server refusal, said before the round trip
// ---------------------------------------------------------------------------

/**
 * Either a `FieldSpec.key` — so the editor can mark the input that caused it — or one of
 * the two synthetic markers below, which belong to the record rather than to any one field.
 */
export type ProblemField = string;

/** The OR-check across three target columns. No single input owns it. */
export const PROBLEM_TARGET = 'target';
/** "Who is this?" on a lead, where every column is nullable and none of them is a person. */
export const PROBLEM_IDENTITY = 'identity';

export interface Problem {
  readonly field: ProblemField;
  readonly text: Localized;
  /** A blocking problem disables the save. An advisory one is printed and ignored. */
  readonly blocking: boolean;
}

export const blocks = (problems: readonly Problem[]): boolean =>
  problems.some((problem) => problem.blocking);

type Sink = (field: ProblemField, blocking: boolean, ar: string, fr: string, en: string) => void;

const numeric = (kind: FieldKind): boolean =>
  kind === 'integer' || kind === 'money' || kind === 'decimal';

/** A number that will not parse, or parses outside the column's own CHECK. */
function numberProblems(spec: FieldSpec, text: string, add: Sink): void {
  const value = Number(text);
  if (!Number.isFinite(value)) {
    add(spec.key, true, 'قيمة رقمية غير صالحة', 'Valeur numérique invalide', 'Not a number');
    return;
  }
  if (spec.kind === 'integer' && !Number.isInteger(value)) {
    add(spec.key, true, 'عدد صحيح مطلوب', 'Nombre entier requis', 'Whole number required');
    return;
  }
  if (spec.min !== undefined && value < spec.min) {
    add(spec.key, true, `الحد الأدنى ${spec.min}`, `Minimum ${spec.min}`, `Minimum ${spec.min}`);
  }
  if (spec.max !== undefined && value > spec.max) {
    add(spec.key, true, `الحد الأقصى ${spec.max}`, `Maximum ${spec.max}`, `Maximum ${spec.max}`);
  }
}

/** The rules that come from the field specs alone: NOT NULL, and the numeric CHECKs. */
function fieldProblems(draft: RecordDraft, add: Sink): void {
  for (const spec of ENTITY_FIELDS[draft.entity]) {
    const text = (draft.values[spec.key] ?? '').trim();
    if (text === '') {
      if (spec.required) add(spec.key, true, 'مطلوب', 'Requis', 'Required');
      continue;
    }
    if (numeric(spec.kind)) numberProblems(spec, text, add);
  }
}

/**
 * `crm_activities_target_present` and `crm_followups_target_present`, both of which count
 * exactly three columns. The activity editor offers a fourth lookup, `quote_id`, and a
 * quote on its own does not satisfy the check — so a note filed against a quote and
 * nothing else would come back as `23514`, a constraint name and no explanation. This says
 * it in words, and names the three columns that would fix it.
 */
function targetProblem(draft: RecordDraft, add: Sink): void {
  const filled = ['customer_id', 'lead_id', 'opportunity_id'].some(
    (key) => (draft.values[key] ?? '').trim() !== '',
  );
  if (filled) return;
  add(
    PROBLEM_TARGET,
    true,
    'اختر عميلا أو عميلا محتملا أو فرصة',
    'Choisissez un client, un prospect ou une opportunité',
    'Pick a customer, a lead or an opportunity',
  );
}

/** The rules that belong to one table and cannot be read off a field spec. */
function entityProblems(draft: RecordDraft, add: Sink): void {
  const value = (key: string): string => (draft.values[key] ?? '').trim();

  if (draft.entity === 'activity' || draft.entity === 'followup') targetProblem(draft, add);

  if (draft.entity === 'campaign') {
    const start = value('start_date');
    const end = value('end_date');
    // crm_campaigns_date_order. ISO dates compare correctly as text; that is the point of ISO.
    if (start !== '' && end !== '' && end < start) {
      add(
        'end_date',
        true,
        'تاريخ النهاية قبل تاريخ البداية',
        'La fin précède le début',
        'The end date is before the start date',
      );
    }
  }

  if (draft.entity === 'lead' && draft.id === null) {
    const named = value('first_name') !== '' || value('last_name') !== '';
    if (!named && value('phone') === '' && value('email') === '') {
      add(
        PROBLEM_IDENTITY,
        false,
        'لا اسم ولا هاتف ولا بريد: لن يمكن التعرف على هذا العميل المحتمل',
        'Ni nom, ni téléphone, ni e-mail : ce prospect sera introuvable',
        'No name, phone or e-mail — nobody will be able to tell who this lead is',
      );
    }
  }
}

/**
 * Blocking problems first, deliberately: the editor prints the list in order, and the first
 * line of it should be the one that is stopping the save rather than a remark about it.
 */
export function validateRecord(draft: RecordDraft): readonly Problem[] {
  const problems: Problem[] = [];
  const add: Sink = (field, blocking, ar, fr, en) => {
    problems.push({ field, blocking, text: { ar, fr, en } });
  };
  fieldProblems(draft, add);
  entityProblems(draft, add);
  return [...problems.filter((problem) => problem.blocking), ...problems.filter((p) => !p.blocking)];
}

// ---------------------------------------------------------------------------
// Which command a draft is saved with
// ---------------------------------------------------------------------------

const CREATE_COMMAND: Readonly<Record<CrmEntity, DataCommandName>> = {
  lead: 'crm.lead.create',
  customer: 'crm.customer.create',
  opportunity: 'crm.opportunity.create',
  quote: 'crm.quote.create',
  quoteLine: 'crm.quoteLine.create',
  activity: 'crm.activity.log',
  followup: 'crm.followup.create',
  campaign: 'crm.campaign.create',
};

/**
 * `activity` is null, and that is the schema's opinion rather than an omission: the broker
 * exposes create and delete for `crm_activities` and no update at all, because a
 * communication log whose entries can be rewritten is not a log. A call that went the other
 * way is a second entry, not an edit of the first.
 */
const UPDATE_COMMAND: Readonly<Record<CrmEntity, DataCommandName | null>> = {
  lead: 'crm.lead.update',
  customer: 'crm.customer.update',
  opportunity: 'crm.opportunity.update',
  quote: 'crm.quote.update',
  quoteLine: 'crm.quoteLine.update',
  activity: null,
  followup: 'crm.followup.update',
  campaign: 'crm.campaign.update',
};

const DELETE_COMMAND: Readonly<Record<CrmEntity, DataCommandName>> = {
  lead: 'crm.lead.delete',
  customer: 'crm.customer.delete',
  opportunity: 'crm.opportunity.delete',
  quote: 'crm.quote.delete',
  quoteLine: 'crm.quoteLine.delete',
  activity: 'crm.activity.delete',
  followup: 'crm.followup.delete',
  campaign: 'crm.campaign.delete',
};

/** The command a draft saves with, or null when this record cannot be edited at all. */
export const commandFor = (entity: CrmEntity, id: string | null): DataCommandName | null =>
  id === null ? CREATE_COMMAND[entity] : UPDATE_COMMAND[entity];

/** Whether the editor may be opened on an existing row. False for activities. */
export const canEdit = (entity: CrmEntity): boolean => UPDATE_COMMAND[entity] !== null;

export const deleteCommandFor = (entity: CrmEntity): DataCommandName => DELETE_COMMAND[entity];

