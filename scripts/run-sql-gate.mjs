/**
 * The SQL gate runner — the thing that makes a report fail.
 *
 * Six of the ten suites under supabase/tests/ are written as reports:
 *
 *     select 'anon_audit_update' as check_name,
 *            has_table_privilege('anon','public.audit_logs','update') = false as pass;
 *
 * Run under `psql -v ON_ERROR_STOP=1`, a `pass` of `f` prints a row and exits 0.
 * `scripts/fresh-db-replay.sh` and `npm run verify:security` invoked them exactly
 * that way, and release/manifest.json called the result VERIFIED. A gate that
 * cannot fail is worse than no gate: it launders an unknown into a guarantee.
 *
 * So suites are run through here instead. This wrapper fails when:
 *
 *   - psql exits nonzero (an EXCEPTION or ASSERT inside the suite), or
 *   - any emitted `pass` column is false, or
 *   - the suite asserted *nothing* — no `pass` rows and no `raise exception`
 *     in its text. A suite that cannot express failure is not evidence, and
 *     silently reporting PASS for it is how this problem started.
 *
 * Usage:  node scripts/run-sql-gate.mjs supabase/tests/security_rls.sql [...]
 *         node scripts/run-sql-gate.mjs --self-test
 *
 * `--self-test` checks the verdict logic against fixtures, with no database, so
 * CI verifies the runner itself on every push.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * psql `--csv` prints one block per result set: a header line, then rows, then a
 * blank line. Blocks without a `pass` column are informational (the RLS-status
 * listing at the end of the BOLA suite, for example) and are not verdicts.
 *
 * Returns `{ checked, failures }` — `checked` counts the verdicts seen, so the
 * caller can tell "everything passed" from "nothing was asserted".
 */
export function readVerdicts(csv) {
  const failures = [];
  let checked = 0;

  for (const block of csv.split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length < 2) continue;

    const header = lines[0].split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const passAt = header.indexOf('pass');
    if (passAt === -1) continue;
    const nameAt = header.findIndex((cell) => cell === 'check_name' || cell === 'name');

    for (const line of lines.slice(1)) {
      const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
      const value = (cells[passAt] ?? '').toLowerCase();
      // psql renders booleans as t/f; a NULL comes through as an empty cell and
      // is a failure, not a pass — an invariant that could not be evaluated is
      // not an invariant that held.
      if (value === 't' || value === 'true') {
        checked += 1;
        continue;
      }
      checked += 1;
      const label = nameAt === -1 ? '(unnamed check)' : (cells[nameAt] ?? '(unnamed check)');
      failures.push(`${label}: pass=${cells[passAt] === '' ? 'NULL' : cells[passAt]}`);
    }
  }

  return { checked, failures };
}

/** Whether a suite can fail on its own, i.e. it raises rather than only reporting. */
export function raisesOnFailure(sql) {
  return /raise\s+exception/i.test(sql) || /\bassert\s/i.test(sql.replace(/--[^\n]*/g, ''));
}

function selfTest() {
  const cases = [
    ['all true', 'check_name,pass\nanon_audit_update,t\n', { checked: 1, failures: 0 }],
    ['one false', 'check_name,pass\na,t\n\ncheck_name,pass\nb,f\n', { checked: 2, failures: 1 }],
    ['null pass', 'check_name,pass\na,\n', { checked: 1, failures: 1 }],
    ['no pass column', 'schemaname,tablename,rowsecurity\npublic,pilgrims,t\n', { checked: 0, failures: 0 }],
    ['header only', 'check_name,pass\n', { checked: 0, failures: 0 }],
    ['quoted cells', '"check_name","pass"\n"a","t"\n', { checked: 1, failures: 0 }],
    ['multi row block', 'check_name,pass\na,t\nb,f\nc,t\n', { checked: 3, failures: 1 }],
  ];

  const problems = [];
  for (const [label, csv, want] of cases) {
    const got = readVerdicts(csv);
    if (got.checked !== want.checked || got.failures.length !== want.failures) {
      problems.push(`${label}: expected checked=${want.checked} failures=${want.failures}, got checked=${got.checked} failures=${got.failures.length}`);
    }
  }
  for (const [label, sql, want] of [
    ['raises', 'begin raise exception \'no\'; end', true],
    ['asserts', 'assert (select count(*) from t) = 0;', true],
    ['comment only', '-- these assertions validate the posted journal shapes', false],
    ['warns only', "raise warning 'leaked %', n;", false],
  ]) {
    if (raisesOnFailure(sql) !== want) problems.push(`raisesOnFailure(${label}): expected ${want}`);
  }

  if (problems.length > 0) {
    console.error('SQL GATE SELF-TEST FAIL');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log(`SQL GATE SELF-TEST PASS (${cases.length + 4} cases)`);
}

function runSuite(suite, dbUrl) {
  const sql = fs.readFileSync(suite, 'utf8');
  const result = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '--csv', '-f', suite], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    return { ok: false, reason: `psql could not be started: ${result.error.message}`, stdout: '', stderr: '' };
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.status !== 0) {
    return { ok: false, reason: `psql exited ${result.status}`, stdout, stderr };
  }

  const { checked, failures } = readVerdicts(stdout);
  if (failures.length > 0) {
    return { ok: false, reason: `${failures.length} of ${checked} checks failed:\n    ${failures.join('\n    ')}`, stdout, stderr };
  }
  if (checked === 0 && !raisesOnFailure(sql)) {
    return {
      ok: false,
      reason: 'suite asserted nothing: no `pass` rows and no raise/assert in its text, so a regression could not have failed it',
      stdout,
      stderr,
    };
  }
  return { ok: true, checked, stdout, stderr };
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}
if (args.length === 0) {
  console.error('usage: node scripts/run-sql-gate.mjs <suite.sql> [...] | --self-test');
  process.exit(2);
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (dbUrl === undefined || dbUrl === '') {
  console.error('SQL GATE FAIL: SUPABASE_DB_URL is not set. These suites need a database; skipping them silently is what produced a VERIFIED manifest over unrun tests.');
  process.exit(1);
}

let failed = false;
for (const suite of args) {
  const rel = path.relative(process.cwd(), suite).replaceAll(path.sep, '/');
  const outcome = runSuite(suite, dbUrl);
  if (outcome.ok) {
    console.log(`PASS ${rel} (${outcome.checked} check${outcome.checked === 1 ? '' : 's'})`);
    continue;
  }
  failed = true;
  console.error(`FAIL ${rel}: ${outcome.reason}`);
  if (outcome.stderr.trim() !== '') console.error(outcome.stderr.trim());
}
process.exit(failed ? 1 : 0);
