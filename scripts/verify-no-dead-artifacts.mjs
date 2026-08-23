import fs from 'node:fs';
const forbidden = ['.agents','skills-lock.json','.kiro','db_schema.sql','supabase/schema.sql','supabase/CANONICAL_SCHEMA.sql'];
const bad=forbidden.filter(f=>fs.existsSync(f));
if(bad.length){console.error('Forbidden release artifacts:',bad.join(', '));process.exit(1);}
const docs=fs.readdirSync('docs').filter(f=>/REMEDIATION|PRODUCTION_READINESS/i.test(f));
if(docs.length>3) { console.error('Too many duplicated remediation docs:',docs); process.exit(1); }
console.log('RELEASE ARTIFACT CLEANLINESS: PASS');
