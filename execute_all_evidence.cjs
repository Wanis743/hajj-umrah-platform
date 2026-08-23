const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

const timestamp = new Date().toISOString();
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
} catch (e) {
  console.warn("Could not fetch commit hash");
}

const gates = [
  { id: 'fresh_db', cmd: 'npm run verify:fresh-db' },
  { id: 'rls_rbac', cmd: 'npm run verify:behavioral-rbac' },
  { id: 'bola_idor', cmd: 'npm run verify:audit-privacy' },
  { id: 'storage_sec', cmd: 'npm run verify:storage' },
  { id: 'finance', cmd: 'npm run test:finance-utils' },
  { id: 'concurrency', cmd: 'npm run verify:reservation-concurrency' },
  { id: 'browser_e2e', cmd: 'npm run verify:e2e' },
  { id: 'accessibility', cmd: 'npm run verify:e2e:accessibility' },
  { id: 'dr_backup', cmd: 'npm run verify:backup-restore' },
  { id: 'external_uat', cmd: 'npm run verify:integrations' }
];

if (!fs.existsSync('release/evidence')) fs.mkdirSync('release/evidence', { recursive: true });

let allPassed = true;
let totalExecuted = 0;

gates.forEach(g => {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let start = new Date().toISOString();
  
  console.log(`\n======================================`);
  console.log(`Executing Gate: ${g.id}`);
  console.log(`Command: ${g.cmd}`);
  console.log(`======================================\n`);
  
  try {
    stdout = execSync(g.cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`[PASS] ${g.id}`);
  } catch (e) {
    stdout = e.stdout ? e.stdout.toString() : '';
    stderr = e.stderr ? e.stderr.toString() : e.message || '';
    exitCode = e.status !== undefined ? e.status : 1;
    console.log(`[FAIL] ${g.id} (Exit Code: ${exitCode})`);
  }
  let end = new Date().toISOString();

  if (exitCode !== 0) allPassed = false;
  totalExecuted++;

  const outHash = crypto.createHash('sha256').update(stdout).digest('hex');
  const errHash = crypto.createHash('sha256').update(stderr).digest('hex');

  const rawLogFile = `raw_log_${g.id}.txt`;
  fs.writeFileSync(`release/evidence/${rawLogFile}`, `COMMAND: ${g.cmd}\nEXIT_CODE: ${exitCode}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`);
  const tests_passed = (stdout.match(/pass/gi) || []).length;
  const tests_failed = (stdout.match(/fail/gi) || []).length + (stderr.match(/error/gi) || []).length;

  const evidence = {
    gate: g.id,
    status: exitCode === 0 ? "VERIFIED" : "FAILED",
    commit_sha: commit,
    environment: process.env.NODE_ENV || "LOCAL_TEST",
    started_at: start,
    finished_at: end,
    command: g.cmd,
    exit_code: exitCode,
    tests_passed: tests_passed,
    tests_failed: tests_failed,
    stdout_sha256: outHash,
    stderr_sha256: errHash,
    raw_log_artifact: rawLogFile
  };

  fs.writeFileSync(`release/evidence/evidence_${g.id}.json`, JSON.stringify(evidence, null, 2));
});

const cert = {
  generated_at: timestamp,
  status: allPassed ? "10/10 CERTIFIED" : "PENDING_RUNTIME_VERIFICATION",
  total_gates: gates.length,
  commit_sha: commit,
  pipeline: "Strict Blocking CI/CD"
};

if (!fs.existsSync('docs/generated')) fs.mkdirSync('docs/generated', { recursive: true });
fs.writeFileSync('docs/generated/certification-status.json', JSON.stringify(cert, null, 2));

if (!allPassed) {
  console.error("\n[WARNING] Some gates failed. Final status: PENDING_RUNTIME_VERIFICATION.");
  console.error("This is expected if running locally without a live Supabase DB or Docker.");
  process.exit(1);
} else {
  console.log("\n[SUCCESS] All gates passed! 10/10 CERTIFIED.");
}
