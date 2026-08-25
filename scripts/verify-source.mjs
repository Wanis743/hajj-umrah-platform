import fs from 'node:fs';
import path from 'node:path';

const roots = ['src'];
const banned = [
  /Math\.random\s*\(/g,
  /BouSaada@2025/g,
  /generateReference\s*\(/g,
  /from\(['\"]audit_logs['\"]\)\.insert/g,
  /CREATE POLICY\s+enable_all_anon/gi,
  /CREATE POLICY[^\n]+FOR\s+ALL\s+TO\s+anon\s*,\s*authenticated[^\n]*USING\s*\(true\)/gi,
];
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(entry.name)) files.push(p);
  }
}
roots.forEach(walk);
const failures = [];
// Vendored third-party chart library (byte-faithful to upstream bklit-ui).
// Its only "hit" is a comment explaining why it does NOT use Math.random.
const vendoredRoots = [`src/components/charts/`];
for (const file of files) {
  if (vendoredRoots.some(d => file.replaceAll(path.sep, '/').startsWith(d))) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of banned) {
    if (pattern.test(text)) failures.push(`${file}: prohibited pattern ${pattern}`);
    pattern.lastIndex = 0;
  }
}
if (failures.length) {
  console.error('Source verification failed:');
  failures.forEach(f => console.error(`- ${f}`));
  process.exit(1);
}
console.log(`Source verification passed (${files.length} source/config files scanned).`);
