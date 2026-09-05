import fs from 'node:fs';
const forbidden = ['.agents','skills-lock.json','.kiro','db_schema.sql','supabase/schema.sql','supabase/CANONICAL_SCHEMA.sql'];
const bad=forbidden.filter(f=>fs.existsSync(f));
if(bad.length){console.error('Forbidden release artifacts:',bad.join(', '));process.exit(1);}
// A committed compiler capture outlives the run that produced it and then
// contradicts the live gate. `typecheck_output.txt` sat at the root for 73
// commits recording 18 TS errors that had been fixed within the first few of
// them, and it was read -- reasonably -- as proof the typecheck gate was red.
// Captures are evidence of one run at one commit; they belong in a scratch dir
// or an evidence manifest that carries its own commit, never loose in the tree.
const captures=fs.readdirSync('.').filter(f=>/\.log$/i.test(f)||/[_-]output\.txt$/i.test(f)||/^(typecheck|tsc|lint|eslint|build)[_-].*\.txt$/i.test(f));
if(captures.length){console.error('Committed tool-output capture (regenerate on demand, do not commit):',captures.join(', '));process.exit(1);}
const docsDir = 'docs';
const docs = fs.existsSync(docsDir) ? fs.readdirSync(docsDir).filter(f=>/REMEDIATION|PRODUCTION_READINESS/i.test(f)) : [];
if(docs.length>3) { console.error('Too many duplicated remediation docs:',docs); process.exit(1); }
console.log('RELEASE ARTIFACT CLEANLINESS: PASS');
