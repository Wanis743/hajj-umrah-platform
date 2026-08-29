/**
 * Modeling — the projection.
 *
 * Five drivers, one override, and no hidden arithmetic. Every number this file produces
 * can be recomputed by hand from the history and the scenario, which is the only property
 * that makes a forecast arguable — and a forecast nobody can argue with is a forecast
 * nobody will act on.
 *
 * Two decisions are worth stating because they are the ones a reader will test:
 *
 *   • Only the income statement is modelled. Revenue and expense accounts have a monthly
 *     rhythm a trend can read; a bank balance does not — it is a position, and projecting
 *     one is a cash-flow model with its own window.
 *   • The trend is not clamped. A revenue line whose fitted slope crosses zero is shown
 *     crossing zero, because the alternative is a floor at nothing that hides exactly the
 *     case the fit is failing at. The pane names the slope so the shape is legible.
 *
 * Amounts are signed the way each account reads them (`signedAmount`), so revenue and
 * expense are both positive when they behave, and the result is one subtraction.
 */
import type { Localized } from '@/platform/sdk';
import { type Account, type AccountType, type BudgetLine, statementOf } from '../shared/ledger';
import { fitLine, type History, mean, type Month, seriesOf, sum, tail } from './history';

/** How a baseline is drawn out of the history. */
export type Method = 'trend' | 'average' | 'growth' | 'flat' | 'budget';

export const METHODS: readonly Method[] = ['trend', 'average', 'growth', 'flat', 'budget'];

export const METHOD_LABEL: Readonly<Record<Method, Localized>> = {
  trend: { ar: 'الاتجاه', fr: 'Tendance', en: 'Trend' },
  average: { ar: 'المتوسّط', fr: 'Moyenne', en: 'Average' },
  growth: { ar: 'نمو', fr: 'Croissance', en: 'Growth' },
  flat: { ar: 'آخر شهر', fr: 'Dernier mois', en: 'Last month' },
  budget: { ar: 'الموازنة', fr: 'Budget', en: 'Budget' },
};

export const METHOD_HINT: Readonly<Record<Method, Localized>> = {
  trend: {
    ar: 'خط مستقيم يُلائم أشهر النظر، ويمتدّ إلى الأمام.',
    fr: 'Une droite ajustée sur la fenêtre d’historique, prolongée vers l’avant.',
    en: 'A straight line fitted over the lookback window and extended forward.',
  },
  average: {
    ar: 'متوسّط أشهر النظر، ثابتًا لكل شهر مقبل.',
    fr: 'La moyenne de la fenêtre, répétée chaque mois projeté.',
    en: 'The mean of the lookback window, repeated every projected month.',
  },
  growth: {
    ar: 'آخر شهر مضروبًا في معدّل النمو شهرًا بعد شهر.',
    fr: 'Le dernier mois composé au taux de croissance, mois après mois.',
    en: 'The last month compounded at the growth rate, month after month.',
  },
  flat: {
    ar: 'آخر شهر كما هو، بلا اتجاه ولا نمو.',
    fr: 'Le dernier mois tel quel, sans tendance ni croissance.',
    en: 'The last month held as it is, with no trend and no growth.',
  },
  budget: {
    ar: 'سطر الموازنة موزّعًا بالتساوي على أشهر الأفق.',
    fr: 'La ligne de budget répartie également sur les mois de l’horizon.',
    en: 'The budget line spread evenly across the months of the horizon.',
  },
};

/** The scenario: everything a reader would have to be told to reproduce the numbers. */
export interface Scenario {
  readonly method: Method;
  /** Months projected forward. */
  readonly horizon: number;
  /** Months of history the driver is fitted over. */
  readonly lookback: number;
  /** Percent per month, read by the growth driver only. */
  readonly growth: number;
  /** Percent added to every projected expense month: cost inflation, stated once. */
  readonly uplift: number;
  /** Account id → monthly amount that replaces the driver entirely. */
  readonly overrides: ReadonlyMap<string, number>;
}

export const HORIZONS: readonly number[] = [3, 6, 12, 24];
export const LOOKBACKS: readonly number[] = [3, 6, 12];

export const DEFAULT_SCENARIO: Scenario = {
  method: 'trend',
  horizon: 6,
  lookback: 6,
  growth: 0,
  uplift: 0,
  overrides: new Map(),
};

