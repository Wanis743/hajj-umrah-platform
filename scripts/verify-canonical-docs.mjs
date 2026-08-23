import fs from 'node:fs';

const files = [
  'docs/CURRENT_SCHEMA_SNAPSHOT.sql',
  'docs/CURRENT_SCHEMA_SNAPSHOT.sql',
  'PRODUCTION_READINESS.md',
];
for (const file of files) {
  if (!fs.existsSync(file)) throw new Error(`Missing required documentation/schema file: ${file}`);
}
const canonical = fs.readFileSync(files[0], 'utf8');
if (/seeds demo data/i.test(canonical)) {
  throw new Error('Canonical production schema must not claim to seed demo data.');
}
if (!/development seed.*supabase\/seed\.dev\.sql/i.test(canonical)) {
  throw new Error('Canonical schema must identify the separate development seed file.');
}
console.log('Canonical schema documentation verification passed.');
