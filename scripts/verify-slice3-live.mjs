/**
 * Slice-3 server verification — runs the REAL accounting workflow against the
 * LIVE database as the real admin user, via the real REST/RPC surface:
 *   1. sign in (staff test account) → JWT
 *   2. read accounts + recent entries through the reader RPC
 *   3. create a balanced draft via post_journal_entry
 *   4. verify DRAFT status + totals trigger
 *   5. approve via approve_journal_entry → expect POSTED (+ audit row)
 *   6. replay approval → idempotent success, no state change
 *   7. unbalanced entry → server rejects with P0001
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m !== null) env[m[1]] = m[2];
}
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL ?? '';
const PASSWORD = process.env.TEST_PASSWORD ?? '';


function totpCode(secretBase32) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(ch);
    if (i >= 0) bits += i.toString(2).padStart(5, '0');
  }
  const key = Buffer.alloc(bits.length >> 3);
  for (let i = 0; i + 8 <= bits.length; i += 8) key[i >> 3] = parseInt(bits.slice(i, i + 8), 2);
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}

let failures = 0;
const check = (cond, label) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

// ── 1. Sign in ──────────────────────────────────────────────────────────────
console.log('1. authenticate + MFA step-up');
const authRes = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const auth = await authRes.json();
check(authRes.ok === true && typeof auth.access_token === 'string', `sign in as ${EMAIL}`);

// Complete the enrolled TOTP factor to reach AAL2 (required by approve_journal_entry).
const { id: FACTOR_ID, secret } = JSON.parse(fs.readFileSync('.totp-factor.json', 'utf8'));
const H0 = { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' };
const challenge = await (await fetch(`${URL}/auth/v1/factors/${FACTOR_ID}/challenge`, { method: 'POST', headers: H0 })).json();
const verifyRes = await fetch(`${URL}/auth/v1/factors/${FACTOR_ID}/verify`, {
  method: 'POST', headers: H0, body: JSON.stringify({ challenge_id: challenge.id, code: totpCode(secret) }),
});
const verified = await verifyRes.json();
let jwt = verified.access_token ?? auth.access_token;
const aal = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).aal;
check(aal === 'aal2', `MFA step-up complete (aal=${aal})`);

// whoami through staff context
const me = await fetch(`${URL}/rest/v1/staff_profiles?select=role,agency_id,is_active&limit=1`, {
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
});
const meRows = await me.json();
check(Array.isArray(meRows) && meRows[0]?.role === 'ADMIN', 'staff profile resolves (ADMIN)');

// ── 2. Reader RPC ───────────────────────────────────────────────────────────
console.log('2. get_recent_journal_entries');
const rpcHeaders = { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
const before = await fetch(`${URL}/rest/v1/rpc/get_recent_journal_entries`, {
  method: 'POST', headers: rpcHeaders, body: JSON.stringify({ limit_rows: 5 }),
});
const beforeEntries = await before.json();
check(before.ok && Array.isArray(beforeEntries), `reader returns ${Array.isArray(beforeEntries) ? beforeEntries.length : '?'} entries`);

// ── 3/7. Draft creation (balanced) + rejection (unbalanced) ────────────────
console.log('3. post_journal_entry');
const accountsRes = await fetch(`${URL}/rest/v1/chart_of_accounts?select=id,code&order=code&limit=2`, {
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
});
const accounts = await accountsRes.json();
check(accounts.length >= 2, `chart of accounts readable (${accounts.length} fetched)`);

const today = new Date().toISOString().slice(0, 10);
const ref = `E2E-${Date.now().toString(36)}`;
const createRes = await fetch(`${URL}/rest/v1/rpc/post_journal_entry`, {
  method: 'POST', headers: rpcHeaders,
  body: JSON.stringify({
    p_reference: ref,
    p_description: 'Slice 3 E2E verification entry',
    p_entry_date: today,
    p_lines: [
      { account_id: accounts[0].id, debit: '125.50', credit: '0', currency_code: 'DZD', memo: 'e2e debit' },
      { account_id: accounts[1].id, debit: '0', credit: '125.50', currency_code: 'DZD', memo: 'e2e credit' },
    ],
  }),
});
const created = await createRes.json();
check(createRes.ok === true && created.success === true, `balanced draft accepted (${created.journal_id ?? created.journal_entry_id ?? '?'})`);
const journalId = created.journal_entry_id ?? created.journal_id;

console.log('4. totals + status');
const entryRes = await fetch(
  `${URL}/rest/v1/journal_entries?id=eq.${journalId}&select=reference,status,total_debit,total_credit`,
  { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } },
);
const entryRows = await entryRes.json();
const entry = entryRows[0];
check(entry?.status === 'DRAFT', 'entry stored as DRAFT');
check(Number(entry?.total_debit) === 125.5 && Number(entry?.total_credit) === 125.5,
  `totals trigger maintained (${entry?.total_debit}/${entry?.total_credit})`);

console.log('5. approve_journal_entry');
const apprRes = await fetch(`${URL}/rest/v1/rpc/approve_journal_entry`, {
  method: 'POST', headers: rpcHeaders,
  body: JSON.stringify({ p_journal_id: journalId, p_reason: 'Slice 3 live verification' }),
});
const approved = await apprRes.json().catch(async () => ({ raw: await apprRes.text() }));
check(apprRes.ok === true && approved.success === true && approved.status === 'POSTED',
  `approval returns POSTED ${apprRes.ok ? '' : JSON.stringify(approved).slice(0, 220)}`);

const postedRow = await (await fetch(
  `${URL}/rest/v1/journal_entries?id=eq.${journalId}&select=status,posted_at,fiscal_period_id`,
  { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } },
)).json();
check(postedRow[0]?.status === 'POSTED' && postedRow[0]?.posted_at !== null, 'row now POSTED with timestamp');
check(postedRow[0]?.fiscal_period_id !== null, 'fiscal period stamped');

console.log('6. idempotent replay');
const replay = await fetch(`${URL}/rest/v1/rpc/approve_journal_entry`, {
  method: 'POST', headers: rpcHeaders,
  body: JSON.stringify({ p_journal_id: journalId, p_reason: 'replay' }),
});
const replayBody = await replay.json();
check(replay.ok === true && replayBody.idempotent_replay === true, 'replay acknowledged without mutation');

console.log('7. unbalanced rejection');
const badRef = `E2E-BAD-${Date.now().toString(36)}`;
const badRes = await fetch(`${URL}/rest/v1/rpc/post_journal_entry`, {
  method: 'POST', headers: rpcHeaders,
  body: JSON.stringify({
    p_reference: badRef, p_description: 'should fail', p_entry_date: today,
    p_lines: [
      { account_id: accounts[0].id, debit: '100', credit: '0', currency_code: 'DZD', memo: '' },
      { account_id: accounts[1].id, debit: '0', credit: '90', currency_code: 'DZD', memo: '' },
    ],
  }),
});
const badBody = await badRes.json();
check(badRes.ok === false && String(badBody.message ?? '').includes('equal'), 'server rejected unbalanced entry');

// audit trail written?
const audit = await (await fetch(
  `${URL}/rest/v1/audit_logs?resource_id=eq.${journalId}&action=eq.POST&select=id`,
  { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } },
)).json();
check(Array.isArray(audit) && audit.length >= 1, `POST audit event recorded (${audit.length})`);

console.log(failures === 0 ? '\nALL SERVER CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
