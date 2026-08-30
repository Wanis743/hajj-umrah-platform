/**
 * The supply-chain evidence gate.
 *
 * release/sbom.cdx.json was, in its entirety:
 *
 *     { "bomFormat": "CycloneDX", "specVersion": "1.4" }
 *
 * Three lines, zero components, no timestamp — and release/manifest.json cited
 * it as "Gate H - Supply chain: VERIFIED". A bill of materials listing nothing
 * is not a bill of materials; it is a filename that looks like one.
 *
 * So this script generates the real thing from the installed tree and refuses to
 * accept a document that describes nothing:
 *
 *   - `npm sbom --sbom-format cyclonedx --omit dev` over the actual lockfile,
 *   - the result must parse, carry a serial number and timestamp, and list more
 *     components than the floor below (a real graph here is in the hundreds),
 *   - every component must have a version, since an unversioned entry cannot be
 *     matched against an advisory, which is the only reason to keep an SBOM.
 *
 * Runs without secrets or network, so it belongs in `verify:static`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'release', 'sbom.cdx.json');
/** A production graph this small would mean npm resolved almost nothing. */
const MIN_COMPONENTS = 50;

// One fixed command string through the shell, rather than an argv array plus
// `shell: true` — Node deprecates that pairing (DEP0190) because the arguments
// are concatenated rather than escaped. There is no interpolation here: every
// character below is a literal, so the shell has nothing to reinterpret. A bare
// `npm` also cannot be spawned without a shell on Windows (it is npm.cmd).
//
// The inherited `npm_config_*` block is dropped for the same reason as in
// scripts/verify-audit.mjs: npm exports its resolved config to child processes,
// and a nested npm command can be rejected by settings that were fine for the
// parent (`npm_config_allow_scripts` makes npm 11 exit EALLOWSCRIPTS here).
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('npm_config_')));
const run = spawnSync('npm sbom --sbom-format cyclonedx --omit dev', {
  shell: true,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: childEnv,
});
if (run.status !== 0) {
  console.error('SBOM GATE FAIL: `npm sbom` exited nonzero.');
  console.error((run.stderr ?? '').trim());
  process.exit(1);
}

const failures = [];
let sbom = null;
try {
  sbom = JSON.parse(run.stdout);
} catch (error) {
  failures.push(`\`npm sbom\` did not emit valid JSON: ${error.message}`);
}

if (sbom !== null) {
  const components = Array.isArray(sbom.components) ? sbom.components : [];
  if (sbom.bomFormat !== 'CycloneDX') failures.push(`bomFormat is \`${sbom.bomFormat}\`, not CycloneDX.`);
  if ((sbom.serialNumber ?? '') === '') failures.push('the document carries no serialNumber, so two runs cannot be told apart.');
  if ((sbom.metadata?.timestamp ?? '') === '') failures.push('the document carries no metadata.timestamp, so it cannot be dated.');
  if (components.length < MIN_COMPONENTS) {
    failures.push(`only ${components.length} component(s) listed; under ${MIN_COMPONENTS} means the graph was not resolved. The committed file had 0 and was cited as VERIFIED.`);
  }
  const unversioned = components.filter((component) => (component.version ?? '') === '').map((component) => component.name);
  if (unversioned.length > 0) {
    failures.push(`${unversioned.length} component(s) have no version, so they cannot be matched to an advisory: ${unversioned.slice(0, 5).join(', ')}${unversioned.length > 5 ? ' …' : ''}`);
  }

  if (failures.length === 0) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`);
    console.log(`SBOM GATE PASS (${components.length} production components, CycloneDX ${sbom.specVersion} → release/sbom.cdx.json)`);
  }
}

if (failures.length > 0) {
  console.error('SBOM GATE FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
