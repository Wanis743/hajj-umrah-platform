import fs from 'node:fs';
import path from 'node:path';
const roots = ['src','public','index.html'];
const banned = /agency-alpha-snowy|770\s*000\s*000|vite\.svg|ONHO\s*#743/i;
const allow = /supabase\/migrations|PRODUCTION_READINESS\.md|README|REMEDIATION_STATUS\.md/;
function walk(item) {
  const st = fs.statSync(item);
  if (st.isDirectory()) for (const child of fs.readdirSync(item)) walk(path.join(item, child));
  else if (/\.(ts|tsx|js|mjs|html|json|css|md|sql|ya?ml)$/.test(item) && !allow.test(item.replaceAll('\\','/'))) {
    const text = fs.readFileSync(item,'utf8');
    if (banned.test(text)) throw new Error(`Legacy branding/placeholder detected in ${item}`);
  }
}
for (const root of roots) walk(path.resolve(root));
console.log('Branding/placeholders verification passed.');
