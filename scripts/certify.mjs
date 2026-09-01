/**
 * The certification runner.
 *
 * release/manifest.json used to be written by hand. It said:
 *
 *     "certification": "VERIFIED",
 *     "Gate C - Behavioral security": "VERIFIED",
 *     "Gate D - Browser E2E": "VERIFIED",
 *     "Gate G - DR": "VERIFIED"
 *
 * while the evidence directory underneath it said `"status": "FAILED"` for
 * rls_rbac and bola_idor, release/e2e-results/summary.txt said "E2E tests
 * pending real browser environment", release/dr-results/summary.txt said "DR
 * restore drills pending staging database", build-hash.txt and schema-hash.txt
 * were the literal strings BUILD_HASH_PLACEHOLDER and SCHEMA_HASH_PLACEHOLDER,
 * and the commit the evidence named — 5680941 — is not an object in this
 * repository at all. Every one of those files was a claim, not a measurement.
 *
 * This script replaces all of it. The verdict is derived, never asserted:
 *
 *   VERIFIED    every gate ran and passed, at this commit, with a clean tree
 *   INCOMPLETE  nothing failed, but a gate could not run (missing environment)
 *   FAILED      a gate ran and failed
 *
 * A gate whose environment is absent is SKIPPED, and SKIPPED is not VERIFIED —
 * that single rule is what the old manifest violated. Gates the platform cannot
 * yet have are recorded as ABSENT with the reason, so the file states what is
 * missing instead of omitting it. That list is empty as of the BI studio slice.
 *
 * Usage:  node scripts/certify.mjs            run everything available
 *         node scripts/certify.mjs --list     show the gates and their status
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const releaseDir = path.join(root, 'release');
const evidenceDir = path.join(releaseDir, 'evidence');

const sh = (command) =>
  spawnSync(command, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env });
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const git = (args) => sh(`git ${args}`).stdout.trim();

/**
 * The gate table. `env` lists the variables the underlying script itself
 * demands; when one is missing the gate is SKIPPED rather than run and reported
 * as an error, because "we could not test this" and "this is broken" are
 * different facts and the manifest has to be able to say which.
 *
 * Order matters: static gates first (cheap, no secrets), then the build, then
 * everything that needs a real environment.
 */
const GATES = [
  { name: 'static', label: 'Static gates (source, any, architecture, OS boundary, migrations)', command: 'npm run verify:static', env: [] },
  { name: 'sql_gate_selftest', label: 'SQL gate runner self-test', command: 'node scripts/run-sql-gate.mjs --self-test', env: [] },
  { name: 'typecheck', label: 'TypeScript', command: 'npm run typecheck', env: [] },
  { name: 'lint', label: 'Lint', command: 'npm run lint', env: [] },
  { name: 'supply_chain', label: 'Dependency audit', command: 'npm run security:audit', env: [] },
  { name: 'build', label: 'Production build', command: 'npm run build', env: [] },
  { name: 'performance', label: 'Bundle budgets', command: 'node scripts/verify-perf.mjs', env: [] },

  { name: 'schema_contracts', label: 'Schema and hardening contracts', command: 'npm run verify:contracts', env: ['SUPABASE_DB_URL'] },
  { name: 'no_demo_data', label: 'No demo or seed data in the live database', command: 'npm run verify:no-demo', env: ['SUPABASE_DB_URL'] },
  { name: 'rls', label: 'RLS and authorization matrix', command: 'npm run verify:rls', env: ['SUPABASE_DB_URL'] },
  { name: 'bola_idor', label: 'BOLA/IDOR cross-agency isolation', command: 'npm run verify:bola', env: ['SUPABASE_DB_URL'] },
  { name: 'storage_security', label: 'Storage and audit-log security', command: 'npm run verify:storage-sql', env: ['SUPABASE_DB_URL'] },
  { name: 'finance_workflows', label: 'Finance invariants and accounting workflows', command: 'npm run verify:finance-sql', env: ['SUPABASE_DB_URL'] },
  { name: 'crm', label: 'CRM pipeline (lead → customer → opportunity → quote → booking → payment)', command: 'npm run verify:crm', env: ['SUPABASE_DB_URL'] },
  { name: 'dms', label: 'DMS lifecycle (upload → version → extract → review → approve → seal → expire)', command: 'npm run verify:dms', env: ['SUPABASE_DB_URL'] },
  { name: 'bi', label: 'BI studio (semantic layer, metric registry, drill-through, lineage, dashboards)', command: 'npm run verify:bi', env: ['SUPABASE_DB_URL'] },
  // Needs the Supabase CLI and Docker, which no environment variable can prove
  // are present, so it is opt-in: FRESH_DB_ENABLE=1 says "this machine can run a
  // throwaway stack". Skipped rather than attempted anywhere else.
  { name: 'fresh_db_replay', label: 'Fresh database rebuilt from migrations alone', command: 'npm run verify:fresh-db', env: ['FRESH_DB_ENABLE'] },

  { name: 'rbac_behavioral', label: 'Behavioral RBAC (real staff sessions)', command: 'npm run verify:behavioral-rbac', env: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TEST_ENV', 'RBAC_TEST_PASSWORD'] },
  { name: 'storage_runtime', label: 'Storage runtime (anonymous access denied)', command: 'npm run verify:storage', env: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] },
  { name: 'browser_e2e', label: 'Browser E2E', command: 'npm run verify:e2e', env: ['E2E_BASE_URL', 'E2E_TEST_EMAIL', 'E2E_TEST_PASSWORD'] },
  { name: 'accessibility', label: 'Accessibility, RTL and mobile', command: 'npm run verify:e2e:accessibility', env: ['E2E_BASE_URL', 'E2E_TEST_EMAIL', 'E2E_TEST_PASSWORD', 'E2E_ENV'] },
  { name: 'concurrency', label: 'Reservation concurrency under load', command: 'npm run verify:reservation-concurrency', env: ['LOAD_TEST_ENABLE', 'LOAD_TEST_ENV', 'E2E_BASE_URL', 'TEST_PACKAGE_ID', 'TEST_TURNSTILE_TOKEN', 'TEST_CAPACITY_BEFORE'] },
  { name: 'dr_backup', label: 'Backup and restore drill', command: 'npm run verify:backup-restore', env: ['BACKUP_DRILL_ENV', 'SUPABASE_DB_URL', 'RESTORE_DB_URL'] },
];

