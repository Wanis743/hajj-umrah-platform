/**
 * Every union in the migration, translated once.
 *
 * Exhaustive `Record`s over the unions in `./types`, so a state added to a CHECK constraint
 * and not added here fails typecheck instead of rendering a raw SQL token to a clerk. That
 * is the same guarantee `./tones` gives for colour, and the two files are deliberately
 * parallel: if one has a key the other lacks, the compiler says so.
 *
 * Plain data rather than the hook the admin shell used. `dmsFormat.ts` built these tables
 * inside `useDmsLabels()`, which meant ten `Record`s were reallocated on every render of
 * every screen and none of them could be read outside a component. Here the words are
 * `Localized` triples and the choosing happens at the call site through the runtime's `t`,
 * which is what every other app in the OS does.
 */
import type { Localized } from '@/platform/sdk';
import type {
  DmsConfidentiality,
  DmsDocumentRelation,
  DmsExtractionStatus,
  DmsFieldReviewState,
  DmsJobReviewState,
  DmsLinkEntityType,
  DmsLinkRelation,
  DmsPackageStatus,
  DmsReviewStatus,
  DmsUploadState,
  DmsView,
} from './types';

/** Argument order is Arabic, French, English — the same order as `text()` in a manifest. */
const w = (ar: string, fr: string, en: string): Localized => ({ ar, fr, en });

/* ------------------------------------------------------------------ *
 * The document itself
 * ------------------------------------------------------------------ */

export const REVIEW_LABEL: Readonly<Record<DmsReviewStatus, Localized>> = {
  DRAFT: w('مسودة', 'Brouillon', 'Draft'),
  PENDING_REVIEW: w('بانتظار المراجعة', 'En attente', 'Pending review'),
  UNDER_REVIEW: w('قيد المراجعة', 'En révision', 'Under review'),
  APPROVED: w('معتمد', 'Approuvé', 'Approved'),
  REJECTED: w('مرفوض', 'Rejeté', 'Rejected'),
  CHANGES_REQUESTED: w('تعديلات مطلوبة', 'Modifications demandées', 'Changes requested'),
  EXPIRED: w('منتهي', 'Expiré', 'Expired'),
  SUPERSEDED: w('مستبدل', 'Remplacé', 'Superseded'),
};

export const CONFIDENTIALITY_LABEL: Readonly<Record<DmsConfidentiality, Localized>> = {
  PUBLIC: w('عام', 'Public', 'Public'),
  INTERNAL: w('داخلي', 'Interne', 'Internal'),
  CONFIDENTIAL: w('سري', 'Confidentiel', 'Confidential'),
  RESTRICTED: w('مقيّد', 'Restreint', 'Restricted'),
};

export const UPLOAD_STATE_LABEL: Readonly<Record<DmsUploadState, Localized>> = {
  RESERVED: w('محجوز', 'Réservé', 'Reserved'),
  UPLOADED: w('مرفوع', 'Téléversé', 'Uploaded'),
  LEGACY: w('قديم', 'Historique', 'Legacy'),
  FAILED: w('فاشل', 'Échoué', 'Failed'),
};

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

/** Lowercase keys because the extraction queue's CHECK is lowercase, as in `./tones`. */
export const EXTRACTION_LABEL: Readonly<Record<DmsExtractionStatus, Localized>> = {
  pending: w('بانتظار', 'En attente', 'Pending'),
  processing: w('قيد المعالجة', 'En cours', 'Processing'),
  completed: w('مكتمل', 'Terminé', 'Completed'),
  failed: w('فاشل', 'Échoué', 'Failed'),
};

/**
 * How far a human has got through one job's fields.
 *
 * Authored here rather than carried over: the admin shell showed the raw
 * `PARTIALLY_REVIEWED` token, which is the one state a reviewer needs to read at a glance
 * because it is the queue they have not finished.
 */
export const JOB_REVIEW_LABEL: Readonly<Record<DmsJobReviewState, Localized>> = {
  NOT_REVIEWED: w('لم تُراجع', 'Non revue', 'Not reviewed'),
  PARTIALLY_REVIEWED: w('مراجعة جزئية', 'Partiellement revue', 'Partly reviewed'),
  REVIEWED: w('مراجعة', 'Revue', 'Reviewed'),
};

export const FIELD_REVIEW_LABEL: Readonly<Record<DmsFieldReviewState, Localized>> = {
  PENDING: w('بانتظار', 'En attente', 'Pending'),
  ACCEPTED: w('مقبول', 'Accepté', 'Accepted'),
  CORRECTED: w('مصحّح', 'Corrigé', 'Corrected'),
  REJECTED: w('مرفوض', 'Rejeté', 'Rejected'),
};

/* ------------------------------------------------------------------ *
 * Evidence packages
 * ------------------------------------------------------------------ */

export const PACKAGE_LABEL: Readonly<Record<DmsPackageStatus, Localized>> = {
  OPEN: w('مفتوح', 'Ouvert', 'Open'),
  SEALED: w('مختوم', 'Scellé', 'Sealed'),
  VOID: w('ملغى', 'Annulé', 'Void'),
};

/* ------------------------------------------------------------------ *
 * What a document is filed against
 * ------------------------------------------------------------------ */

