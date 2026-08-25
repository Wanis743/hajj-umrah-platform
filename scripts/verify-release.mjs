import { spawnSync } from 'node:child_process';

const steps = [
  ['source', 'npm run verify:source'],
  ['migrations', 'npm run verify:migrations'],
  ['branding', 'npm run verify:branding'],
  ['ui-safety', 'npm run verify:ui-safety'],
  ['no-demo', 'npm run verify:no-demo'],
  ['architecture', 'node scripts/verify-architecture.mjs'],
  ['toolchain-config', 'node scripts/verify-toolchain-config.mjs'],
  ['typecheck', 'npm run typecheck'],
  ['lint', 'npm run lint'],
  ['audit', 'npm run security:audit'],
  ['build', 'npm run build'],
  ['security', 'npm run verify:security'],
  ['accounting', 'npm run verify:accounting'],
  ['storage', 'npm run verify:storage'],
  ['e2e', 'npm run verify:e2e'],
  ['behavioral-rbac', 'npm run verify:behavioral-rbac'],
  ['reservation-concurrency', 'npm run verify:reservation-concurrency'],
];

const run = (name, command) => {
  console.log(`\n=== ${name} ===`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`Release verification FAILED at: ${name}`);
    process.exit(result.status ?? 1);
  }
};

for (const [name, command] of steps) run(name, command);
console.log('\nRelease verification PASSED: all mandatory gates completed.');
