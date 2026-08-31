import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('supabase/migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const failures = [];

const forbidden = [
  /CREATE\s+POLICY\s+enable_all_anon/ig,
  /TO\s+anon\s*,\s*authenticated[^;]*USING\s*\(true\)[^;]*WITH\s*CHECK\s*\(true\)/ig,
  /GRANT\s+INSERT\s+ON\s+(?:public\.)?reservations\s+TO\s+anon/ig,
  /CREATE\s+POLICY\s+reservations_anon_insert/ig,
  /CREATE\s+POLICY[^;]+TO\s+anon[^;]+FOR\s+(INSERT|UPDATE|DELETE)[^;]*(USING|WITH\s+CHECK)\s*\(true\)/ig,
  /CREATE\s+POLICY\s+anon_read_reservations/ig,
];

for (const file of files) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const re of forbidden) {
    if (re.test(text)) failures.push(`${file}: forbidden production pattern ${re}`);
    re.lastIndex = 0;
  }
  if (/''name''|''phone''|jsonb_build_object\(id,|raise exception Unauthorized\b|p_payload->>start_date|p_payload->>notes\b/.test(text)) {
    failures.push(`${file}: malformed PL/pgSQL quoting detected`);
  }
}

// Lineage note (V12 §2.8): the previously-required 20260813* migrations belong to a
// diverged branch lineage that was never part of this repository. Required migrations are
// now derived from the applied production ledger instead of a hard-coded stale list.
const required = [];
for (const f of required) if (!files.includes(f)) failures.push(`missing required migration ${f}`);

/**
 * Replay order: a function invoked by DDL must already exist when that DDL runs.
 *
 * `revoke all on function public.f()` naming a function no migration ever created
 * raises 42883 and stops `supabase db reset` dead. So does a policy expression, a
 * column DEFAULT, an index expression, a check constraint or a DO block that calls
 * one. A live database can carry such a function -- typed into a SQL editor once
 * and never written down -- and hide the break indefinitely, which is exactly what
 * happened here: public.current_staff_agency_id() had 142 call sites, 103 of them
 * in DDL, and no definition anywhere in this directory. The only gate that would
 * have caught it, scripts/fresh-db-replay.sh, needs Docker.
 *
 * Function *bodies* are exempt, and that exemption is why this check is possible
 * at all: PL/pgSQL resolves calls when it runs, so a body may legitimately name a
 * function a later migration creates. Everything outside a deferred body resolves
 * at DDL time, so after the bodies are blanked, every remaining reference has to
 * be satisfied by a migration at or before the one making it.
 *
 * The one other exemption is the repo's own guard idiom: a DO block that asks
 * `to_regclass('public.x') is not null` (or the pg_proc equivalent) before
 * touching x is explicitly saying the ledger cannot guarantee x, and replays
 * cleanly either way. Those references are honest and are skipped.
 */
