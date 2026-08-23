import fs from 'node:fs';
import path from 'node:path';

function walk(dir, fn) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!['node_modules', '.git', 'dist'].includes(f)) {
        walk(p, fn);
      }
    } else {
      fn(p);
    }
  }
}

let violations = 0;

const FORBIDDEN = [
  /NUSUK_API_KEY/i,
  /NUSUK_TOKEN/i,
  /NUSUK_BASE_URL/i,
  /NUSUK_WEBHOOK_SECRET/i,
  /NUSUK_SECRET/i,
  /https?:\/\/[^\/]*nusuk/i,
  /fetch\(.*nusuk/i,
  /axios\..*nusuk/i,
  /synced.*nusuk/i,
  /API-connected.*nusuk/i,
  /live.*nusuk/i,
  /automatic.*nusuk/i,
];

walk('.', (file) => {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.js') && !file.endsWith('.json') && !file.endsWith('.yml')) return;
  if (file.includes('verify-nusuk-isolation')) return; // ignore this file
  
  const content = fs.readFileSync(file, 'utf8');
  for (const regex of FORBIDDEN) {
    if (regex.test(content)) {
      console.error(`Violation found in ${file}: matches ${regex}`);
      violations++;
    }
  }
});

if (violations > 0) {
  console.error(`\nFailed: ${violations} violations of Nusuk isolation rules found.`);
  process.exit(1);
} else {
  console.log('Passed: No forbidden Nusuk integration semantics found.');
}
