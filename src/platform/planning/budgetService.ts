/**
 * Planning domain service (slice 8 — planning vertical).
 *
 * Live contracts:
 *   fiscal_budgets(id, agency_id, period_id, name, status, locked_at, ...)
 *     status CHECK: DRAFT|IN_REVIEW|APPROVED|PUBLISHED|LOCKED
 *   budget_lines(id, budget_id, account_id, amount_dzd, amount_sar, created_at)
 *   get_budget_variance(p_budget_id) -> JSONB
 *     [{ account_id, code, name, type, budgeted_dzd, actual_dzd,
 *        variance_dzd, variance_pct }]
 *
 * Status machine (§54-style explicit states; server CHECK enforces vocabulary):
 *   DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> LOCKED
 * Locking is terminal and requires PUBLISHED.
 */

import { err, minorUnits, ok, type KernelError, type MinorUnits, type Result } from '../kernel/types.ts';

export const BUDGET_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'LOCKED'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

/** Explicit transition table — mirrors §54 "explicit state machines" rule. */
const TRANSITIONS: Readonly<Record<BudgetStatus, readonly BudgetStatus[]>> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['LOCKED'],
  LOCKED: [],
};

export function canTransition(from: BudgetStatus, to: BudgetStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function validateTransition(
  from: string,
  to: string,
): Result<BudgetStatus, KernelError> {
  if (!(BUDGET_STATUSES as readonly string[]).includes(to)) {
    return err({ code: 'VALIDATION_FAILED', message: `Unknown budget status '${to}'`, details: { domain: 'PLANNING' } });
  }
  if (!(BUDGET_STATUSES as readonly string[]).includes(from)) {
    return err({ code: 'VALIDATION_FAILED', message: `Corrupt current status '${from}'`, details: { domain: 'PLANNING' } });
  }
  if (!canTransition(from as BudgetStatus, to as BudgetStatus)) {
    return err({
      code: 'INVALID_TRANSITION',
      message: `${from} → ${to} is not allowed`,
      details: { domain: 'PLANNING', from, to },
    });
  }
  return ok(to as BudgetStatus);
}

/** Budget line amounts in major-unit numbers as stored (numeric(…,2)). */
export interface BudgetLineInput {
  readonly accountId: string;
  readonly amountDzd: number;
  readonly amountSar: number;
}

export function validateBudgetLine(line: BudgetLineInput): Result<null, KernelError> {
  if (!line.accountId) {
    return err({ code: 'VALIDATION_FAILED', message: 'Budget line needs an account', details: { domain: 'PLANNING' } });
  }
  for (const [label, v] of [['amount_dzd', line.amountDzd], ['amount_sar', line.amountSar]] as const) {
    if (!Number.isFinite(v) || v < 0) {
      return err({
        code: 'VALIDATION_FAILED',
        message: `Budget ${label} must be a non-negative number`,
        details: { domain: 'PLANNING', field: label },
      });
    }
  }
  if (line.amountDzd === 0 && line.amountSar === 0) {
    return err({ code: 'VALIDATION_FAILED', message: 'Budget line must have a non-zero amount', details: { domain: 'PLANNING' } });
  }
  return ok(null);
}

export interface VarianceRow {
  readonly accountId: string;
  readonly code: string | null;
  readonly name: string | null;
  readonly accountType: string | null;
  readonly budgetedDzd: MinorUnits;
  readonly actualDzd: MinorUnits;
  readonly varianceDzd: MinorUnits;
  readonly variancePct: number;
}

function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return NaN;
}

/** Runtime narrowing of the variance JSONB (§36). */
export function parseVariance(value: unknown): Result<readonly VarianceRow[], KernelError> {
  if (!Array.isArray(value)) {
    return err({ code: 'VALIDATION_FAILED', message: 'Expected variance array', details: { domain: 'PLANNING' } });
  }
  const rows: VarianceRow[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || typeof (raw as Record<string, unknown>)['account_id'] !== 'string') {
      return err({ code: 'VALIDATION_FAILED', message: 'Malformed variance row', details: { domain: 'PLANNING' } });
    }
    const r = raw as Record<string, unknown>;
    const budgeted = num(r['budgeted_dzd']);
    const actual = num(r['actual_dzd']);
    const variance = num(r['variance_dzd']);
    const pct = num(r['variance_pct']);
    if ([budgeted, actual, variance, pct].some((n) => !Number.isFinite(n))) {
      return err({ code: 'VALIDATION_FAILED', message: 'Variance row has non-numeric values', details: { domain: 'PLANNING' } });
    }
    rows.push({
      accountId: r['account_id'] as string,
      code: typeof r['code'] === 'string' ? r['code'] : null,
      name: typeof r['name'] === 'string' ? r['name'] : null,
      accountType: typeof r['type'] === 'string' ? r['type'] : null,
      budgetedDzd: minorUnits(BigInt(Math.round(budgeted * 100))),
      actualDzd: minorUnits(BigInt(Math.round(actual * 100))),
      varianceDzd: minorUnits(BigInt(Math.round(variance * 100))),
      variancePct: pct,
    });
  }
  return ok(rows);
}
