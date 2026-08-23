import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const migrationsDir = 'supabase/migrations';
const outDir = 'docs/generated';

const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

let tables = 0;
let functions = 0;
let indexes = 0;
let policies = 0;
let triggers = 0;

const migration_hashes = {};
const buffers = [];

for (const file of files) {
  const contentBuf = fs.readFileSync(path.join(migrationsDir, file));
  const content = contentBuf.toString('utf8');
  buffers.push(contentBuf);
  migration_hashes[file] = crypto.createHash('sha256').update(contentBuf).digest('hex');
  tables += (content.match(/create table/gi) || []).length;
  functions += (content.match(/create or replace function|create function/gi) || []).length;
  indexes += (content.match(/create index|create unique index/gi) || []).length;
  policies += (content.match(/create policy/gi) || []).length;
  triggers += (content.match(/create trigger/gi) || []).length;
}

const blob = Buffer.concat(buffers);
const schema_hash = crypto.createHash('sha256').update(blob).digest('hex');

const manifest = {
  migration_count: files.length,
  tables_count: tables,
  functions_count: functions,
  indexes_count: indexes,
  policies_count: policies,
  triggers_count: triggers,
  schema_hash,
  migration_hashes,
  generated_at: new Date().toISOString()
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'schema-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'schema-summary.md'), `# Generated Schema Summary

- Migration count: **${manifest.migration_count}**
- Tables: **${manifest.tables_count}**
- Functions: **${manifest.functions_count}**
- Indexes: **${manifest.indexes_count}**
- Policies: **${manifest.policies_count}**
- Triggers: **${manifest.triggers_count}**
- Schema hash: \`${manifest.schema_hash}\`

Generated automatically; do not edit manually.
`);
console.log(JSON.stringify(manifest, null, 2));
