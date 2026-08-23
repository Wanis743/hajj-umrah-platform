import fs from 'node:fs';
import path from 'node:path';
const files = [
  'supabase/migrations/20260813200000_final_enterprise_hardening.sql',
  'docs/CURRENT_SCHEMA_SNAPSHOT.sql',
  'docs/CURRENT_SCHEMA_SNAPSHOT.sql',
];
const required = [
  'private.redact_audit_jsonb',
  'correlation_id',
  'ip_address',
  "current_setting('request.headers', true)",
  "'Authorization'",
];
for (const file of files) {
  const text = fs.readFileSync(path.resolve(file), 'utf8');
  if (file.includes('20260813200000')) {
    for (const needle of required.slice(0,3)) {
      if (!text.includes(needle)) throw new Error(`${file}: missing ${needle}`);
    }
    if (!text.includes("h->>'user-agent'")) throw new Error(`${file}: raw header storage regression`);
  }
  if (text.includes("current_setting('request.headers', true), now()")) {
    throw new Error(`${file}: raw request headers may be persisted`);
  }
}
console.log('Audit privacy verification passed.');
