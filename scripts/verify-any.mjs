/**
 * The zero-`any` gate.
 *
 * `npm run lint` already fails on `@typescript-eslint/no-explicit-any`, but a
 * lint rule is only as strong as its config: a `files:`/`rules:` override can
 * switch it off for a directory, and that is exactly what happened to
 * `src/components/charts/**` for as long as those files aliased the d3 curve
 * factory to `any`. So this gate answers the question independently of eslint,
 * from the current working tree:
 *
 *   1. no `any` type appears in any TypeScript source we ship,
 *   2. nothing in the tree suppresses the rule that would have caught one,
 *   3. the toolchain still has the rule armed — `no-explicit-any: error` with no
 *      per-directory `off`, and `strict` (hence `noImplicitAny`) in tsconfig.
 *
 * (1) is an AST check, not a text search. `any` is a legal identifier: this repo
 * has `fadeSides.any` and `sides.any`, and a `/\bany\b/` grep flags both while
 * missing nothing it would have caught anyway. Only a type position produces a
 * node whose kind is `AnyKeyword`, so the parser draws the line for us.
 *
 * There is deliberately no vendored-code exemption. Third-party chart sources
 * get style latitude in eslint.config.js; they do not get type latitude.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();

/** Directory trees that ship TypeScript, checked in full. */
const sourceRoots = ['src', 'supabase/functions', 'agent'];
/** TypeScript that lives at the top level rather than under a root. */
const looseFiles = ['vite.config.ts'];
/** Build output and dependencies: not ours, and not shipped from here. */
const skipDirs = new Set(['node_modules', '.git', 'dist', 'release', 'coverage']);
const sourcePattern = /\.(ts|tsx|mts|cts)$/;

/**
 * Comments that would silence the rule. Neither is in the tree today; both are
 * listed so that adding one back is a gate failure rather than a quiet hole.
 * (`biome-ignore` is inert here — no biome config ships — which is precisely why
 * it must not become the way `any` returns.)
 */
const suppressions = [
  { pattern: /@typescript-eslint\/no-explicit-any/, label: 'eslint suppression for no-explicit-any' },
  { pattern: /biome-ignore[^\n]*noExplicitAny/, label: 'biome-ignore for noExplicitAny' },
];

const failures = [];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (sourcePattern.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [
  ...sourceRoots.flatMap((dir) => walk(path.join(root, dir))),
  ...looseFiles.map((file) => path.join(root, file)).filter((file) => fs.existsSync(file)),
];

/** Every `any` type node in one file, as `file:line:col` plus the offending line. */
function anyTypesIn(file, text) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      hits.push({ line: line + 1, column: character + 1, text: (text.split(/\r?\n/)[line] ?? '').trim() });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return hits;
}

for (const file of files) {
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  const text = fs.readFileSync(file, 'utf8');

  for (const hit of anyTypesIn(file, text)) {
    failures.push(`${rel}:${hit.line}:${hit.column}: \`any\` type — ${hit.text}`);
  }
  for (const { pattern, label } of suppressions) {
    if (!pattern.test(text)) continue;
    const line = text.split(/\r?\n/).findIndex((l) => pattern.test(l)) + 1;
    failures.push(`${rel}:${line}: ${label}; the rule may not be silenced per-file.`);
  }
}

/** The rule has to still be armed, or a clean scan proves nothing about tomorrow. */
const eslintConfig = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
const disabled = eslintConfig.match(/['"]@typescript-eslint\/no-explicit-any['"]\s*:\s*['"](off|warn)['"]/);
if (disabled !== null) {
  failures.push(`eslint.config.js: no-explicit-any is set to '${disabled[1]}'; it must be 'error' everywhere.`);
}
if (!/['"]@typescript-eslint\/no-explicit-any['"]\s*:\s*['"]error['"]/.test(eslintConfig)) {
  failures.push("eslint.config.js: no-explicit-any is not set to 'error' anywhere.");
}

const appTsconfig = fs.readFileSync(path.join(root, 'tsconfig.app.json'), 'utf8');
if (!/"strict"\s*:\s*true/.test(appTsconfig)) {
  failures.push('tsconfig.app.json: "strict" is not true, so implicit `any` is allowed.');
}
if (/"noImplicitAny"\s*:\s*false/.test(appTsconfig)) {
  failures.push('tsconfig.app.json: "noImplicitAny" is false.');
}

if (failures.length > 0) {
  console.error('ANY GATE FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`ANY GATE PASS (0 \`any\` types in ${files.length} TS/TSX files; rule armed at error)`);
