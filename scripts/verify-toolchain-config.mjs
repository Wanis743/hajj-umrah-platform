import fs from 'node:fs';
const raw = fs.readFileSync('tsconfig.app.json','utf8');
if (!/\"target\"\s*:\s*\"ES202[12]\"/.test(raw)) throw new Error('tsconfig.app.json target must be ES2021 or ES2022');
if (!/\"lib\"\s*:\s*\[[^\]]*\"ES202[12]\"/.test(raw)) throw new Error('tsconfig.app.json lib must include ES2021 or ES2022');
if (process.env.RELEASE_SKIP_LOCAL_TOOLCHAINS === '1') throw new Error('RELEASE_SKIP_LOCAL_TOOLCHAINS is forbidden for release verification');
console.log('Toolchain configuration verification passed.');
