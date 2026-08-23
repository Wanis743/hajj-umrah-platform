/**
 * Kernel tests — planning slice (slice 8).
 * Pure contracts: status machine, budget line validation, variance parsing.
 */

import {
  BUDGET_STATUSES,
  canTransition,
  parseVariance,
  validateBudgetLine,
  validateTransition,
} from '../src/platform/planning/budgetService.ts';
import { minorUnits } from '../src/platform/kernel/types.ts';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) passed++;
  else {
    failed++;
    process.stderr.write(`FAIL: ${label}\n`);
  }
}

// ── status machine ──────────────────────────────────────────────────────────

{
  assert(canTransition('DRAFT', 'IN_REVIEW'), 'DRAFT → IN_REVIEW allowed');
  assert(canTransition('IN_REVIEW', 'APPROVED'), 'IN_REVIEW → APPROVED allowed');
  assert(canTransition('IN_REVIEW', 'DRAFT'), 'IN_REVIEW → DRAFT (rework) allowed');
  assert(canTransition('APPROVED', 'PUBLISHED'), 'APPROVED → PUBLISHED allowed');
  assert(canTransition('PUBLISHED', 'LOCKED'), 'PUBLISHED → LOCKED allowed');

  assert(!canTransition('DRAFT', 'PUBLISHED'), 'skip-ahead blocked');
  assert(!canTransition('DRAFT', 'LOCKED'), 'draft cannot lock');
  assert(!canTransition('LOCKED', 'DRAFT'), 'locked is terminal');
  assert(!canTransition('PUBLISHED', 'DRAFT'), 'published cannot rework');

  const bad = validateTransition('DRAFT', 'EXPLODED');
  assert(!bad.ok && bad.error.code === 'VALIDATION_FAILED', 'unknown target rejected');
  const skip = validateTransition('DRAFT', 'PUBLISHED');
  assert(!skip.ok && skip.error.code === 'INVALID_TRANSITION', 'illegal transition flagged as INVALID_TRANSITION');
}

assert(BUDGET_STATUSES.length === 5, 'status vocabulary stable');

// ── budget line validation ──────────────────────────────────────────────────

{
  const okLine = validateBudgetLine({ accountId: 'acc-1', amountDzd: 1500.5, amountSar: 0 });
  assert(okLine.ok, 'valid dzd-only line accepted');

  const sar = validateBudgetLine({ accountId: 'acc-1', amountDzd: 0, amountSar: 300 });
  assert(sar.ok, 'valid sar-only line accepted');

  const noAccount = validateBudgetLine({ accountId: '', amountDzd: 10, amountSar: 0 });
  assert(!noAccount.ok && noAccount.error.message.includes('account'), 'missing account rejected');

  const negative = validateBudgetLine({ accountId: 'a', amountDzd: -1, amountSar: 0 });
  assert(!negative.ok && negative.error.message.includes('non-negative'), 'negative rejected');

  const zeroBoth = validateBudgetLine({ accountId: 'a', amountDzd: 0, amountSar: 0 });
  assert(!zeroBoth.ok && zeroBoth.error.message.includes('non-zero'), 'both-zero rejected');
}

// ── variance parsing ────────────────────────────────────────────────────────

{
  const payload = [
    {
      account_id: 'acc-1',
      code: '5000',
      name: 'Flights',
      type: 'EXPENSE',
      budgeted_dzd: 100000,
      actual_dzd: 92500.5,
      variance_dzd: 7500,
      variance_pct: 7.5,
    },
  ];
  const okParsed = parseVariance(payload);
  assert(okParsed.ok, 'variance rows parse');
  if (okParsed.ok) {
    const firstRow = okParsed.value[0];
    assert(firstRow !== undefined && firstRow.budgetedDzd === minorUnits(10_000_000n), 'budgeted in minor units');
    assert(firstRow !== undefined && firstRow.variancePct === 7.5, 'percent extracted');
    assert(firstRow !== undefined && firstRow.accountType === 'EXPENSE', 'type mapped');
  }

  const malformed = parseVariance([{ nope: true }]);
  assert(!malformed.ok, 'row without account_id rejected');
  const nonArray = parseVariance('nope');
  assert(!nonArray.ok, 'non-array rejected');
  const nonNumeric = parseVariance([{ account_id: 'a', budgeted_dzd: 'lots' }]);
  assert(!nonNumeric.ok, 'non-numeric amounts rejected');
}

process.stdout.write(`\nplanning slice tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
