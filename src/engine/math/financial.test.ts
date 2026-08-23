// Golden dataset unit tests for financial math engine
// Uses process.stdout to avoid console.log lint violations
import { grossMarginPct, roi, breakEvenUnits, marginOfSafety, requiredPriceForMargin } from './financial';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    process.stderr.write(`FAIL: ${label}\n`);
  }
}

// grossMarginPct
assert(grossMarginPct(1000, 800) === 20, 'grossMarginPct 20%');
assert(grossMarginPct(1000, 0) === 100, 'grossMarginPct 100%');
assert(grossMarginPct(0, 800) === null, 'grossMarginPct revenue=0 → null');
assert(grossMarginPct(null, 800) === null, 'grossMarginPct null revenue → null');

// roi
assert(roi(1500, 1000) === 50, 'ROI 50%');
assert(roi(1000, 0) === null, 'ROI cost=0 → null');

// breakEvenUnits
assert(breakEvenUnits(10000, 500, 300) === 50, 'Break-even 50 units');
assert(breakEvenUnits(10000, 300, 300) === null, 'Break-even: no contribution margin → null');

// marginOfSafety
assert(marginOfSafety(1000, 600) === 40, 'Margin of safety 40%');
assert(marginOfSafety(0, 600) === null, 'MoS actual=0 → null');

// requiredPriceForMargin
assert(Math.abs(requiredPriceForMargin(800, 20)! - 1000) < 0.01, 'Required price for 20% margin');
assert(requiredPriceForMargin(800, 100) === null, 'Margin=100% → null');

if (failed === 0) {
  process.stdout.write(`✅ All ${passed} financial math tests passed\n`);
} else {
  process.stderr.write(`❌ ${failed} test(s) failed, ${passed} passed\n`);
  process.exit(1);
}
