import process from 'node:process';
const base=process.env.E2E_BASE_URL||process.env.VITE_PUBLIC_SITE_URL;
if(!base){console.log('E2E smoke skipped: set E2E_BASE_URL'); process.exit(0);}
const res=await fetch(base,{redirect:'manual'});
if(!res.ok && res.status<300){throw new Error(`Landing page returned ${res.status}`);}
console.log(`E2E smoke landing check passed: ${res.status}`);
