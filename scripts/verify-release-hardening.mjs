import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const fail=[];
const mig=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql'));
const ts=new Map();
for(const f of mig){const t=f.slice(0,14); if(!/^\d{14}$/.test(t)) fail.push(`invalid migration prefix: ${f}`); if(ts.has(t)) fail.push(`duplicate migration timestamp ${t}: ${ts.get(t)}, ${f}`); ts.set(t,f);}
const source=fs.readFileSync('src/hooks/useSupabaseData.ts','utf8');
if(/count:\s*['"]exact['"]/.test(source)) fail.push('useSupabaseData must not request exact count on every fetch');
if(/JSON\.stringify\([^)]*\)/.test(source)) fail.push('useSupabaseData must not use JSON.stringify in dependencies');
const critical=['src/services/domainCommands.ts','src/services/financeSummary.ts','src/engine/kpi/kpiEngine.ts','src/engine/events.ts','src/lib/logger.ts'];
for(const f of critical){const s=fs.readFileSync(f,'utf8'); if(/\bany\b/.test(s)) fail.push(`${f} contains any`);}
for(const f of fs.readdirSync('.github/workflows')) {
  const s=fs.readFileSync(path.join('.github/workflows',f),'utf8');
  if(/node-version:\s*20\b/.test(s)) fail.push(`${f} uses Node 20`);
  if(/supabase\/setup-cli@[^ \n]+[\s\S]*version:\s*latest/.test(s)) fail.push(`${f} uses latest Supabase CLI`);
}
for(const banned of ['.agents','skills-lock.json','.kiro']){
  if(fs.existsSync(banned)) fail.push(`release artifact contains ${banned}`);
}
if(!fs.existsSync('supabase/config.toml')) fail.push('missing supabase/config.toml');
if(!fs.existsSync('docs/RELEASE_HARDENING.md')) fail.push('missing release acceptance doc');
if(fail.length){ console.error(fail.join('\n')); process.exit(1); }
console.log('RELEASE HARDENING GATE: PASS');
