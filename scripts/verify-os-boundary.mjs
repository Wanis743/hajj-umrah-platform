/**
 * OS boundary gate.
 *
 * FinanceOS is a real operating system in miniature: applications may only see a
 * syscall ABI, and the kernel may only see data. Three walls hold that up, and
 * TypeScript cannot express any of them, so they are checked here.
 *
 *   1. `src/apps/**` imports `@/platform/sdk` and `@/platform/kernel/abi` only.
 *      Never kernel internals, never the shell, never Supabase, and never the
 *      host application — an app that can reach `useAuth()` is not sandboxed.
 *   2. `src/platform/kernel/**` imports no React and no shell module. The kernel
 *      runs whether or not anything is rendering it.
 *   3. Neither apps nor the kernel touch ambient browser state directly
 *      (`localStorage`, `sessionStorage`, `document`, `window.open`): storage is
 *      the VFS and the registry, and geometry is the window manager.
 *
 * Run: `node scripts/verify-os-boundary.mjs`
 */
import fs from 'node:fs';
import path from 'node:path';

/** Every `.ts`/`.tsx` under `root`, posix-normalised. Missing roots are fine. */
function sources(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full.replaceAll(path.sep, '/'));
  }
  return out;
}

/** Module specifiers of every static import, re-export and dynamic `import()`. */
function imports(text) {
  const found = new Set();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) found.add(m[1]);
  return [...found];
}

/** Resolve a relative specifier against the importing file, for cross-checks. */
const resolveFrom = (file, spec) =>
  spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : spec;

const failures = [];
const fail = (file, line, message) => failures.push(`${file}${line === 0 ? '' : `:${line}`}: ${message}`);

/** 1-based line of the first occurrence of `needle`, or 0. */
const lineOf = (text, needle) => {
  const at = text.indexOf(needle);
  return at === -1 ? 0 : text.slice(0, at).split('\n').length;
};

/* ------------------------------------------------------------------ *
 * Wall 1 — applications
 * ------------------------------------------------------------------ */

/** The only platform modules an app may name. */
const APP_ALLOWED = ['@/platform/sdk', '@/platform/kernel/abi'];
const appAllowed = (spec) => APP_ALLOWED.some((base) => spec === base || spec.startsWith(`${base}/`));

const appFiles = sources('src/apps');
for (const file of appFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const spec of imports(text)) {
    const target = resolveFrom(file, spec);
    // An app's own files, and third-party packages, are its own business.
    if (target.startsWith('src/apps/')) continue;
    if (spec.startsWith('.') && !target.startsWith('src/')) {
      fail(file, lineOf(text, spec), `import escapes src/apps: '${spec}'`);
      continue;
    }
    if (!spec.startsWith('@/') && !spec.startsWith('src/') && !spec.startsWith('.')) continue;
    if (appAllowed(spec)) continue;
    fail(
      file,
      lineOf(text, spec),
      `apps may import ${APP_ALLOWED.join(' or ')} only — found '${spec}'`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Wall 2 — the kernel
 * ------------------------------------------------------------------ */

const kernelFiles = sources('src/platform/kernel');
for (const file of kernelFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const spec of imports(text)) {
    const target = resolveFrom(file, spec);
    if (spec === 'react' || spec.startsWith('react/') || spec === 'react-dom') {
      fail(file, lineOf(text, spec), `the kernel must not depend on React — found '${spec}'`);
    }
    if (target.startsWith('src/platform/shell') || spec.startsWith('@/platform/shell')) {
      fail(file, lineOf(text, spec), `the kernel must not import the shell — found '${spec}'`);
    }
    if (target.startsWith('src/components') || spec.startsWith('@/components')) {
      fail(file, lineOf(text, spec), `the kernel must not import host UI — found '${spec}'`);
    }
  }
  if (/\.tsx$/.test(file)) fail(file, 0, 'kernel modules are plain TypeScript; JSX belongs to the shell');
}

/* ------------------------------------------------------------------ *
 * Wall 3 — ambient browser state
 * ------------------------------------------------------------------ */

/**
 * Each rule names the escape hatch and the syscall that replaces it, so a
 * failure tells the author what to do instead of only what not to do.
 */
const AMBIENT = [
  { re: /\blocalStorage\b/, use: 'the registry (`registry.*`) or the VFS (`fs.*`)' },
  { re: /\bsessionStorage\b/, use: 'the registry (`registry.*`)' },
  { re: /\bindexedDB\b/, use: 'the VFS (`fs.*`)' },
  { re: /\bdocument\.(?:cookie|write)\b/, use: 'the registry (`registry.*`)' },
  { re: /\bwindow\.(?:open|location)\b/, use: '`shell.launch` or `shell.openUrl`' },
  { re: /\bfetch\s*\(/, use: 'a kernel-brokered dataset (`data.query`)' },
  { re: /\bMath\.random\b/, use: '`crypto.getRandomValues` behind a kernel service' },
];

/** Persistence and networking live in the kernel's own drivers, by design. */
const KERNEL_STORAGE_OWNERS = ['src/platform/kernel/core/persist.ts', 'src/platform/kernel/core/broker.ts'];

/**
 * Blank out comments and string literals. Every one of these rules bans an
 * *identifier*, and the modules that document a ban naturally name the thing
 * they ban — scanning raw text would fail the very files that get it right.
 */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => ' '.repeat(m.length));

for (const file of [...appFiles, ...kernelFiles]) {
  if (KERNEL_STORAGE_OWNERS.includes(file)) continue;
  const text = code(fs.readFileSync(file, 'utf8'));
  for (const { re, use } of AMBIENT) {
    const m = re.exec(text);
    if (m === null) continue;
    fail(file, text.slice(0, m.index).split('\n').length, `'${m[0]}' is not reachable from here — use ${use}`);
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

if (failures.length > 0) {
  console.error('OS boundary verification failed:');
  for (const line of failures) console.error(`- ${line}`);
  process.exit(1);
}
console.log(
  `OS boundary verification passed (${appFiles.length} app file(s), ${kernelFiles.length} kernel file(s)).`,
);
