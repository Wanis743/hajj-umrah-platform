/**
 * Fluent stylesheet audit.
 *
 * `src/platform/shell/fluent.css` is the single sheet for the whole desktop: the
 * shell renders most of it, the SDK's control kit the rest, and apps address the
 * palette only through `--fx-*` tokens. Three checks:
 *
 *   1. MISSING   — a class the TSX renders that no rule defines (broken visuals).
 *   2. ORPHAN    — a rule nothing renders (dead CSS).
 *   3. TOKENS    — every `var(--fx-*)` resolves, and every declared token is read.
 *
 * Run: `node scripts/css-audit.cjs` — exits non-zero when any check fails, so it
 * can be wired into `verify:static`.
 */
const fs = require('fs');
const path = require('path');

const SHEET = 'src/platform/shell/fluent.css';
/** Everything that may render an `fx-` class. */
const ROOTS = ['src/platform/shell', 'src/platform/sdk', 'src/apps'];

/** Every `.ts`/`.tsx` under a root, recursively; missing roots are skipped. */
function sources(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const used = new Map(); // class -> files that render it
for (const file of ROOTS.flatMap(sources)) {
  // `id`/`htmlFor` values share the `fx-` prefix but are never selectors; drop
  // them first so they are not reported as missing rules.
  const src = fs
    .readFileSync(file, 'utf8')
    .replace(/\b(?:id|htmlFor)=(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, '');
  for (const re of [/"(fx-[a-z0-9- ]+)"/g, /'(fx-[a-z0-9- ]+)'/g, /`(fx-[a-z0-9-]+)/g]) {
    for (const m of src.matchAll(re)) {
      for (const raw of m[1].split(' ')) {
        const cls = raw.trim();
        if (!cls.startsWith('fx-')) continue;
        if (!used.has(cls)) used.set(cls, new Set());
        used.get(cls).add(file);
      }
    }
  }
}

const css = fs.readFileSync(SHEET, 'utf8');
const defined = new Set();
for (const m of css.matchAll(/\.(fx-[a-z0-9-]+)/g)) defined.add(m[1]);

// `accentVariables()` writes the accent ramp as inline styles on `.fos`, so
// those names are declared by the shell rather than by the sheet.
const declared = new Set();
for (const m of fs.readFileSync('src/platform/shell/appearance.ts', 'utf8').matchAll(/'(--fx-[a-z0-9-]+)'/g)) {
  declared.add(m[1]);
}
for (const m of css.matchAll(/(--fx-[a-z0-9-]+)\s*:/g)) declared.add(m[1]);

const referenced = new Set();
for (const m of css.matchAll(/var\((--fx-[a-z0-9-]+)/g)) referenced.add(m[1]);
for (const file of ROOTS.flatMap(sources)) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/var\((--fx-[a-z0-9-]+)/g)) referenced.add(m[1]);
}

const report = (label, items, detail) => {
  console.log(`${label} (${items.length}):`);
  for (const item of items) console.log(`  ${item}${detail === undefined ? '' : detail(item)}`);
  if (items.length === 0) console.log('  (none)');
  return items.length;
};

let bad = 0;
bad += report('MISSING CLASSES', [...used.keys()].filter((c) => !defined.has(c)).sort(), (c) => `  <- ${[...used.get(c)].join(', ')}`);
console.log('');
bad += report('ORPHAN RULES', [...defined].filter((c) => !used.has(c)).sort());
console.log('');
bad += report('UNDEFINED TOKENS', [...referenced].filter((t) => !declared.has(t)).sort());
console.log('');
bad += report('UNREAD TOKENS', [...declared].filter((t) => !referenced.has(t)).sort());

if (bad > 0) {
  console.error(`\ncss-audit: ${bad} problem(s).`);
  process.exit(1);
}
console.log('\ncss-audit: clean.');