/**
 * Gates that were asked for and have nothing to run yet. Naming them here is the
 * point: a certification that silently omits CRM is indistinguishable from one
 * where CRM passed.
 *
 * The list is empty, and it stays in the file rather than being deleted with its
 * last entry. Emptiness is a claim -- every demanded gate now has something to run
 * -- and the next subsystem that is demanded before it is built belongs here on the
 * day it is demanded, not in a commit that also has to reintroduce the machinery.
 */
const ABSENT = [];

/**
 * A content hash over a directory tree: every file's path and bytes, in sorted
 * order, folded into one digest. Sorted so the value is reproducible across
 * filesystems, and path-inclusive so a rename changes it.
 *
 * This is what build-hash.txt and schema-hash.txt should always have held.
 */
function hashTree(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  files.sort();
  const digest = crypto.createHash('sha256');
  for (const file of files) {
    digest.update(path.relative(root, file).replaceAll(path.sep, '/'));
    digest.update(fs.readFileSync(file));
  }
  return { hash: digest.digest('hex'), files: files.length };
}

/** Which of a gate's required variables are absent or empty. */
const missingEnv = (gate) => gate.env.filter((name) => (process.env[name] ?? '') === '');

if (process.argv.includes('--list')) {
  console.log(`Certification gates at ${git('rev-parse --short HEAD')}:\n`);
  for (const gate of GATES) {
    const missing = missingEnv(gate);
    const state = missing.length === 0 ? 'runnable' : `SKIPPED — needs ${missing.join(', ')}`;
    console.log(`  ${gate.name.padEnd(18)} ${state}`);
  }
  for (const gate of ABSENT) console.log(`  ${gate.name.padEnd(18)} ABSENT — ${gate.reason}`);
  process.exit(0);
}

const startedAt = new Date().toISOString();
const commit = git('rev-parse HEAD');
const treeDirty = git('status --porcelain') !== '';

fs.rmSync(evidenceDir, { recursive: true, force: true });
fs.mkdirSync(evidenceDir, { recursive: true });
// The previous verdict goes first, before any gate runs. Two reasons: a run that
// crashes half-way must not leave the old VERIFIED standing over new evidence,
// and the `static` gate below invokes verify:evidence, which would otherwise be
// checking a manifest whose logs this run has just deleted.
for (const stale of ['manifest.json', 'build-hash.txt', 'schema-hash.txt']) {
  fs.rmSync(path.join(releaseDir, stale), { force: true });
}

console.log(`Certifying ${commit.slice(0, 7)}${treeDirty ? ' (WORKING TREE DIRTY)' : ''}\n`);

const results = [];
for (const gate of GATES) {
  const missing = missingEnv(gate);
  if (missing.length > 0) {
    console.log(`SKIP ${gate.name} — missing ${missing.join(', ')}`);
    results.push({ ...gate, status: 'SKIPPED', reason: `required environment absent: ${missing.join(', ')}` });
    continue;
  }

  process.stdout.write(`RUN  ${gate.name} … `);
  const begun = Date.now();
  const run = sh(gate.command);
  const seconds = Math.round((Date.now() - begun) / 100) / 10;
  const log = `$ ${gate.command}\n\n${run.stdout ?? ''}${run.stderr ?? ''}`;
  const logFile = path.join(evidenceDir, `${gate.name}.log`);
  fs.writeFileSync(logFile, log);

  const status = run.status === 0 ? 'VERIFIED' : 'FAILED';
  console.log(`${status} (${seconds}s)`);
  if (status === 'FAILED') {
    const tail = log.trim().split(/\r?\n/).slice(-12).join('\n');
    console.log(tail.replace(/^/gm, '     │ '));
  }
  results.push({
    ...gate,
    status,
    exit_code: run.status,
    duration_seconds: seconds,
    log: `evidence/${gate.name}.log`,
    log_sha256: sha256(log),
  });
}