/** One account's projection, and enough of its past to justify it. */
export interface ForecastRow {
  readonly account: Account;
  /** The history the driver read, in axis order. */
  readonly history: readonly number[];
  /** The projected months, in axis order. */
  readonly values: readonly number[];
  /** Mean of the lookback window: the number the projection is judged against. */
  readonly average: number;
  readonly total: number;
  /** Drift per month the fit found, for the trend driver. Zero for the others. */
  readonly slope: number;
  readonly overridden: boolean;
  /** The plan for the same accounts, when a budget is on screen. */
  readonly planned: number | null;
  readonly gap: number | null;
  readonly lines: number;
  /** Months of the window in which the account moved at all. */
  readonly activeMonths: number;
  /** No postings, no plan and nothing projected: a row with nothing to say. */
  readonly quiet: boolean;
}

/** One month of the whole model: the income statement it implies. */
export interface TimelineRow {
  readonly month: Month;
  readonly projected: boolean;
  readonly revenue: number;
  readonly expense: number;
  readonly result: number;
  readonly cumulative: number;
}

/** The projection against the plan, by account type. */
export interface CompareRow {
  readonly type: AccountType;
  readonly projected: number;
  readonly planned: number;
  readonly gap: number;
  readonly accounts: number;
}

export interface Projection {
  readonly rows: readonly ForecastRow[];
  /** The rows worth reading: postings, a plan or an override behind them. */
  readonly moving: readonly ForecastRow[];
  readonly historyMonths: readonly Month[];
  readonly futureMonths: readonly Month[];
  readonly timeline: readonly TimelineRow[];
  readonly compare: readonly CompareRow[];
  readonly revenue: number;
  readonly expense: number;
  readonly result: number;
  /** The plan over the same accounts, or `null` when no budget is selected. */
  readonly planned: number | null;
  readonly overrides: number;
  readonly accounts: number;
  /** The account whose projection is furthest above its plan. */
  readonly worst: ForecastRow | null;
  readonly complete: boolean;
}

export const EMPTY_PROJECTION: Projection = {
  rows: [],
  moving: [],
  historyMonths: [],
  futureMonths: [],
  timeline: [],
  compare: [],
  revenue: 0,
  expense: 0,
  result: 0,
  planned: null,
  overrides: 0,
  accounts: 0,
  worst: null,
  complete: true,
};

/**
 * The baseline, month by month.
 *
 * `trend` keeps walking — index `n + k` of the fitted line, so the drift continues past the
 * history instead of freezing at its edge. Everything else is a repeated number, which the
 * uplift and the override then act on identically.
 */
function project(method: Method, window: readonly number[], scenario: Scenario, planned: number | null): number[] {
  const { horizon, growth } = scenario;
  const out: number[] = [];
  if (method === 'budget') {
    const monthly = planned === null ? 0 : planned / Math.max(1, horizon);
    for (let step = 0; step < horizon; step += 1) out.push(monthly);
    return out;
  }
  if (method === 'trend') {
    const fit = fitLine(window);
    for (let step = 0; step < horizon; step += 1) out.push(fit.intercept + fit.slope * (window.length + step));
    return out;
  }
  const last = window.length === 0 ? 0 : window[window.length - 1];
  if (method === 'growth') {
    const rate = 1 + growth / 100;
    for (let step = 0; step < horizon; step += 1) out.push(last * rate ** (step + 1));
    return out;
  }
  const level = method === 'average' ? mean(window) : last;
  for (let step = 0; step < horizon; step += 1) out.push(level);
  return out;
}

export interface ProjectionInput {
  readonly accounts: readonly Account[];
  readonly history: History;
  readonly futureMonths: readonly Month[];
  readonly scenario: Scenario;
  /** The selected budget's lines by account, or `null` when no budget is on screen. */
  readonly plan: ReadonlyMap<string, BudgetLine> | null;
}

/**
 * Which way a gap is the wrong way.
 *
 * Over-spending and under-earning are both bad news and they have opposite signs, so the
 * comparison is scored rather than compared: one positive number that means "worse".
 */
export function adverseGap(type: AccountType, gap: number): number {
  return type === 'EXPENSE' ? gap : -gap;
}

/** Only the income statement is modelled; the balance sheet is a position, not a rhythm. */
const isModelled = (account: Account): boolean => account.active && statementOf(account.type) === 'income';

