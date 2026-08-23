/**
 * Kernel tests — FPA modeling slice (slice 7).
 * Pure contracts: assumption validation, projection math mirroring
 * simulate_scenario, JSONB result parsing. Server behavior verified live.
 */

import {
  ASSUMPTION_KEYS,
  parseSimulation,
  projectScenario,
  validateAssumptions,
} from '../src/platform/fpa/modelService.ts';
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

const good = (): Record<string, number> => ({
  target_pilgrims: 500,
  price_per_pilgrim: 1500,
  flight_cost_per_pilgrim: 400,
  hotel_cost_per_pilgrim: 350,
  visa_cost_per_pilgrim: 100,
  other_cost_per_pilgrim: 50,
});

// ── validation ──────────────────────────────────────────────────────────────

{
  const r = validateAssumptions(good());
  assert(r.ok, 'valid assumptions accepted');
  if (r.ok) assert(r.value.targetPilgrims === 500, 'values mapped');

  const neg = validateAssumptions({ ...good(), price_per_pilgrim: -5 });
  assert(!neg.ok && neg.error.message.includes('price_per_pilgrim'), 'negative rejected');

  const nan = validateAssumptions({ ...good(), hotel_cost_per_pilgrim: 'abc' });
  assert(!nan.ok && nan.error.message.includes('hotel_cost'), 'non-numeric rejected');

  const zero = validateAssumptions({ ...good(), target_pilgrims: 0 });
  assert(!zero.ok && zero.error.message.includes('greater than zero'), 'zero pilgrims rejected');
}

// ── projection math (mirrors simulate_scenario) ─────────────────────────────

{
  // 500 pilgrims @1500 = 750k revenue; unit cost 900 → cost 450k; margin 300k = 40%
  const p = projectScenario({
    targetPilgrims: 500,
    pricePerPilgrim: 1500,
    flightCostPerPilgrim: 400,
    hotelCostPerPilgrim: 350,
    visaCostPerPilgrim: 100,
    otherCostPerPilgrim: 50,
  });
  assert(p.revenue === minorUnits(75_000_000n), 'revenue minor units');
  assert(p.cost === minorUnits(45_000_000n), 'cost minor units');
  assert(p.margin === minorUnits(30_000_000n), 'margin minor units');
  assert(p.marginPercent === 40, 'margin percent');
}

// keys contract stable
{
  assert(ASSUMPTION_KEYS.length === 6 && ASSUMPTION_KEYS[0] === 'target_pilgrims', 'assumption keys stable');
}

// ── simulation result parsing ───────────────────────────────────────────────

{
  const okParse = parseSimulation({
    projected_revenue: '750000.00',
    projected_cost: '450000.00',
    projected_margin: '300000.00',
    projected_margin_percent: 40,
  });
  assert(okParse.ok, 'string decimals parse');
  if (okParse.ok) {
    assert(okParse.value.projectedMarginPercent === 40, 'percent extracted');
    assert(okParse.value.projectedRevenue === minorUnits(75_000_000n), 'revenue converted');
  }

  const bad = parseSimulation({ projected_revenue: 'x' });
  assert(!bad.ok, 'missing fields rejected');

  const nullish = parseSimulation(null);
  assert(!nullish.ok, 'null rejected');
}

process.stdout.write(`\nfpa slice tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
