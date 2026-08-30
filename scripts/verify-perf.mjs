/**
 * The performance gate.
 *
 * release/manifest.json carried a "Gate F - Performance: VERIFIED" line with no
 * script behind it, no numbers, and no artifact. This is the missing gate, in
 * the only form that can run on every commit without a staging environment: a
 * size budget over the built output.
 *
 * What it measures, and why these three:
 *
 *   initial   index.html + the entry chunk + the entry stylesheet, gzipped. The
 *             bytes between a cold visit and first paint; everything else is
 *             route-split behind React.lazy and does not block it.
 *   largest   the biggest single chunk, gzipped. Catches a lazy route quietly
 *             absorbing a heavyweight dependency.
 *   total     every emitted js/css, gzipped. Catches growth that hides by
 *             spreading itself thinly across chunks.
 *
 * Budgets are the measurement taken on the commit that introduced this file,
 * plus deliberate headroom — tight enough that a regression trips them, loose
 * enough that ordinary work does not. Raising one is a decision that belongs in
 * a diff, with a reason, which is the point of writing them down here.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = process.cwd();
const dist = path.join(root, 'dist');
const assets = path.join(dist, 'assets');

/** gzip -9, so the number matches what a CDN serves rather than a local default. */
const gzipped = (buffer) => zlib.gzipSync(buffer, { level: 9 }).length;

// Measured 2026-08-30 at 2e3fb0b: initial 136,252 · largest 125,314 · total 804,516.
const budgets = {
  initial: 160_000,
  largest: 140_000,
  total: 900_000,
};

if (!fs.existsSync(assets)) {
  console.error('PERF GATE FAIL: dist/assets is missing. Run `npm run build` first — this gate reads the real output, not an estimate.');
  process.exit(1);
}

const indexHtmlPath = path.join(dist, 'index.html');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

/** The entry chunk and stylesheet, as index.html itself references them. */
const entryScript = indexHtml.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)?.[1];
const entryStyle = indexHtml.match(/<link[^>]+href="\/assets\/([^"]+\.css)"/)?.[1];

const failures = [];
if (entryScript === undefined) failures.push('dist/index.html references no entry script; the initial-load budget cannot be computed.');
if (entryStyle === undefined) failures.push('dist/index.html references no stylesheet; the initial-load budget cannot be computed.');

const files = fs
  .readdirSync(assets)
  .filter((name) => /\.(js|css)$/.test(name))
  .map((name) => {
    const bytes = fs.readFileSync(path.join(assets, name));
    return { name, raw: bytes.length, gzip: gzipped(bytes) };
  })
  .sort((a, b) => b.gzip - a.gzip);

const sizeOf = (name) => files.find((file) => file.name === name)?.gzip ?? 0;

const measured = {
  initial: gzipped(Buffer.from(indexHtml)) + sizeOf(entryScript) + sizeOf(entryStyle),
  largest: files[0]?.gzip ?? 0,
  total: files.reduce((sum, file) => sum + file.gzip, 0),
};

for (const [name, budget] of Object.entries(budgets)) {
  const actual = measured[name];
  const over = actual - budget;
  if (over > 0) {
    failures.push(`${name}: ${actual.toLocaleString()} B gzipped exceeds the ${budget.toLocaleString()} B budget by ${over.toLocaleString()} B.`);
  }
}

const pct = (actual, budget) => `${Math.round((actual / budget) * 100)}%`;
console.log('Bundle budgets (gzip):');
for (const [name, budget] of Object.entries(budgets)) {
  console.log(`  ${name.padEnd(8)} ${String(measured[name].toLocaleString()).padStart(11)} B  of ${budget.toLocaleString()} B  (${pct(measured[name], budget)})`);
}
console.log(`  largest chunk: ${files[0]?.name ?? '(none)'}`);

if (failures.length > 0) {
  console.error('PERF GATE FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('\nEither reduce the payload or raise the budget in scripts/verify-perf.mjs with a reason. Do not do the latter quietly.');
  process.exit(1);
}
console.log(`PERF GATE PASS (${files.length} emitted assets measured)`);
