import fs from 'node:fs';
import path from 'node:path';

const required = [
  'src/integrations/index.ts',
  'docs/EXTERNAL_INTEGRATIONS.md',
  'docs/FRESH_DB.md',
  '.github/workflows/fresh-db.yml',
  'scripts/fresh-db-replay.sh',
  'supabase/functions/notification-worker/index.ts',
  'supabase/functions/notification-worker/deno.json',
];
const missing = required.filter((p) => !fs.existsSync(path.resolve(p)));
if (missing.length) {
  console.error('Integration verification failed:', missing.join(', '));
  process.exit(1);
}
const workflow = fs.readFileSync('.github/workflows/fresh-db.yml','utf8');
for (const token of ['supabase/setup-cli@46f7f98','npm ci','./scripts/fresh-db-replay.sh']) {
  if (!workflow.includes(token)) throw new Error(`Missing CI token: ${token}`);
}
const replay = fs.readFileSync('scripts/fresh-db-replay.sh','utf8');
for (const token of ['supabase db reset --yes','npm run verify:migrations','node scripts/verify-architecture.mjs','node scripts/verify-toolchain-config.mjs']) {
  if (!replay.includes(token)) throw new Error(`Missing replay token: ${token}`);
}
console.log(`Integration/fresh-db verification passed (${required.length} artifacts checked).`);

const integrationSource = fs.readFileSync('src/integrations/index.ts','utf8');
if (/VITE_.*(?:API_KEY|SECRET|TOKEN|DSN)/i.test(integrationSource)) throw new Error('Client bundle exposes a credential-like VITE_ secret');
const worker = fs.readFileSync('supabase/functions/notification-worker/index.ts','utf8');
for (const token of ['WORKER_SECRET','claim_notification_queue','complete_notification_queue','fail_notification_queue']) { if (!worker.includes(token)) throw new Error(`Missing worker token: ${token}`); }
