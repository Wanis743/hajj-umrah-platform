#!/usr/bin/env node
/**
 * Repository-wide ZERO-ANY gate (Master Rebuild Spec §37).
 *
 * Scans all TypeScript/JavaScript source under the repository policy for
 * explicit `any` and unsafe aliases, including:
 *   `any`, `as any`, `<any>`, `any[]`, `Array<any>`, `Record<..., any>`,
 *   `Promise<any>`, callback params typed as any.
 *
 * Also enforces §4 (no TS suppression debt): @ts-ignore / @ts-nocheck /
 * @ts-expect-error are rejected.
 *
 * Exit 0 with ANY COUNT = 0; exit 1 otherwise. Emits a machine-readable
 * artifact for certification (§47: 'Any Count' expected exactly 0).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  'dist',
  'dist-ssr',
  'coverage',
  'release',
];

// Extra ignore candidates specific to this repo's rebuild state.
// G2 prototype layer is quarantined from edits but still counted until removed;
// legacy fix scripts are counted too — the gate must not hide them (§3).
const IGNORES = [...DEFAULT_IGNORES];

const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

const PATTERNS = [
  { re: /:\s*any\b/, label: 'annotated any' },
  { re: /\bas\s+any\b/, label: 'as any' },
  { re: /<any>/, label: 'generic any' },
  { re: /\bany\s*\[\s*\]/, label: 'any array' },
  { re: /\bArray\s*<\s*any\s*>/, label: 'Array<any>' },
  { re: /\bRecord\s*<\s*[^,<>\s][^<>]*,\s*any\s*>/, label: 'Record<...,any>' },
  { re: /\bPromise\s*<\s*any\s*>/, label: 'Promise<any>' },
  { re: /@\s*(ts-ignore|ts-nocheck|ts-expect-error)\b/, label: 'TS suppression directive' },
];

/** Lines that merely mention "any" in comments/strings about this policy are allowed. */
function isPolicyMention(line) {
  return /zero[- ]any|no-any|ANY COUNT|no explicit .any.|forbidden forever/i.test(line);
}

/** This gate script necessarily contains pattern literals; it cannot scan itself. */
function isSelfScan(file) {
  return file.replaceAll('\\', '/').endsWith('scripts/gate-no-any.mjs');
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORES.includes(entry.name)) continue;
      walk(full, files);
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
}

const findings = [];
const files = [];
walk(ROOT, files);

for (const file of files) {
  if (isSelfScan(file)) continue;
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (isPolicyMention(line)) return;
    for (const { re, label } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ file: rel, line: idx + 1, label, excerpt: line.trim().slice(0, 160) });
      }
    }
  });
}

const suppressed = findings.filter((f) => f.label === 'TS suppression directive');
const anyFindings = findings.filter((f) => f.label !== 'TS suppression directive');

const artifact = {
  generatedAt: new Date().toISOString(),
  commit: process.env.GIT_COMMIT ?? null,
  filesScanned: files.length,
  anyCount: anyFindings.length,
  suppressionCount: suppressed.length,
  expectedAnyCount: 0,
  pass: anyFindings.length === 0 && suppressed.length === 0,
};

if (process.argv.includes('--artifact')) {
  const out = path.join(ROOT, 'docs', 'rebuild');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, 'any-count.json'),
    JSON.stringify({ ...artifact, findings }, null, 2),
    'utf8',
  );
}

if (findings.length > 0) {
  process.stdout.write(`ZERO-ANY GATE: FAIL (${artifact.anyCount} any, ${artifact.suppressionCount} suppression)\n`);
  const shown = findings.slice(0, 40);
  for (const f of shown) {
    process.stdout.write(`  ${f.file}:${f.line} [${f.label}] ${f.excerpt}\n`);
  }
  if (findings.length > shown.length) {
    process.stdout.write(`  … and ${findings.length - shown.length} more\n`);
  }
  process.exit(1);
}

process.stdout.write(`ZERO-ANY GATE: PASS — ANY COUNT = 0 across ${files.length} files\n`);
