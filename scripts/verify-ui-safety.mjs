import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'public', 'index.html', 'vercel.json', 'package.json', '.env.example'];
const extensions = new Set(['.ts','.tsx','.js','.jsx','.html','.json','.css','.md','.xml']);
const forbidden = [
  /window\.confirm\s*\(/g,
  /REPLACE_WITH_REAL_DOMAIN/gi,
  /agency-alpha-snowy-47/gi,
  /vite\.svg/gi,
  /contact@bousalem/gi,
];
const secretKey = /VITE_[A-Z0-9_]*(SECRET|PASSWORD|TOKEN|PRIVATE|SERVICE_ROLE|API_KEY)/i;

const files = [];
function collect(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) collect(join(p, name));
  } else if (extensions.has(p.slice(p.lastIndexOf('.')).toLowerCase()) || p.endsWith('index.html') || p.endsWith('.env.example')) {
    files.push(p);
  }
}
for (const root of roots) collect(root);

const issues = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  forbidden.forEach((pattern) => {
    if (pattern.test(text)) issues.push(`${file}: forbidden runtime/prototype pattern ${pattern}`);
    pattern.lastIndex = 0;
  });
  for (const line of text.split(/\r?\n/)) {
    if (secretKey.test(line) && !/VITE_(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=|#/.test(line)) {
      issues.push(`${file}: possible secret-like VITE variable`);
    }
  }
}
if (issues.length) {
  console.error('UI/runtime safety verification FAILED');
  console.error(issues.join('\n'));
  process.exit(1);
}
console.log(`UI/runtime safety verification passed (${files.length} files scanned).`);
