import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve('src');
const EXTENSIONS = new Set(['.ts', '.tsx']);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
}

walk(ROOT);

const errors = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  for (const diagnostic of sf.parseDiagnostics) {
    const start = diagnostic.start ?? 0;
    const pos = sf.getLineAndCharacterOfPosition(start);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    errors.push(`${path.relative(process.cwd(), file)}:${pos.line + 1}:${pos.character + 1}: ${message}`);
  }
}

if (errors.length) {
  console.error('Source syntax verification FAILED.');
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Source syntax verification passed (${files.length} TS/TSX files scanned).`);
