/**
 * Formatters, tone tokens and the read hook for the DMS screens. Plain functions
 * only -- the components live in ./atoms, because a .tsx file that exports a
 * component may not also export plain functions (react-refresh/only-export-components).
 *
 * Self-contained rather than importing the CRM equivalents: the tone maps here key
 * on DMS unions the CRM has never seen, and a shared re-export module would put a
 * component and a formatter in the same file again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { safeDmsRead, type DmsReadResult } from '@/services/dmsAnalytics';
import type {
  DmsConfidentiality, DmsDocumentRelation, DmsExtractionStatus, DmsFieldReviewState,
  DmsLinkEntityType, DmsLinkRelation, DmsPackageStatus, DmsReviewStatus, DmsUploadState,
} from '@/types/dms';

/** ar -> Arabic, fr -> French, everything else English. */
export function useDmsI18n() {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = useCallback(
    (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en),
    [isAr, isFr],
  );
  return { isAr, t };
}

/* -------------------------------------------------------------------------- */
/* Formatting. A null from the server means "undefined", and it renders as an   */
/* em dash. Printing 0 for an unknown count would invent a fact.                */
/* -------------------------------------------------------------------------- */

export const DASH = '—';

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${value}%`;
}

/** Extraction confidence arrives 0..1 from the engines. */
export function fmtConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${Math.round(value * 100)}%`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString();
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? DASH
    : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** Binary units, matching the 25 MiB bucket limit the server enforces. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return DASH;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Hours as a queue age: "3h", "2d 4h". Null stays null, not "0h". */
export function fmtHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return DASH;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

