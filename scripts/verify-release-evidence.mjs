import fs from 'node:fs';
const requiredTerms = ['typecheck','lint','audit','build','fresh','security','storage','accounting','e2e'];
const text = fs.readFileSync('docs/FINAL_RELEASE_GATES.md','utf8').toLowerCase();
for (const gate of requiredTerms) if (!text.includes(gate)) throw new Error(`Missing release gate documentation: ${gate}`);
const workflow = fs.readFileSync('.github/workflows/release-certification.yml','utf8');
if (/RELEASE_SKIP_LOCAL_TOOLCHAINS|continue-on-error:\s*true/.test(workflow)) throw new Error('Release workflow contains a bypass.');
console.log('Release evidence configuration verification passed.');