/**
 * The seventeen entity types, in the migration's own order.
 *
 * Singular on purpose — these read inside a sentence ("Evidence for · Booking"), not as a
 * menu heading, so the plural the app map uses elsewhere would be wrong here.
 */
export const LINK_ENTITY_LABEL: Readonly<Record<DmsLinkEntityType, Localized>> = {
  pilgrim: w('حاج', 'Pèlerin', 'Pilgrim'),
  booking: w('حجز', 'Réservation', 'Booking'),
  group: w('مجموعة', 'Groupe', 'Group'),
  package: w('باقة', 'Forfait', 'Package'),
  payment: w('دفعة', 'Paiement', 'Payment'),
  invoice: w('فاتورة', 'Facture', 'Invoice'),
  supplier: w('مورّد', 'Fournisseur', 'Supplier'),
  supplier_bill: w('فاتورة مورّد', 'Facture fournisseur', 'Supplier bill'),
  contract: w('عقد', 'Contrat', 'Contract'),
  hotel_contract: w('عقد فندق', 'Contrat hôtel', 'Hotel contract'),
  journal_entry: w('قيد محاسبي', 'Écriture', 'Journal entry'),
  crm_customer: w('عميل', 'Client', 'Customer'),
  crm_quote: w('عرض سعر', 'Devis', 'Quote'),
  crm_opportunity: w('فرصة', 'Opportunité', 'Opportunity'),
  staff_profile: w('موظف', 'Employé', 'Staff'),
  visa: w('تأشيرة', 'Visa', 'Visa'),
  external_operation: w('عملية خارجية', 'Opération externe', 'External operation'),
};

/** Why it is filed there. Verbs, because a relation is a claim the filer is making. */
export const LINK_RELATION_LABEL: Readonly<Record<DmsLinkRelation, Localized>> = {
  ABOUT: w('يتعلق بـ', 'Concerne', 'About'),
  EVIDENCE_FOR: w('إثبات لـ', 'Preuve pour', 'Evidence for'),
  SIGNED_BY: w('موقّع من', 'Signé par', 'Signed by'),
  ISSUED_BY: w('صادر من', 'Émis par', 'Issued by'),
  INVOICE_FOR: w('فاتورة لـ', 'Facture pour', 'Invoice for'),
  CONTRACT_FOR: w('عقد لـ', 'Contrat pour', 'Contract for'),
};

/** Document to document. `SUPERSEDES` is the only one the server acts on: it writes SUPERSEDED. */
export const DOC_RELATION_LABEL: Readonly<Record<DmsDocumentRelation, Localized>> = {
  SUPERSEDES: w('يستبدل', 'Remplace', 'Supersedes'),
  SUPPORTS: w('يدعم', 'Appuie', 'Supports'),
  TRANSLATION_OF: w('ترجمة لـ', 'Traduction de', 'Translation of'),
  SIGNED_COPY_OF: w('نسخة موقّعة من', 'Copie signée de', 'Signed copy of'),
  ATTACHMENT_OF: w('مرفق بـ', 'Pièce jointe de', 'Attachment of'),
  AMENDS: w('يعدّل', 'Modifie', 'Amends'),
  RELATED: w('مرتبط', 'Lié', 'Related'),
};

/* ------------------------------------------------------------------ *
 * The app's own chrome
 * ------------------------------------------------------------------ */

/** The six tabs. Order comes from `DMS_VIEWS`, not from this object. */
export const VIEW_LABEL: Readonly<Record<DmsView, Localized>> = {
  dashboard: w('لوحة المعلومات', 'Tableau de bord', 'Overview'),
  library: w('المكتبة', 'Bibliothèque', 'Library'),
  review: w('المراجعة', 'Revue', 'Review'),
  expiry: w('الصلاحية', 'Échéances', 'Expiry'),
  extraction: w('الاستخراج', 'Extraction', 'Extraction'),
  packages: w('حزم الإثبات', 'Dossiers', 'Packages'),
};

/* ------------------------------------------------------------------ *
 * Columns with no union behind them
 * ------------------------------------------------------------------ */

/**
 * A SQL token made readable.
 *
 * For the two columns that carry open text: `document_type`, which a workspace defines for
 * itself, and `event_type`, which the migration adds to without a CHECK constraint. Neither
 * can be translated — there is no closed list to translate — so this only fixes the casing
 * and the underscores, and it does it identically in all three languages. `PASSPORT_SCAN`
 * reads as `Passport scan`; an Arabic value passes through untouched, because
 * `toLowerCase` and `toUpperCase` are no-ops on Arabic script.
 */
export function humanize(token: string): string {
  const trimmed = token.trim();
  if (trimmed === '') return '';
  const spaced = trimmed.replace(/[_-]+/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A label for a key that may not be in its table.
 *
 * The tables above are exhaustive over the migration as it stands today, and a row that
 * arrives with an eighteenth entity type should read as `External audit`, not vanish and not
 * throw. Takes the runtime's `t` rather than calling a hook so it can be used from a cell
 * renderer, a tooltip or an export alike.
 */
export function labelFor(
  table: Readonly<Record<string, Localized | undefined>>,
  key: string,
  t: (text: Localized) => string,
): string {
  const found = table[key];
  return found === undefined ? humanize(key) : t(found);
}
