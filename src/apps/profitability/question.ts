/**
 * Profitability — the question, which is the whole state of the window.
 *
 * One object, seven fields, and every control in the app writes exactly one of
 * them. The model takes it as its only argument, so there is no way for a
 * dimension shown in the toolbar to disagree with the dimension the figures were
 * summed over — a class of bug that costs an afternoon every time it appears.
 *
 * It is state and not a setting. `useSetting` writes through `registry.set`,
 * which is a privileged capability and raises a consent prompt; a person dragging
 * a sort order or typing in a search box should never be asked to authorise
 * anything. So this lives in window state and dies with the window, which is also
 * the right lifetime for it.
 */
import type { Localized } from '@/platform/sdk';
import type { Basis } from '../shared/ledger';
import { DIMENSIONS, type Dimension, type Sort } from './figures';

export interface Question {
  readonly dimension: Dimension;
  readonly basis: Basis;
  /** Which fiscal period, or `null` for whichever one the book is newest in. */
  readonly periodId: string | null;
  /** The prior-period column. Only readable on the period basis. */
  readonly compare: boolean;
  readonly sort: Sort;
  /** Show members that did nothing this window. Off, because most of them did not. */
  readonly showSilent: boolean;
  readonly search: string;
}

/**
 * Where the window opens: margin by package over the latest period.
 *
 * The period basis rather than the whole book, because a margin is a statement
 * about a stretch of time and an inception-to-date one answers a question almost
 * nobody asks. Sorted by margin, because the report is a ranking.
 */
export const DEFAULT_QUESTION: Question = {
  dimension: 'package',
  basis: 'period',
  periodId: null,
  compare: false,
  sort: 'margin',
  showSilent: false,
  search: '',
};

/* ------------------------------------------------------------------ *
 * What the controls are called
 * ------------------------------------------------------------------ */

/**
 * The two dimensions, named for what they are in this business.
 *
 * A `package_id` is a product — an Umrah in Ramadan, a fifteen-day Hajj — and a
 * `branch_id` is an office. Naming them "cost centre" would be borrowing a word
 * from a general ledger this book does not keep.
 */
export const DIMENSION_LABEL: Readonly<Record<Dimension, Localized>> = {
  package: { ar: 'الباقة', fr: 'Forfait', en: 'Package' },
  branch: { ar: 'الفرع', fr: 'Succursale', en: 'Branch' },
};

/** One word for a whole column of figures, for the row a member is printed on. */
export const DIMENSION_UNIT: Readonly<Record<Dimension, Localized>> = {
  package: { ar: 'باقات', fr: 'Forfaits', en: 'Packages' },
  branch: { ar: 'فروع', fr: 'Succursales', en: 'Branches' },
};

export const SORT_LABEL: Readonly<Record<Sort, Localized>> = {
  margin: { ar: 'الهامش', fr: 'Marge', en: 'Margin' },
  revenue: { ar: 'الإيراد', fr: 'Produits', en: 'Revenue' },
  name: { ar: 'الاسم', fr: 'Nom', en: 'Name' },
};

/** The command id a dimension answers to, so the manifest and the shell cannot drift. */
export const DIMENSION_COMMAND: Readonly<Record<Dimension, string>> = {
  package: 'dimension:package',
  branch: 'dimension:branch',
};

/** The dimension a command id asks for, or `null` when it asks for something else. */
export const dimensionOf = (id: string): Dimension | null =>
  DIMENSIONS.find((dimension) => DIMENSION_COMMAND[dimension] === id) ?? null;