/** First and last 8 hex characters. A 64-character digest in a table cell is a
 *  wall; the full value goes in the title attribute. */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return DASH;
  return hash.length <= 20 ? hash : `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** staff_profiles carries no name column, so an actor is reported as the first
 *  segment of its uuid, with the whole value put in a title attribute by the caller.
 *  Inventing a display name here would mean guessing at a join that does not
 *  exist. */
export function actorLabel(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : DASH;
}

/* -------------------------------------------------------------------------- */
/* Tone tokens                                                                */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'info' | 'progress' | 'warn' | 'good' | 'bad';

export const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-[var(--bg-hover)] text-[var(--text-secondary)]',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  progress: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  bad: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
};

/** Exhaustive over the union, so adding a state to the migration and not here is
 *  a type error rather than a silently grey pill. */
export const REVIEW_TONE: Record<DmsReviewStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'info',
  UNDER_REVIEW: 'progress',
  APPROVED: 'good',
  REJECTED: 'bad',
  CHANGES_REQUESTED: 'warn',
  EXPIRED: 'bad',
  SUPERSEDED: 'neutral',
};

/** RESTRICTED is red on purpose: it is the one level where showing the document to
 *  the wrong person is the incident. */
export const CONFIDENTIALITY_TONE: Record<DmsConfidentiality, Tone> = {
  PUBLIC: 'neutral', INTERNAL: 'info', CONFIDENTIAL: 'warn', RESTRICTED: 'bad',
};

export const UPLOAD_STATE_TONE: Record<DmsUploadState, Tone> = {
  RESERVED: 'warn', UPLOADED: 'good', LEGACY: 'neutral', FAILED: 'bad',
};

export const EXTRACTION_TONE: Record<DmsExtractionStatus, Tone> = {
  pending: 'info', processing: 'progress', completed: 'good', failed: 'bad',
};

export const FIELD_REVIEW_TONE: Record<DmsFieldReviewState, Tone> = {
  PENDING: 'info', ACCEPTED: 'good', CORRECTED: 'warn', REJECTED: 'bad',
};

export const PACKAGE_TONE: Record<DmsPackageStatus, Tone> = {
  OPEN: 'info', SEALED: 'good', VOID: 'neutral',
};

/** Days-to-expiry as a tone. Past due is bad, inside the notice window is warn. */
export function expiryTone(daysRemaining: number | null): Tone {
  if (daysRemaining === null) return 'neutral';
  if (daysRemaining < 0) return 'bad';
  if (daysRemaining <= 7) return 'bad';
  if (daysRemaining <= 30) return 'warn';
  return 'good';
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every union in the migration, translated once. Exhaustive Records, so a state
 * added to the CHECK constraint and not here fails typecheck instead of rendering
 * a raw SQL token to a user.
 */
export function useDmsLabels() {
  const { t } = useDmsI18n();

  const review: Record<DmsReviewStatus, string> = {
    DRAFT: t('مسودة', 'Brouillon', 'Draft'),
    PENDING_REVIEW: t('بانتظار المراجعة', 'En attente', 'Pending review'),
    UNDER_REVIEW: t('قيد المراجعة', 'En révision', 'Under review'),
    APPROVED: t('معتمد', 'Approuvé', 'Approved'),
    REJECTED: t('مرفوض', 'Rejeté', 'Rejected'),
    CHANGES_REQUESTED: t('تعديلات مطلوبة', 'Modifications demandées', 'Changes requested'),
    EXPIRED: t('منتهي', 'Expiré', 'Expired'),
    SUPERSEDED: t('مستبدل', 'Remplacé', 'Superseded'),
  };

  const confidentiality: Record<DmsConfidentiality, string> = {
    PUBLIC: t('عام', 'Public', 'Public'),
    INTERNAL: t('داخلي', 'Interne', 'Internal'),
    CONFIDENTIAL: t('سري', 'Confidentiel', 'Confidential'),
    RESTRICTED: t('مقيّد', 'Restreint', 'Restricted'),
  };

  const uploadState: Record<DmsUploadState, string> = {
    RESERVED: t('محجوز', 'Réservé', 'Reserved'),
    UPLOADED: t('مرفوع', 'Téléversé', 'Uploaded'),
    LEGACY: t('قديم', 'Historique', 'Legacy'),
    FAILED: t('فاشل', 'Échoué', 'Failed'),
  };

  const extraction: Record<DmsExtractionStatus, string> = {
    pending: t('بانتظار', 'En attente', 'Pending'),
    processing: t('قيد المعالجة', 'En cours', 'Processing'),
    completed: t('مكتمل', 'Terminé', 'Completed'),
    failed: t('فاشل', 'Échoué', 'Failed'),
  };

  const fieldReview: Record<DmsFieldReviewState, string> = {
    PENDING: t('بانتظار', 'En attente', 'Pending'),
    ACCEPTED: t('مقبول', 'Accepté', 'Accepted'),
    CORRECTED: t('مصحّح', 'Corrigé', 'Corrected'),
    REJECTED: t('مرفوض', 'Rejeté', 'Rejected'),
  };

  const packageStatus: Record<DmsPackageStatus, string> = {
    OPEN: t('مفتوح', 'Ouvert', 'Open'),
    SEALED: t('مختوم', 'Scellé', 'Sealed'),
    VOID: t('ملغى', 'Annulé', 'Void'),
  };

  const linkEntity: Record<DmsLinkEntityType, string> = {
    pilgrim: t('حاج', 'Pèlerin', 'Pilgrim'),
    booking: t('حجز', 'Réservation', 'Booking'),
    group: t('مجموعة', 'Groupe', 'Group'),
    package: t('باقة', 'Forfait', 'Package'),
    payment: t('دفعة', 'Paiement', 'Payment'),
    invoice: t('فاتورة', 'Facture', 'Invoice'),
    supplier: t('مورّد', 'Fournisseur', 'Supplier'),
    supplier_bill: t('فاتورة مورّد', 'Facture fournisseur', 'Supplier bill'),
    contract: t('عقد', 'Contrat', 'Contract'),
    hotel_contract: t('عقد فندق', 'Contrat hôtel', 'Hotel contract'),
    journal_entry: t('قيد محاسبي', 'Écriture', 'Journal entry'),
    crm_customer: t('عميل', 'Client', 'Customer'),
    crm_quote: t('عرض سعر', 'Devis', 'Quote'),
    crm_opportunity: t('فرصة', 'Opportunité', 'Opportunity'),
    staff_profile: t('موظف', 'Employé', 'Staff'),
    visa: t('تأشيرة', 'Visa', 'Visa'),
    external_operation: t('عملية خارجية', 'Opération externe', 'External operation'),
  };

  const linkRelation: Record<DmsLinkRelation, string> = {
    ABOUT: t('يتعلق بـ', 'Concerne', 'About'),
    EVIDENCE_FOR: t('إثبات لـ', 'Preuve pour', 'Evidence for'),
    SIGNED_BY: t('موقّع من', 'Signé par', 'Signed by'),
    ISSUED_BY: t('صادر من', 'Émis par', 'Issued by'),
    INVOICE_FOR: t('فاتورة لـ', 'Facture pour', 'Invoice for'),
    CONTRACT_FOR: t('عقد لـ', 'Contrat pour', 'Contract for'),
  };

  const docRelation: Record<DmsDocumentRelation, string> = {
    SUPERSEDES: t('يستبدل', 'Remplace', 'Supersedes'),
    SUPPORTS: t('يدعم', 'Appuie', 'Supports'),
    TRANSLATION_OF: t('ترجمة لـ', 'Traduction de', 'Translation of'),
    SIGNED_COPY_OF: t('نسخة موقّعة من', 'Copie signée de', 'Signed copy of'),
    ATTACHMENT_OF: t('مرفق بـ', 'Pièce jointe de', 'Attachment of'),
    AMENDS: t('يعدّل', 'Modifie', 'Amends'),
    RELATED: t('مرتبط', 'Lié', 'Related'),
  };

  return { review, confidentiality, uploadState, extraction, fieldReview, packageStatus, linkEntity, linkRelation, docRelation };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface DmsReadState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads one analytics payload. Deliberately plain: the RPC already composes a
 * whole screen's worth of data in one round trip, so there is nothing to cache or
 * merge here. `deps` is the argument list -- change it and the read reruns.
 */
export function useDmsRead<T>(run: () => Promise<DmsReadResult<T>>, deps: readonly unknown[]): DmsReadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Latest-ref: the caller passes a fresh closure every render, so the effect keys
  // off the serialized arguments instead of the function identity.
  const runRef = useRef(run);
  runRef.current = run;
  const key = JSON.stringify(deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    safeDmsRead(() => runRef.current()).then((res) => {
      if (!alive) return;
      setData(res.data);
      setError(res.error);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [key, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
