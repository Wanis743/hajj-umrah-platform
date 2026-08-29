/**
 * Budgets — the judgement.
 *
 * One idea, applied per account: the plan said this much, the book says that much, and
 * the difference is either something to explain or nothing at all. Everything else in
 * this module is about saying which — and about saying it in the discipline's own words
 * rather than in colours.
 *
 * `variance` is always `planned − actual`, which is what an export has to carry: one
 * subtraction, in one direction, that anybody can re-do in a spreadsheet. Whether that
 * number is *good* depends on the account, and that is the second field. Spending less
 * than planned is favourable; earning less than planned is not, and a report that paints
 * both green is a report nobody trusts twice.
 *
 * Two states exist for data rather than for money. `unplanned` is an account with
 * activity and no line — the most expensive thing a budget can miss, so it is not
 * hidden behind a filter. `idle` is an account with neither, which is most of the chart
 * of accounts and appears only in the plan view.
 */
import {
  ACCOUNT_TYPES,
  type Account,
  type AccountType,
  type BudgetLine,
  EPSILON,
  isDebitNatured,
  statementOf,
} from '../shared/ledger';
import { text } from '../shared/manifest';
import type { Localized, Tone } from '@/platform/sdk';

/**
 * How far off plan is still "on plan".
 *
 * Five per cent, because a budget is a monthly guess about the future and a report that
 * flags a 1% miss trains people to ignore the flag. Below the band the row is green and
 * says nothing further.
 */
export const NEAR_BAND = 0.05;

export type VarianceState = 'adverse' | 'on' | 'favourable' | 'unplanned' | 'idle';

export const VARIANCE_STATE_LABEL: Readonly<Record<VarianceState, Localized>> = {
  adverse: text('غير مواتٍ', 'Défavorable', 'Adverse'),
  on: text('مطابق', 'Conforme', 'On plan'),
  favourable: text('مواتٍ', 'Favorable', 'Favourable'),
  unplanned: text('غير مخطَّط', 'Hors plan', 'Unplanned'),
  idle: text('بلا حركة', 'Sans mouvement', 'No activity'),
};

/** What the book did in the account, and how many posted lines say so. */
export interface ActualCell {
  readonly amount: number;
  readonly lines: number;
}

export const EMPTY_ACTUAL: ActualCell = { amount: 0, lines: 0 };

export interface VarianceRow {
  readonly account: Account;
  /** The plan, in the book's base currency. Zero also means "no line at all". */
  readonly planned: number;
  /** Posted activity, signed the way the account itself reads a balance. */
  readonly actual: number;
  /** `planned − actual`, always in that direction. */
  readonly variance: number;
  /** `actual / planned`, or null when there is no plan to be a share of. */
  readonly used: number | null;
  readonly state: VarianceState;
  /** The budget line behind `planned`, when one has been entered. */
  readonly lineId: string | null;
  readonly lines: number;
}

export interface RollupRow {
  readonly type: AccountType;
  readonly planned: number;
  readonly actual: number;
  readonly variance: number;
  readonly accounts: number;
  readonly adverse: number;
}

/**
 * Which side of the plan a gap falls on.
 *
 * The sign of `variance` is not the answer on its own: for an expense, planned above
 * actual is money not spent, and for a revenue account the same arithmetic is a shortfall.
 * `isDebitNatured` already knows which accounts are which, so this reads it rather than
 * keeping a second list that could disagree with the ledger.
 */
function verdict(planned: number, actual: number, type: AccountType): VarianceState {
  const noPlan = Math.abs(planned) < EPSILON;
  const noActual = Math.abs(actual) < EPSILON;
  if (noPlan) return noActual ? 'idle' : 'unplanned';
  const variance = planned - actual;
  if (Math.abs(variance) <= Math.abs(planned) * NEAR_BAND) return 'on';
  // Spending less than planned is favourable; earning less than planned is not.
  const good = isDebitNatured(type) ? variance > 0 : variance < 0;
  return good ? 'favourable' : 'adverse';
}

export function varianceRow(account: Account, planned: number, cell: ActualCell, lineId: string | null): VarianceRow {
  const actual = cell.amount;
  return {
    account,
    planned,
    actual,
    variance: planned - actual,
    used: Math.abs(planned) < EPSILON ? null : actual / planned,
    state: verdict(planned, actual, account.type),
    lineId,
    lines: cell.lines,
  };
}

/** Adverse is the only state that is a problem, so it is the only red one. */
export const varianceTone = (state: VarianceState): Tone =>
  state === 'adverse'
    ? 'danger'
    : state === 'favourable'
      ? 'accent'
      : state === 'on'
        ? 'success'
        : state === 'unplanned'
          ? 'warning'
          : 'neutral';

/**
 * Where the actuals came from, which the report has to say out loud.
 *
 * A budget that names a fiscal period is compared against that period's postings.
 * A budget that names none has nothing to bound the comparison, so it is compared
 * against the whole book — a legitimate answer to a different question, and one no
 * reader should have to guess at.
 */
export type ActualBasis = 'period' | 'book';

