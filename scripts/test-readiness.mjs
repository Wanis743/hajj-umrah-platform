import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.READINESS_STRIPPED !== '1') {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, READINESS_STRIPPED: '1' } });
  process.exit(result.status ?? 1);
}

const { calculateGroupReadiness } = await import('../src/engine/groupReadiness.ts');

const members = [
  { id: 'p1', requiredPaymentDzd: 100, requiredDocuments: ['PASSPORT'], communicationRequired: true },
  { id: 'p2', requiredPaymentDzd: 100, requiredDocuments: ['PASSPORT'], communicationRequired: true },
];
const rules = [
  { code: 'DOCUMENTS', weight: 20, config: { required: true, min_score: 100 } },
  { code: 'VISA', weight: 20, config: { required: true, min_score: 100 } },
  { code: 'FLIGHT', weight: 15, config: { required: true, min_score: 100 } },
  { code: 'HOTEL', weight: 10 },
  { code: 'TRANSPORT', weight: 10 },
  { code: 'PAYMENTS', weight: 15 },
  { code: 'COMMUNICATION', weight: 5 },
  { code: 'GUIDE', weight: 5, config: { required: true, min_score: 100 } },
];
const partial = calculateGroupReadiness(
  { id: 'g1', departureDate: new Date(Date.now() + 72 * 3600000).toISOString() },
  members,
  [{ member_id: 'p1', status: 'APPROVED' }, { member_id: 'p2', status: 'APPROVED' }],
  [{ member_id: 'p1', type: 'PASSPORT', status: 'VALIDATED' }],
  [{ member_id: 'p1', status: 'SCHEDULED' }, { member_id: 'p2', status: 'SCHEDULED' }],
  [{ member_id: 'p1', status: 'CONFIRMED' }],
  [{ member_id: 'p1', status: 'ASSIGNED' }],
  [{ member_id: 'p1', status: 'CONFIRMED', amount_dzd: 100 }],
  [{ id: 'guide-1', status: 'ACTIVE' }],
  [{ member_id: 'p1', status: 'DELIVERED' }],
  rules,
);
assert(partial.components.DOCUMENTS < 100);
assert(partial.components.PAYMENTS < 100);
assert(partial.components.COMMUNICATION < 100);
assert.equal(partial.status, 'WARNING');
console.log('Readiness semantics verification passed.');
