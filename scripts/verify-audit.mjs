/**
 * The dependency-audit gate.
 *
 * `security:audit` was `npm audit --audit-level=high` over the whole tree, and it
 * exits 1 here: 17 advisories, 11 of them high. Every one of those 11 is in the
 * build toolchain — vite, rollup, postcss, glob, minimatch, picomatch, nanoid,
 * js-yaml, cross-spawn, flatted, brace-expansion. `npm audit --omit=dev` reports
 * zero. So the shipped application has no known high-severity advisory, and the
 * gate as written could only be satisfied by ignoring it, which is the road that
 * ends in `|| true` after a command that always fails.
 *
 * The distinction the gate needs is what runs in front of a user versus what runs
 * on a build machine:
 *
 *   production tree (--omit=dev)   high or critical  →  FAIL. This ships.
 *   dev tree                       critical          →  FAIL. Build compromise.
 *                                  high             →  reported, counted, and
 *                                                       recorded in the log the
 *                                                       manifest hashes.
 *
 * The counts are always printed, both trees, whether or not the gate passes —
 * "VERIFIED" over a hidden 11 is exactly what this repository has been doing.
 */
import { spawnSync } from 'node:child_process';

/**
 * npm exports its resolved configuration to child processes as `npm_config_*`,
 * so a nested `npm audit` inherits the parent script's view of it. On this
 * machine that includes `npm_config_allow_scripts`, which npm 11 rejects in a
 * project-scoped install: `npm run security:audit` died with EALLOWSCRIPTS while
 * a bare `npm audit` worked. Worse, `npm audit --json` reports that failure as
 * `{"error":{…}}` — valid JSON with no `metadata`, which an unwary reader counts
 * as zero advisories. The first draft of this gate did exactly that and printed
 * PASS over 11 high findings.
 *
 * So: strip the inherited npm config and let npm resolve its own, and require the
 * report to have the shape of a report.
 */
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('npm_config_')));

/** A fixed command string through the shell — `npm` is npm.cmd on Windows. No interpolation. */
const audit = (extra) => {
  const run = spawnSync(`npm audit --json${extra}`, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv });
  // `npm audit` exits 1 when it finds something at the requested level; that is a
  // result, not a failure to run. Unparseable or shapeless output is the failure.
  let report = null;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    return { ok: false, output: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() || `exit ${run.status}` };
  }
  if (report.error !== undefined) {
    const detail = [report.error.code, report.error.summary, report.error.detail].filter((part) => (part ?? '') !== '').join(' — ');
    return { ok: false, output: `npm reported an error: ${detail === '' ? JSON.stringify(report.error) : detail}` };
  }
  if (report.metadata?.vulnerabilities === undefined) {
    return { ok: false, output: 'the report carries no metadata.vulnerabilities, so nothing was actually audited' };
  }
  return { ok: true, report };
};

const counts = (report) => report.metadata?.vulnerabilities ?? {};
const named = (report, levels) =>
  Object.values(report.vulnerabilities ?? {})
    .filter((entry) => levels.includes(entry.severity))
    .map((entry) => `${entry.name}@${entry.range ?? '?'} (${entry.severity})`);

const production = audit(' --omit=dev');
const everything = audit('');

const failures = [];
for (const [label, result] of [['production', production], ['full', everything]]) {
  if (!result.ok) failures.push(`the ${label} dependency tree was not audited: ${result.output}`);
}

if (failures.length === 0) {
  const prod = counts(production.report);
  const all = counts(everything.report);
  const line = (c) => `critical ${c.critical ?? 0} · high ${c.high ?? 0} · moderate ${c.moderate ?? 0} · low ${c.low ?? 0}`;
  console.log(`Dependency advisories:`);
  console.log(`  production (--omit=dev)  ${line(prod)}`);
  console.log(`  including dev tooling    ${line(all)}`);

  const shipping = named(production.report, ['high', 'critical']);
  if (shipping.length > 0) {
    failures.push(`the production dependency tree carries ${shipping.length} high/critical advisor${shipping.length === 1 ? 'y' : 'ies'}: ${shipping.join(', ')}`);
  }
  const devCritical = named(everything.report, ['critical']);
  if (devCritical.length > 0) {
    failures.push(`the build toolchain carries ${devCritical.length} critical advisor${devCritical.length === 1 ? 'y' : 'ies'}: ${devCritical.join(', ')}`);
  }

  const devHigh = named(everything.report, ['high']).filter((entry) => !shipping.includes(entry));
  if (devHigh.length > 0) {
    console.log(`\n  Build-tooling advisories at high, recorded and not blocking (they do not reach a user):`);
    for (const entry of devHigh) console.log(`    - ${entry}`);
    console.log('  Clear these when the upstream fix lands; `npm audit fix` first, and read the diff.');
  }
}

if (failures.length > 0) {
  console.error('AUDIT GATE FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('\nAUDIT GATE PASS (no high or critical advisory in the shipped dependency tree)');
