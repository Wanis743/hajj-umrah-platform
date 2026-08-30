import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'src');
// Layers where a direct console call or a raw Supabase mutation is a design
// break, not a style nit. Every entry must exist: a name that no longer maps to
// a directory silently checks nothing, which is how `intelligence` sat here.
const protectedDirs = ['services','engine','lib','types'];
// Vendored third-party UI (bklit-ui chart library, see `// NOTE(bklit-vendoring)`
// markers). Kept close to upstream so future syncs diff cleanly; the first-party
// component-*size* rules do not apply. Type safety is not exempt anywhere —
// `scripts/verify-any.mjs` scans this directory like any other.
const vendoredComponentRoots = ['src/components/charts/'];
const maxComponentBytes = 32000;
const failures = [];
const warnings = [];

for (const dir of protectedDirs) {
  if (!fs.existsSync(path.join(src, dir))) {
    failures.push(`protectedDirs lists src/${dir}/, which does not exist; the check it guards is dead.`);
  }
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules','.git','dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(src);
for (const file of files) {
  const rel = path.relative(root, file).replaceAll(path.sep,'/');
  if (vendoredComponentRoots.some(d => rel.startsWith(d))) continue;
  const text = fs.readFileSync(file,'utf8');
  const lines = text.split(/\r?\n/).length;
  if (rel.startsWith('src/components/') && file.endsWith('.tsx') && lines > 600) {
    failures.push(`${rel}: ${lines} lines; component exceeds the 600-line hard limit.`);
  }
  if (rel.startsWith('src/components/') && file.endsWith('.tsx') && Buffer.byteLength(text) > maxComponentBytes) {
    warnings.push(`${rel}: ${Buffer.byteLength(text)} bytes; split further when touching this module.`);
  }
  // `any` is not checked here. It used to be, as `/\bany\b/` over five
  // directories — a text search that flags `sides.any` and covers a fifth of the
  // tree. `scripts/verify-any.mjs` does it properly, by AST, everywhere.
  if (protectedDirs.some(d => rel.startsWith(`src/${d}/`)) && rel !== 'src/lib/logger.ts' && /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(text)) {
    failures.push(`${rel}: direct console logging in protected layer.`);
  }
  if (rel.startsWith('src/services/') && /\.from\(\s*table\s*\)/.test(text)) {
    failures.push(`${rel}: dynamic Supabase table access in service layer.`);
  }
  if (rel.startsWith('src/services/') && /supabase\.from\([^)]*\)\s*\.(update|delete|insert)\s*\(/.test(text) && !rel.endsWith('domainCommands.ts')) {
    failures.push(`${rel}: raw mutation found outside domainCommands/repository boundary.`);
  }
}
const cmd = fs.readFileSync(path.join(src,'services','domainCommands.ts'),'utf8');
if (/\bdirect\s*\(/.test(cmd)) failures.push('domainCommands.ts: direct() generic mutation helper still exists.');
if (!/transition_/.test(cmd)) failures.push('domainCommands.ts: no state transition command detected.');

const schemaFiles = ['db_schema.sql','supabase/schema.sql','supabase/CANONICAL_SCHEMA.sql'];
for (const rel of schemaFiles) if (fs.existsSync(path.join(root,rel))) failures.push(`${rel}: duplicate schema source remains.`);

if (failures.length) {
  console.error('MAINTAINABILITY FAIL');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`MAINTAINABILITY PASS (${files.length} TS/TSX files checked)`);
if (warnings.length) {
  console.warn('Maintainability warnings:');
  for (const w of warnings) console.warn(`- ${w}`);
}
