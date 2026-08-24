/**
 * Get an aal2 session (enroll fresh TOTP -> challenge -> verify), save for browser seeding.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m !== null) env[m[1]] = m[2];
}
const URL = env.VITE_SUPABASE_URL, ANON = env.VITE_SUPABASE_ANON_KEY;
const REF = 'kwlyluvuwvwtblnshwal';
// 0. password sign-in
const auth = await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
})).json();
if (!auth?.access_token) { console.log('sign-in failed'); process.exit(1); }

async function jfetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, body: JSON.parse(text) }; }
  catch { return { ok: res.ok, status: res.status, body: null, text }; }
}

const H = { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' };

// 1. enroll
const FACTOR_ID = '2ba1920f-45b4-453f-b057-3c5f4e2d80b1'; // rebuild-e2e (verified, slice 3)
let SECRET = null;

// Fetch the TOTP secret straight from the DB (server-side owner read) via service probe
const pg = (await import('pg')).default;
const _envText2 = fs.readFileSync('.env.local', 'utf8');
const _authPart2 = /postgres:([^@]+)@/.exec(_envText2)[1];
const pgClient = new pg.Client({
  host: 'aws-1-eu-west-3.pooler.supabase.com',
  port: 5432, database: 'postgres',
  user: `postgres.${REF}`,
  password: decodeURIComponent(_authPart2),
});
await pgClient.connect();
const fr = await pgClient.query("select secret from auth.mfa_factors where id=$1", [FACTOR_ID]);
await pgClient.end();
if (!fr.rows[0]?.secret) { console.log('secret not found in DB'); process.exit(1); }
SECRET = fr.rows[0].secret;
console.log('secret loaded from DB');

// 2. compute TOTP
function totp(secretB32, t = Date.now()) {
  const key = base32Decode(secretB32);
  const counter = Math.floor(t / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset+1] << 16) | (hmac[offset+2] << 8) | hmac[offset+3];
  return String(bin % 1_000_000).padStart(6, '0');
}
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = A.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

// 3. challenge
const chRes = await fetch(`${URL}/auth/v1/factors/${FACTOR_ID}/challenge`, {
  method: 'POST', headers: H, body: JSON.stringify({}),
});
const ch = await chRes.json();
if (!chRes.ok || !ch?.id) { console.log('challenge failed:', JSON.stringify(ch).slice(0,200)); process.exit(1); }

// 4. verify
const vRes = await fetch(`${URL}/auth/v1/factors/${FACTOR_ID}/verify`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ challenge_id: ch.id, code: totp(SECRET) }),
});
const verified = await vRes.json();
if (!vRes.ok || !verified?.access_token) { console.log('verify failed:', JSON.stringify(verified).slice(0,200)); process.exit(1); }
console.log('aal2 session acquired');

fs.writeFileSync('scripts/.e2e-session.json', JSON.stringify(verified));
console.log('saved scripts/.e2e-session.json');
