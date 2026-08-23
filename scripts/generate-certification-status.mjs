import fs from 'fs';
import path from 'path';

const evidenceDir = path.join(process.cwd(), 'release', 'evidence');
const outputCert = path.join(process.cwd(), 'docs', 'generated', 'certification-status.json');

console.log('--- Generating Official Certification Status ---');

let allPassed = true;
let totalGates = 0;
let totalTestsPassed = 0;
let commitSha = 'unknown';
let artifactHash = 'unknown';

const requiredGates = [
  'fresh_db',
  'rls_rbac',
  'bola_idor',
  'storage_sec',
  'finance',
  'concurrency',
  'browser_e2e',
  'accessibility',
  'dr_backup',
  'external_uat'
];

if (!fs.existsSync(evidenceDir)) {
  console.error('[ERROR] release/evidence directory not found. Please run execute_all_evidence.cjs first.');
  process.exit(1);
}

const evidenceFiles = fs.readdirSync(evidenceDir).filter(f => f.startsWith('evidence_') && f.endsWith('.json'));

const checkedGates = new Set();

evidenceFiles.forEach(file => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(evidenceDir, file), 'utf8'));
    checkedGates.add(data.gate);
    
    if (commitSha === 'unknown' && data.commit_sha) commitSha = data.commit_sha;
    if (artifactHash === 'unknown' && data.stdout_sha256) artifactHash = data.stdout_sha256;
    
    totalGates++;
    totalTestsPassed += (data.tests_passed || 0);
    
    if (data.status !== 'VERIFIED') {
      console.log(`[FAIL] Gate ${data.gate} is not VERIFIED (Status: ${data.status})`);
      allPassed = false;
    } else {
      console.log(`[PASS] Gate ${data.gate} is VERIFIED`);
    }
  } catch (err) {
    console.error(`[ERROR] Failed to read or parse evidence file: ${file}`, err);
    allPassed = false;
  }
});

requiredGates.forEach(gate => {
  if (!checkedGates.has(gate)) {
    console.log(`[FAIL] Missing evidence for required gate: ${gate}`);
    allPassed = false;
  }
});

const finalStatus = allPassed ? "10/10 CERTIFIED" : "PENDING_RUNTIME_VERIFICATION";

const certPayload = {
  generated_at: new Date().toISOString(),
  status: finalStatus,
  total_evidence_files_checked: totalGates,
  total_tests_passed: totalTestsPassed,
  commit_sha: commitSha,
  pipeline: "Strict Blocking Evidence-Based CI/CD"
};

if (!fs.existsSync(path.dirname(outputCert))) {
  fs.mkdirSync(path.dirname(outputCert), { recursive: true });
}

fs.writeFileSync(outputCert, JSON.stringify(certPayload, null, 2));

if (!allPassed) {
  console.log(`\n[WARNING] Certification Status: ${finalStatus}`);
  console.log('Some required runtime gates failed or are missing. Certification denied.');
  process.exit(1);
} else {
  console.log(`\n[SUCCESS] Certification Status: ${finalStatus}`);
  console.log('All required runtime evidence is valid and verified.');
  process.exit(0);
}
