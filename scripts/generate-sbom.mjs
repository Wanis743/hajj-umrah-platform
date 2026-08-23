import fs from 'node:fs';
import crypto from 'node:crypto';
const lock = JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const components = Object.entries(lock.packages ?? {}).filter(([k]) => k && k !== '').map(([path,pkg]) => ({
  type:'library', name: pkg.name ?? path.split('/').pop(), version: pkg.version ?? 'unknown'
}));
const doc = { bomFormat:'CycloneDX', specVersion:'1.5', version:1,
  metadata:{ timestamp:new Date().toISOString(), tools:[{vendor:'Agency Release Pipeline',name:'generate-sbom.mjs',version:'1.0.0'}]},
  components
};
fs.writeFileSync('sbom.cyclonedx.json', JSON.stringify(doc,null,2));
console.log(`SBOM components: ${components.length}`);
console.log(`SHA256: ${crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex')}`);
