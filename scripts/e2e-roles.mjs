import { spawnSync } from 'node:child_process';
const roles = ['ADMIN','OPERATIONS_MANAGER','FINANCE','VISA_AGENT','GUIDE','CRM','AGENT'];
const base = process.env.E2E_BASE_URL;
if (!base) throw new Error('E2E_BASE_URL is required');
if ((process.env.E2E_ENV ?? '') !== 'staging') throw new Error('E2E role matrix is staging-only. Set E2E_ENV=staging.');
for (const role of roles) {
  const email = process.env[`E2E_${role}_EMAIL`];
  const password = process.env[`E2E_${role}_PASSWORD`];
  if (!email || !password) throw new Error(`Missing real E2E fixture credentials for ${role}`);
  const result = spawnSync(process.execPath, ['scripts/e2e-full.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, E2E_TEST_EMAIL: email, E2E_TEST_PASSWORD: password, E2E_ROLE: role, E2E_RUN_MUTATIONS: '0' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(JSON.stringify({ pass: true, roles: roles.length, fixtureMode: true }));