/**
 * The verdict. FAILED dominates SKIPPED dominates VERIFIED, and a dirty tree
 * cannot be certified at all: the artifact names a commit, so the bytes tested
 * have to be the bytes that commit contains.
 */
const failed = results.filter((gate) => gate.status === 'FAILED');
const skipped = results.filter((gate) => gate.status === 'SKIPPED');
let certification = 'VERIFIED';
const caveats = [];
if (failed.length > 0) {
  certification = 'FAILED';
  caveats.push(`${failed.length} gate(s) ran and failed: ${failed.map((gate) => gate.name).join(', ')}`);
}
if (skipped.length > 0) {
  if (certification !== 'FAILED') certification = 'INCOMPLETE';
  caveats.push(`${skipped.length} gate(s) could not run: ${skipped.map((gate) => gate.name).join(', ')}`);
}
if (ABSENT.length > 0) {
  if (certification === 'VERIFIED') certification = 'INCOMPLETE';
  caveats.push(`${ABSENT.length} demanded gate(s) have no implementation to test: ${ABSENT.map((gate) => gate.name).join(', ')}`);
}
if (treeDirty) {
  if (certification === 'VERIFIED') certification = 'INCOMPLETE';
  caveats.push('working tree was not clean, so the gates did not run against the named commit alone');
}

const build = hashTree(path.join(root, 'dist'));
const schema = hashTree(path.join(root, 'supabase', 'migrations'));
fs.writeFileSync(
  path.join(releaseDir, 'build-hash.txt'),
  build === null ? 'ABSENT: dist/ was not built during this run\n' : `${build.hash}  (${build.files} files)\n`,
);
fs.writeFileSync(
  path.join(releaseDir, 'schema-hash.txt'),
  schema === null ? 'ABSENT: supabase/migrations/ not found\n' : `${schema.hash}  (${schema.files} migrations)\n`,
);

const manifest = {
  // Read this file top-down: what was tested, then what came out. Every value
  // below was measured by this run. Nothing here is editable by hand — the next
  // `npm run certify` overwrites it, and `npm run verify:evidence` fails the
  // build if it ever disagrees with the evidence beside it.
  generator: 'scripts/certify.mjs',
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  commit,
  commit_short: commit.slice(0, 7),
  branch: git('rev-parse --abbrev-ref HEAD'),
  working_tree: treeDirty ? 'DIRTY' : 'CLEAN',
  build_hash: build?.hash ?? null,
  schema_hash: schema?.hash ?? null,
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  certification,
  caveats,
  totals: {
    verified: results.filter((gate) => gate.status === 'VERIFIED').length,
    failed: failed.length,
    skipped: skipped.length,
    absent: ABSENT.length,
  },
  gates: results.map((gate) => ({
    name: gate.name,
    label: gate.label,
    status: gate.status,
    command: gate.command,
    ...(gate.status === 'SKIPPED'
      ? { reason: gate.reason, required_env: gate.env }
      : { exit_code: gate.exit_code, duration_seconds: gate.duration_seconds, log: gate.log, log_sha256: gate.log_sha256 }),
  })),
  absent_gates: ABSENT.map((gate) => ({ name: gate.name, label: gate.label, status: 'ABSENT', reason: gate.reason })),
};
fs.writeFileSync(path.join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\n${'─'.repeat(72)}`);
for (const gate of results) console.log(`  ${gate.status.padEnd(9)} ${gate.name.padEnd(18)} ${gate.label}`);
for (const gate of ABSENT) console.log(`  ${'ABSENT'.padEnd(9)} ${gate.name.padEnd(18)} ${gate.label}`);
console.log('─'.repeat(72));
console.log(`CERTIFICATION: ${certification}`);
for (const caveat of caveats) console.log(`  · ${caveat}`);
console.log(`\nWritten: release/manifest.json, release/build-hash.txt, release/schema-hash.txt, release/evidence/*.log`);

// Exit nonzero on FAILED only. INCOMPLETE is an honest outcome on a developer
// machine without staging secrets, and blocking on it would push people back
// toward writing the verdict by hand — which is the failure this replaces. CI
// supplies the secrets, so there INCOMPLETE is itself a finding to look at.
process.exit(certification === 'FAILED' ? 1 : 0);
