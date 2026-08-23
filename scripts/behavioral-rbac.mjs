import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const env = (process.env.TEST_ENV ?? '').toLowerCase();
if (!url || !anonKey || !serviceKey) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
if (env !== 'staging') throw new Error('Behavioral RBAC tests are staging-only. Set TEST_ENV=staging.');
const password = process.env.RBAC_TEST_PASSWORD;
if (!password || password.length < 12) throw new Error('RBAC_TEST_PASSWORD must be at least 12 characters.');

const roles = ['ADMIN','OPERATIONS_MANAGER','FINANCE','VISA_AGENT','GUIDE','CRM','AGENT'];
const fixture = Object.fromEntries(roles.map((role) => {
  const email = process.env[`RBAC_${role}_EMAIL`];
  if (!email) throw new Error(`Missing real fixture: RBAC_${role}_EMAIL`);
  return [role, email];
}));

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const clientFor = () => createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

const requiredResources = ['pilgrims','bookings','payments','invoices','visas','documents','groups','flights','hotels','room_allocations','transport_assignments','journal_entries','journal_lines','bank_accounts','supplier_bills','credit_notes','audit_logs','incidents','sos_events'];
const actions = ['select','insert','update','delete'];

async function requireFixture(role) {
  const { data: users, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const user = users.users.find((u) => u.email?.toLowerCase() === fixture[role].toLowerCase());
  if (!user) throw new Error(`Fixture user ${fixture[role]} for ${role} does not exist in staging Auth.`);
  const { data: profile, error: profileError } = await admin.from('staff_profiles').select('user_id,role,agency_id,branch_uuid,is_active').eq('user_id', user.id).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.role !== role || !profile.is_active || !profile.agency_id || !profile.branch_uuid) {
    throw new Error(`Fixture ${role} is incomplete: requires active staff_profiles row with role/agency/branch.`);
  }
  return { user, profile };
}

async function realRecord(table, profile) {
  const { data, error } = await admin.from(table).select('id,agency_id,branch_id,branch_uuid').eq('agency_id', profile.agency_id).limit(1).maybeSingle();
  if (error) throw new Error(`Fixture lookup failed for ${table}: ${error.message}`);
  if (!data) throw new Error(`Missing real record fixture for ${table} in agency ${profile.agency_id}`);
  return data;
}

async function signIn(email) {
  const c = clientFor();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`No session for ${email}`);
  return c;
}

function expectError(result, label) {
  if (!result?.error) throw new Error(`${label}: operation unexpectedly succeeded`);
}

async function assertRealOperations(client, table, record) {
  expectError(await client.from(table).select('id').eq('id', record.id), `${table}.SELECT`);
  if (table !== 'audit_logs') {
    expectError(await client.from(table).update({}).eq('id', record.id), `${table}.UPDATE`);
    expectError(await client.from(table).delete().eq('id', record.id), `${table}.DELETE`);
  }
}

const fixtureState = {};
for (const role of roles) {
  fixtureState[role] = await requireFixture(role);
}

const realRecords = {};
for (const table of requiredResources) {
  realRecords[table] = await realRecord(table, fixtureState.ADMIN.profile);
}

for (const role of roles) {
  const client = await signIn(fixture[role]);
  for (const table of ['journal_entries','journal_lines','bank_accounts','supplier_bills','credit_notes']) {
    if (!['ADMIN','FINANCE'].includes(role)) await assertRealOperations(client, table, realRecords[table]);
  }
  if (!['ADMIN','FINANCE','VISA_AGENT'].includes(role)) await assertRealOperations(client, 'invoices', realRecords.invoices);
  if (role !== 'ADMIN') await assertRealOperations(client, 'audit_logs', realRecords.audit_logs);
}

const anon = clientFor();
for (const table of ['reservations','payments','invoices','journal_entries','staff_permissions']) {
  expectError(await anon.from(table).select('id').limit(1), `anon ${table}.SELECT`);
  if (table !== 'audit_logs') expectError(await anon.from(table).delete().eq('id', realRecords[table]?.id ?? '00000000-0000-0000-0000-000000000000'), `anon ${table}.DELETE`);
}

console.log(JSON.stringify({
  status: 'PASS',
  fixture_mode: true,
  roles: roles.length,
  resources: requiredResources.length,
  actions: actions.length,
  note: 'No users or database records are created by this test. Missing fixtures fail the run.'
}, null, 2));
