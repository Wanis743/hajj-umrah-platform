/**
 * App categories, in words.
 *
 * `AppCategoryId` is the ABI's enum; the trilingual names for it are not, because
 * the kernel never renders anything. Settings shows the category of every
 * installed app, so the table lives here rather than inside that one page — the
 * next app to list apps reads the same words instead of inventing its own.
 */
import type { AppCategoryId, Localized } from '@/platform/sdk';

export const CATEGORY_LABEL: Readonly<Record<AppCategoryId, Localized>> = {
  accounting: { ar: 'محاسبة', fr: 'Comptabilité', en: 'Accounting' },
  analysis: { ar: 'تحليل', fr: 'Analyse', en: 'Analysis' },
  planning: { ar: 'تخطيط', fr: 'Planification', en: 'Planning' },
  treasury: { ar: 'خزينة', fr: 'Trésorerie', en: 'Treasury' },
  productivity: { ar: 'إنتاجية', fr: 'Productivité', en: 'Productivity' },
  system: { ar: 'نظام', fr: 'Système', en: 'System' },
};

/** Mirrors `capabilityLabel`: an unknown category still shows, as itself. */
export function categoryLabel(value: string): Localized {
  return value in CATEGORY_LABEL
    ? CATEGORY_LABEL[value as AppCategoryId]
    : { ar: value, fr: value, en: value };
}