export interface BudgetInput {
  /** The whole chart of accounts, in whatever order it arrived. */
  readonly accounts: readonly Account[];
  readonly lines: readonly BudgetLine[];
  /** Posted activity by account id. Absent means no activity, not unknown. */
  readonly actuals: ReadonlyMap<string, ActualCell>;
  readonly locked: boolean;
  readonly basis: ActualBasis;
  /** False when the actuals were computed over a page of entries rather than all of them. */
  readonly complete: boolean;
}

export interface BudgetAssessment {
  /** The variance report: accounts with a plan, activity, or both. */
  readonly rows: readonly VarianceRow[];
  /** The plan view: every account, including the ones nobody has planned for. */
  readonly plan: readonly VarianceRow[];
  readonly groups: readonly RollupRow[];
  /** The line behind an account, so an edit can carry the amounts it is not changing. */
  readonly byAccount: ReadonlyMap<string, BudgetLine>;
  readonly planned: number;
  readonly actual: number;
  readonly variance: number;
  /** Budget lines entered, and accounts in the chart. */
  readonly lines: number;
  readonly accounts: number;
  readonly adverse: number;
  readonly unplanned: number;
  /** The largest adverse gap, which is the one sentence a summary gets to say. */
  readonly worst: VarianceRow | null;
  readonly locked: boolean;
  readonly basis: ActualBasis;
  readonly complete: boolean;
}

/**
 * Statement order for the meeting: the income statement first.
 *
 * A budget is a promise about a result, and the result lives in revenue and expense —
 * the balance sheet is where that promise lands afterwards. `statementOf` decides which
 * is which, so this follows the ledger's own classification rather than keeping a second
 * ordering beside `ACCOUNT_TYPES` that could disagree with it.
 */
const GROUP_ORDER: readonly AccountType[] = [...ACCOUNT_TYPES].sort((a, b) =>
  statementOf(a) === statementOf(b) ? 0 : statementOf(a) === 'income' ? -1 : 1,
);

/** Chart order: statement first, then the account number, which is how a chart is read. */
function byStatement(a: VarianceRow, b: VarianceRow): number {
  const rank = GROUP_ORDER.indexOf(a.account.type) - GROUP_ORDER.indexOf(b.account.type);
  return rank !== 0 ? rank : a.account.code.localeCompare(b.account.code);
}

/**
 * The same rows, by account type.
 *
 * Empty groups are dropped: five lines where three of them are zeros is not a summary,
 * and an account type nobody budgeted for has nothing to say at this altitude.
 */
export function rollup(rows: readonly VarianceRow[]): readonly RollupRow[] {
  const totals = new Map<AccountType, { planned: number; actual: number; accounts: number; adverse: number }>();
  for (const row of rows) {
    if (row.state === 'idle') continue;
    const seen = totals.get(row.account.type) ?? { planned: 0, actual: 0, accounts: 0, adverse: 0 };
    seen.planned += row.planned;
    seen.actual += row.actual;
    seen.accounts += 1;
    if (row.state === 'adverse') seen.adverse += 1;
    totals.set(row.account.type, seen);
  }
  return GROUP_ORDER.flatMap((type) => {
    const seen = totals.get(type);
    if (seen === undefined) return [];
    const { planned, actual, accounts, adverse } = seen;
    return [{ type, planned, actual, variance: planned - actual, accounts, adverse }];
  });
}

/**
 * The whole judgement, once, for all three views.
 *
 * Totals are taken over the reported rows rather than the plan, which is the same number
 * either way — an idle account contributes zero to both sides — but says what is being
 * added up. The plan amount read here is the dinar one, because that is the currency the
 * book keeps its actuals in; a line's other amount travels through `byAccount` so an edit
 * cannot quietly zero it.
 */
export function assess(input: BudgetInput): BudgetAssessment {
  // (budget, account) is unique — `upsert_budget_line` keys the write on that pair — so
  // the first line for an account is the only line for it.
  const byAccount = new Map<string, BudgetLine>();
  for (const line of input.lines) {
    if (!byAccount.has(line.accountId)) byAccount.set(line.accountId, line);
  }

  const plan = input.accounts
    .map((account) => {
      const line = byAccount.get(account.id) ?? null;
      const cell = input.actuals.get(account.id) ?? EMPTY_ACTUAL;
      return varianceRow(account, line === null ? 0 : line.dzd, cell, line === null ? null : line.id);
    })
    .sort(byStatement);
  const rows = plan.filter((row) => row.state !== 'idle');

  let planned = 0;
  let actual = 0;
  let adverse = 0;
  let unplanned = 0;
  let worst: VarianceRow | null = null;
  for (const row of rows) {
    planned += row.planned;
    actual += row.actual;
    if (row.state === 'unplanned') unplanned += 1;
    if (row.state !== 'adverse') continue;
    adverse += 1;
    if (worst === null || Math.abs(row.variance) > Math.abs(worst.variance)) worst = row;
  }

  return {
    rows,
    plan,
    groups: rollup(rows),
    byAccount,
    planned,
    actual,
    variance: planned - actual,
    lines: byAccount.size,
    accounts: input.accounts.length,
    adverse,
    unplanned,
    worst,
    locked: input.locked,
    basis: input.basis,
    complete: input.complete,
  };
}
