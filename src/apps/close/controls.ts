/**
 * The controls register — its vocabulary, and the one judgement it makes.
 *
 * `checks.ts` is to the close checklist what this is to the register: the pure half,
 * with no hooks in it, so the CSV writer and the grid can both read the same rules
 * without either of them importing a query.
 *
 * The judgement is `controlState`. Everything else here is a shape or a label.
 */
import type { DatasetRow, Localized, Tone } from '@/platform/sdk';
import { asString, status, str } from '../shared/guards';

/** How often a control is meant to be tested. The register's own vocabulary. */
export type ControlFrequency = 'monthly' | 'quarterly' | 'annual' | 'ad_hoc';
/** What a test concluded. `partial` is a real answer: exceptions found, work continuing. */
export type ControlResult = 'passed' | 'failed' | 'partial';

/**
 * One row of the controls register.
 *
 * The four latest-test columns are on the control and not only on its history because
 * they are what somebody opens the register to see, and a list that had to load every
 * control's history to say "last tested in March" would read the whole table to draw
 * one column.
 */
export interface FinancialControl {
  readonly id: string;
  readonly code: string;
  readonly description: string;
  readonly ownerRole: string | null;
  readonly frequency: ControlFrequency;
  /** `status` folded to a boolean: the register holds exactly two states. */
  readonly retired: boolean;
  readonly lastTestedAt: string | null;
  readonly lastResult: ControlResult | null;
  readonly population: string;
  readonly exceptions: string;
}

/** One recorded test. `email` is denormalised at write time; see the broker's note. */
export interface ControlTest {
  readonly id: string;
  readonly at: string;
  readonly result: ControlResult;
  readonly population: string;
  readonly exceptions: string;
  readonly note: string;
  readonly email: string;
}

function toFrequency(value: unknown): ControlFrequency {
  const text = status(value);
  if (text === 'quarterly') return 'quarterly';
  if (text === 'annual') return 'annual';
  if (text === 'ad_hoc' || text === 'ad hoc') return 'ad_hoc';
  // The column is NOT NULL DEFAULT 'monthly' and CHECKed, so this is the value the
  // database itself would have chosen for a row that arrived without one.
  return 'monthly';
}

function toResult(value: unknown): ControlResult | null {
  const text = status(value);
  if (text === 'passed') return 'passed';
  if (text === 'failed') return 'failed';
  if (text === 'partial') return 'partial';
  return null;
}

export function toFinancialControl(row: DatasetRow): FinancialControl | null {
  const id = asString(row.id);
  if (id === null) return null;
  return {
    id,
    code: str(row.control_code),
    description: str(row.description),
    ownerRole: asString(row.owner_role),
    frequency: toFrequency(row.frequency),
    retired: status(row.status) === 'retired',
    lastTestedAt: asString(row.last_tested_at),
    lastResult: toResult(row.last_result),
    population: str(row.test_population),
    exceptions: str(row.exceptions),
  };
}

export function toControlTest(row: DatasetRow): ControlTest | null {
  const id = asString(row.id);
  if (id === null) return null;
  // `result` is NOT NULL and CHECKed against three values. One that maps to nothing is a
  // projection that changed shape, not a test with an unknown outcome — and a history
  // row whose conclusion cannot be read is not evidence of anything.
  const result = toResult(row.result);
  if (result === null) return null;
  return {
    id,
    at: str(row.tested_at) === '' ? str(row.created_at) : str(row.tested_at),
    result,
    population: str(row.population),
    exceptions: str(row.exceptions),
    note: str(row.note),
    email: str(row.tested_by_email),
  };
}

/**
 * What a control is *doing*, which is not the same as what its last test said.
 *
 * A register showing only `last_result` would call a control passing forever on the
 * strength of one test in March. The two facts have to be read together: a schedule the
 * control is late against, and a conclusion it reached when it was last looked at.
 * `overdue` outranks `passing` for exactly that reason.
 *
 * `ad_hoc` has no schedule and so can never be overdue, which is the honest reading of
 * a control that runs when something prompts it rather than on a calendar.
 */
export type ControlState = 'retired' | 'untested' | 'failing' | 'overdue' | 'partial' | 'passing';

const DAY_MS = 86_400_000;

/** Days a test stays current: one period plus a day, so a month-end test is not late on the 1st. */
const DUE_DAYS: Readonly<Record<ControlFrequency, number | null>> = {
  monthly: 31,
  quarterly: 92,
  annual: 366,
  ad_hoc: null,
};

export function controlState(control: FinancialControl, now: number): ControlState {
  if (control.retired) return 'retired';
  if (control.lastTestedAt === null || control.lastResult === null) return 'untested';
  if (control.lastResult === 'failed') return 'failing';
  const due = DUE_DAYS[control.frequency];
  if (due !== null) {
    const at = Date.parse(control.lastTestedAt);
    // An unparseable timestamp is not evidence that the control is current.
    if (Number.isNaN(at) || now - at > due * DAY_MS) return 'overdue';
  }
  return control.lastResult === 'partial' ? 'partial' : 'passing';
}

export const CONTROL_FREQUENCY_LABEL: Readonly<Record<ControlFrequency, Localized>> = {
  monthly: { ar: 'شهري', fr: 'Mensuel', en: 'Monthly' },
  quarterly: { ar: 'ربع سنوي', fr: 'Trimestriel', en: 'Quarterly' },
  annual: { ar: 'سنوي', fr: 'Annuel', en: 'Annual' },
  ad_hoc: { ar: 'عند الحاجة', fr: 'Ponctuel', en: 'Ad hoc' },
};

export const CONTROL_RESULT_LABEL: Readonly<Record<ControlResult, Localized>> = {
  passed: { ar: 'ناجح', fr: 'Réussi', en: 'Passed' },
  failed: { ar: 'فاشل', fr: 'Échoué', en: 'Failed' },
  partial: { ar: 'جزئي', fr: 'Partiel', en: 'Partial' },
};

export const CONTROL_STATE_LABEL: Readonly<Record<ControlState, Localized>> = {
  retired: { ar: 'موقوف', fr: 'Retiré', en: 'Retired' },
  untested: { ar: 'لم يُختبر', fr: 'Non testé', en: 'Untested' },
  failing: { ar: 'فاشل', fr: 'En échec', en: 'Failing' },
  overdue: { ar: 'متأخر', fr: 'En retard', en: 'Overdue' },
  partial: { ar: 'جزئي', fr: 'Partiel', en: 'Partial' },
  passing: { ar: 'سليم', fr: 'Conforme', en: 'Passing' },
};

/** Retired is grey, not green: a control nobody runs is out of scope, not healthy. */
export const CONTROL_STATE_TONE: Readonly<Record<ControlState, Tone>> = {
  retired: 'neutral',
  untested: 'warning',
  failing: 'danger',
  overdue: 'warning',
  partial: 'warning',
  passing: 'success',
};
