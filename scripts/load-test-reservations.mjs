import crypto from 'node:crypto';

const enabled = process.env.LOAD_TEST_ENABLE === '1';
if (!enabled) {
  console.log(JSON.stringify({ enabled: false, message: 'Load test is disabled by default. Set LOAD_TEST_ENABLE=1 explicitly for a controlled test target.' }, null, 2));
  process.exit(0);
}
const url = process.env.CREATE_RESERVATION_URL;
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 20);
const requests = Number(process.env.LOAD_TEST_REQUESTS ?? 100);
const timeoutMs = Number(process.env.LOAD_TEST_TIMEOUT_MS ?? 15000);

if (!url) {
  console.error('CREATE_RESERVATION_URL is required.');
  process.exit(2);
}

const payload = (i) => ({
  name: `Load Test ${i}`,
  phone: `055${String(1000000 + i).slice(-7)}`,
  email: `load-${i}@example.invalid`,
  travelers: 1,
  package_id: process.env.LOAD_TEST_PACKAGE_ID || null,
  idempotency_key: `load-${crypto.randomUUID()}`,
});

let next = 0;
let success = 0;
let clientErrors = 0;
let networkErrors = 0;
const statuses = new Map();

async function worker() {
  while (true) {
    const i = next++;
    if (i >= requests) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(i)),
        signal: controller.signal,
      });
      statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
      if (res.ok || res.status === 409 || res.status === 400 || res.status === 422) success++;
      else clientErrors++;
    } catch {
      networkErrors++;
    } finally {
      clearTimeout(timer);
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = Date.now() - started;

console.log(JSON.stringify({
  requests,
  concurrency,
  elapsed_ms: elapsed,
  requests_per_second: Number((requests / Math.max(elapsed / 1000, 0.001)).toFixed(2)),
  acceptable_responses: success,
  unexpected_5xx_or_other: clientErrors,
  network_errors: networkErrors,
  statuses: Object.fromEntries(statuses),
}, null, 2));

if (networkErrors > 0 || clientErrors > 0) process.exit(1);
