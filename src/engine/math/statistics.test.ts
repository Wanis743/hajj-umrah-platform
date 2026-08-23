// Golden dataset unit tests for statistics engine
// Uses process.stdout to avoid console.log lint violations
import { mean, median, sampleVariance, percentile, quartiles } from './statistics';

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

// mean
assert(mean([1,2,3,4,5]) === 3, 'mean [1..5] = 3');
assert(mean([null, 1, null, 3]) === 2, 'mean with nulls');
assert(mean([]) === null, 'mean empty = null');

// median
assert(median([1,2,3,4,5]) === 3, 'median odd');
assert(median([1,2,3,4]) === 2.5, 'median even');

// sampleVariance
const data = [2,4,4,4,5,5,7,9];
assert(Math.abs(sampleVariance(data)! - 4.571) < 0.01, 'sample variance');

// percentile
const d100 = Array.from({length:100}, (_, i) => i + 1);
assert(percentile(d100, 50) === 50.5, 'P50 of 1..100');
assert(percentile(d100, 90) === 90.1, 'P90 of 1..100');
assert(percentile(d100, 99)! > 98, 'P99 of 1..100');

// quartiles
const q = quartiles([1,2,3,4,5,6,7,8]);
assert(q.q2 === 4.5, 'Q2 median of 1..8');

if (failed === 0) {
  process.stdout.write(`✅ All ${passed} statistics tests passed\n`);
} else {
  process.stderr.write(`❌ ${failed} test(s) failed, ${passed} passed\n`);
  process.exit(1);
}
