import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';

function run() {
  console.log('Generating local types...');
  try {
    execSync('npx supabase gen types typescript --local > tmp-types.ts', { stdio: 'inherit' });
  } catch (e) {
    console.error('Failed to generate types using supabase CLI', e);
    process.exit(1);
  }

  const generated = fs.readFileSync('tmp-types.ts', 'utf8');
  const existing = fs.readFileSync('src/types/database.ts', 'utf8');

  // Supabase types start with `export type Json` usually, but maybe some custom types are at the top of database.ts
  // Let's just compare the `export interface Database {` block.

  const extractDatabaseBlock = (content) => {
    const start = content.indexOf('export interface Database');
    if (start === -1) return null;
    return content.substring(start);
  };

  const genBlock = extractDatabaseBlock(generated);
  const existBlock = extractDatabaseBlock(existing);

  if (!genBlock) {
    console.error('Could not find Database interface in generated types.');
    process.exit(1);
  }
  if (!existBlock) {
    console.error('Could not find Database interface in src/types/database.ts.');
    process.exit(1);
  }

  // Very basic normalization for whitespace
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  if (norm(genBlock) !== norm(existBlock)) {
    console.error('ERROR: src/types/database.ts is out of sync with local schema!');
    console.error('Please run: npm run types:generate (or equivalent) to update it.');
    process.exit(1);
  }

  console.log('SUCCESS: src/types/database.ts matches local database schema.');
  fs.unlinkSync('tmp-types.ts');
  process.exit(0);
}

run();