/** One account, from its history to its projected total. */
function forecastRow(account: Account, input: ProjectionInput): ForecastRow {
  const { history, scenario, plan } = input;
  const series = seriesOf(history, account.id);
  const window = tail(series, scenario.lookback);
  const planned = plan === null ? null : (plan.get(account.id)?.dzd ?? 0);
  const override = scenario.overrides.get(account.id);
  const overridden = override !== undefined;

  let values = project(scenario.method, window, scenario, planned);
  // The uplift is cost inflation, so it lands on expenses only — and never on an override,
  // which is somebody stating the number they mean rather than asking for one to be drawn.
  if (!overridden && scenario.uplift !== 0 && account.type === 'EXPENSE') {
    const factor = 1 + scenario.uplift / 100;
    values = values.map((value) => value * factor);
  }
  if (overridden) values = values.map(() => override);

  const cell = history.byAccount.get(account.id) ?? null;
  const total = sum(values);
  const lines = cell?.lines ?? 0;
  return {
    account,
    history: series,
    values,
    average: mean(window),
    total,
    slope: scenario.method === 'trend' && !overridden ? fitLine(window).slope : 0,
    overridden,
    planned,
    gap: planned === null ? null : total - planned,
    lines,
    activeMonths: cell?.active ?? 0,
    quiet: lines === 0 && !overridden && (planned === null || planned === 0) && Math.abs(total) < 0.005,
  };
}

/** The income statement each month of the axis implies, history and projection in one line. */
function timelineOf(rows: readonly ForecastRow[], input: ProjectionInput): readonly TimelineRow[] {
  const { history, futureMonths } = input;
  const out: TimelineRow[] = [];
  let running = 0;
  const at = (index: number, projected: boolean) => {
    let revenue = 0;
    let expense = 0;
    for (const row of rows) {
      const value = projected ? (row.values[index] ?? 0) : (row.history[index] ?? 0);
      if (row.account.type === 'REVENUE') revenue += value;
      else expense += value;
    }
    const result = revenue - expense;
    running += result;
    return { revenue, expense, result, cumulative: running };
  };
  history.months.forEach((month, index) => out.push({ month, projected: false, ...at(index, false) }));
  futureMonths.forEach((month, index) => out.push({ month, projected: true, ...at(index, true) }));
  return out;
}

/** The projection against the plan, one row per account type that carries anything. */
function compareOf(rows: readonly ForecastRow[]): readonly CompareRow[] {
  const groups = new Map<AccountType, { projected: number; planned: number; accounts: number }>();
  for (const row of rows) {
    if (row.quiet) continue;
    const group = groups.get(row.account.type) ?? { projected: 0, planned: 0, accounts: 0 };
    group.projected += row.total;
    group.planned += row.planned ?? 0;
    group.accounts += 1;
    groups.set(row.account.type, group);
  }
  const out: CompareRow[] = [];
  for (const [type, group] of groups) {
    out.push({ type, projected: group.projected, planned: group.planned, gap: group.projected - group.planned, accounts: group.accounts });
  }
  // Revenue before expense, which is the order the statement is read in.
  return out.sort((a, b) => (a.type === b.type ? 0 : a.type === 'REVENUE' ? -1 : 1));
}

export function build(input: ProjectionInput): Projection {
  const rows = input.accounts.filter(isModelled).map((account) => forecastRow(account, input));
  rows.sort((a, b) => b.total - a.total || a.account.code.localeCompare(b.account.code));
  const moving = rows.filter((row) => !row.quiet);

  let revenue = 0;
  let expense = 0;
  let planned: number | null = input.plan === null ? null : 0;
  let overrides = 0;
  let worst: ForecastRow | null = null;
  let worstScore = 0.005;
  for (const row of rows) {
    if (row.account.type === 'REVENUE') revenue += row.total;
    else expense += row.total;
    if (row.planned !== null && planned !== null) planned += row.planned;
    if (row.overridden) overrides += 1;
    if (row.gap === null) continue;
    const score = adverseGap(row.account.type, row.gap);
    if (score > worstScore) {
      worstScore = score;
      worst = row;
    }
  }

  return {
    rows,
    moving,
    historyMonths: input.history.months,
    futureMonths: input.futureMonths,
    timeline: timelineOf(rows, input),
    compare: compareOf(rows),
    revenue,
    expense,
    result: revenue - expense,
    planned,
    overrides,
    accounts: moving.length,
    worst,
    complete: input.history.complete,
  };
}



