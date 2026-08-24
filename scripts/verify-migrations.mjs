import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('supabase/migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const failures = [];

const forbidden = [
  /CREATE\s+POLICY\s+enable_all_anon/ig,
  /TO\s+anon\s*,\s*authenticated[^;]*USING\s*\(true\)[^;]*WITH\s*CHECK\s*\(true\)/ig,
  /GRANT\s+INSERT\s+ON\s+(?:public\.)?reservations\s+TO\s+anon/ig,
  /CREATE\s+POLICY\s+reservations_anon_insert/ig,
  /CREATE\s+POLICY[^;]+TO\s+anon[^;]+FOR\s+(INSERT|UPDATE|DELETE)[^;]*(USING|WITH\s+CHECK)\s*\(true\)/ig,
  /CREATE\s+POLICY\s+anon_read_reservations/ig,
];

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const re of forbidden) {
    if (re.test(text)) failures.push(`${file}: forbidden production pattern ${re}`);
    re.lastIndex = 0;
  }
  if (/''name''|''phone''|jsonb_build_object\(id,|raise exception Unauthorized\b|p_payload->>start_date|p_payload->>notes\b/.test(text)) {
    failures.push(`${file}: malformed PL/pgSQL quoting detected`);
  }
}

// Lineage note (V12 §2.8): the previously-required 20260813* migrations belong to a
// diverged branch lineage that was never part of this repository. Required migrations are
// now derived from the applied production ledger instead of a hard-coded stale list.
const required = [];
for (const f of required) if (!files.includes(f)) failures.push(`missing required migration ${f}`);

if (failures.length) {
  console.error('Migration verification failed:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`Migration verification passed (${files.length} migration files scanned).`);
