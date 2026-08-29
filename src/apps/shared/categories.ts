/**
 * App categories, in words.
 *
 * `AppCategoryId` is the ABI's enum; the trilingual names for it are not, because
 * the kernel never renders anything. Two apps need them — Settings groups the
 * installed list by category and the Store navigates by it — so they live here
 * rather than being spelled out twice with the risk of drifting apart.
 *
 * `CATEGORY_ORDER` is the order both apps show: the system tools first, then the
 * finance suite in the order a month is worked, which is the same reasoning
 * behind the order of `APP_PACKAGES`.
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

export const CATEGORY_ORDER: readonly AppCategoryId[] = [
  'system',
  'productivity',
  'accounting',
  'analysis',
  'planning',
  'treasury',
];

/** Mirrors `capabilityLabel`: an unknown category still shows, as itself. */
export function categoryLabel(value: string): Localized {
  return value in CATEGORY_LABEL
    ? CATEGORY_LABEL[value as AppCategoryId]
    : { ar: value, fr: value, en: value };
}