function scan(text) {
  const spans = [];
  const tagRe = /\$[A-Za-z_]*\$/g;
  let open = null;
  for (let m; (m = tagRe.exec(text)); ) {
    if (open === null) open = { tagStart: m.index, bodyStart: tagRe.lastIndex, tag: m[0] };
    else if (m[0] === open.tag) {
      // The header is everything since the previous statement terminator: a body's
      // slice reads `create function …`, a `do $$` slice reads just `do`.
      const header = text.slice(text.lastIndexOf(';', open.tagStart) + 1, open.tagStart);
      spans.push({ start: open.bodyStart, end: m.index, body: /create\s+(or\s+replace\s+)?function/i.test(header) });
      open = null;
    }
  }
  let scanText = text;
  for (const span of spans.filter((s) => s.body).reverse()) {
    scanText = scanText.slice(0, span.start)
      + scanText.slice(span.start, span.end).replace(/[^\n]/g, ' ')
      + scanText.slice(span.end);
  }
  const guards = spans.filter((s) => !s.body).map((span) => {
    const body = scanText.slice(span.start, span.end);
    const names = new Set();
    for (const m of body.matchAll(/to_reg(?:class|procedure)\s*\(\s*'public\.([a-z_][a-z0-9_]*)/gi)) names.add(m[1]);
    for (const m of body.matchAll(/proname\s*=\s*'([a-z_][a-z0-9_]*)'/gi)) names.add(m[1]);
    for (const list of body.matchAll(/proname\s+in\s*\(([^)]*)\)/gi)) {
      for (const m of list[1].matchAll(/'([a-z_][a-z0-9_]*)'/gi)) names.add(m[1]);
    }
    return { start: span.start, end: span.end, names };
  });
  return { scanText, guards };
}

const guarded = (guards, at, name) =>
  guards.some((g) => at >= g.start && at < g.end && g.names.has(name));
const lineAt = (text, at) => text.slice(0, at).split('\n').length;
const commented = (text, at) => /(^|\n)[^\n]*--[^\n]*$/.test(text.slice(Math.max(0, at - 400), at));

const createdAt = new Map();   // function name -> { order, file } of its first definition
const defRe = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
files.forEach((file, index) => {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (let m; (m = defRe.exec(text)); ) {
    const line = text.slice(0, m.index).split('\n').length;
    if (!createdAt.has(m[1])) createdAt.set(m[1], { order: index * 1e6 + line, file });
  }
});

// `public.x(` after one of these is a relation, not a call: `create table if not
// exists public.t (`, `from public.t (`, `references public.t (`, `create index …
// on public.t (`. `on function` is the one `on` that does introduce a function, so
// it is matched first.
const relationContext = /\b(from|join|into|table|references|only|truncate|update|inherits|exists|view|sequence)\s+$/i;
const callRe = /\bpublic\.([a-z_][a-z0-9_]*)\s*\(/gi;
files.forEach((file, index) => {
  const { scanText, guards } = scan(fs.readFileSync(path.join(dir, file), 'utf8'));
  for (const m of scanText.matchAll(callRe)) {
    const lineStart = scanText.lastIndexOf('\n', m.index) + 1;
    const before = scanText.slice(lineStart, m.index);
    if (!/\bon\s+function\s+$/i.test(before) && (relationContext.test(before) || /\bon\s+$/i.test(before))) continue;
    if (commented(scanText, m.index) || guarded(guards, m.index, m[1])) continue;
    const line = lineAt(scanText, m.index);
    const definition = createdAt.get(m[1]);
    if (definition === undefined) {
      failures.push(`${file}:${line}: public.${m[1]}() is invoked by DDL but no migration ever creates it`);
    } else if (definition.order > index * 1e6 + line) {
      failures.push(`${file}:${line}: public.${m[1]}() is invoked by DDL before ${definition.file} creates it`);
    }
  }
});

/**
 * The same rule for relations, which fail the same way. `alter table
 * public.payment_reversals add constraint …` against a table no migration creates
 * raises 42P01 and stops the replay; so does a foreign key referencing it, an
 * index on it, or a policy attached to it.
 *
 * Only the DDL forms that name a relation unambiguously are checked -- alter,
 * references, index, policy, trigger, and table-level grant/revoke. Plain DML is
 * left alone deliberately: `insert into t select … from x join y` needs a real
 * parser to tell relations from CTEs and aliases, and the defects this exists to
 * catch have always been in DDL.
 */
const relationCreatedAt = new Map();
const relDefRe = /create\s+(?:unlogged\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
files.forEach((file, index) => {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (let m; (m = relDefRe.exec(text)); ) {
    const line = text.slice(0, m.index).split('\n').length;
    if (!relationCreatedAt.has(m[1])) relationCreatedAt.set(m[1], { order: index * 1e6 + line, file });
  }
});

const relUseRe = new RegExp(
  [
    'alter\\s+table\\s+(?:only\\s+)?public\\.("?[a-z_][a-z0-9_]*"?)',
    'references\\s+public\\.("?[a-z_][a-z0-9_]*"?)',
    'create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?[a-z0-9_]+\\s+on\\s+public\\.("?[a-z_][a-z0-9_]*"?)',
    'create\\s+policy\\s+[^\\s]+\\s+on\\s+public\\.("?[a-z_][a-z0-9_]*"?)',
    'create\\s+trigger\\s+[a-z0-9_]+[\\s\\S]{0,120}?\\son\\s+public\\.("?[a-z_][a-z0-9_]*"?)',
  ].join('|'),
  'gi',
);
files.forEach((file, index) => {
  const { scanText, guards } = scan(fs.readFileSync(path.join(dir, file), 'utf8'));
  for (const m of scanText.matchAll(relUseRe)) {
    const name = (m.slice(1).find(Boolean) ?? '').replaceAll('"', '');
    if (/\bif\s+exists\b/i.test(m[0]) || commented(scanText, m.index) || guarded(guards, m.index, name)) continue;
    const line = lineAt(scanText, m.index);
    const definition = relationCreatedAt.get(name);
    if (definition === undefined) {
      failures.push(`${file}:${line}: public.${name} is altered or referenced but no migration ever creates it`);
    } else if (definition.order > index * 1e6 + line) {
      failures.push(`${file}:${line}: public.${name} is altered or referenced before ${definition.file} creates it`);
    }
  }
});

if (failures.length) {
  console.error('Migration verification failed:');
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`Migration verification passed (${files.length} migration files scanned).`);
