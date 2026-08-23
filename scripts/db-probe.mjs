/**
 * DB probe v3 — connected. Verify frozen schema matches expectations,
 * then this same module pattern is used by the migration runner.
 */
import fs from 'node:fs';
import pg from 'pg';

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m !== null) env[m[1]] = m[2];
}
// Pooler endpoint discovered by region sweep (db.* DNS is dead on this project)
const HOST = 'aws-1-eu-west-3.pooler.supabase.com';
const REF = 'kwlyluvuwvwtblnshwal';
const authPart = env.SUPABASE_DB_URL.split('://')[1].split('@')[0]; // postgres:<password>
const PASSWORD = decodeURIComponent(authPart.slice(authPart.indexOf(':') + 1));

export async function withClient(fn) {
  const client = new pg.Client({
    host: HOST, port: 5432, user: `postgres.${REF}`, password: PASSWORD,
    database: 'postgres', connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('db-probe.mjs');
if (isMain) {
  await withClient(async (client) => {
    const q = async (sql) => (await client.query(sql)).rows;
    console.log('server:', (await q('select version() as v'))[0].v.split(',')[0]);

    const tables = await q(`select table_name from information_schema.tables where table_schema='public' order by 1`);
    console.log('public tables:', tables.length);
    for (const t of ['journal_entries', 'journal_lines', 'chart_of_accounts', 'fiscal_periods', 'audit_logs', 'staff_profiles']) {
      console.log(`  ${tables.some((r) => r.table_name === t) ? 'OK ' : 'MISS'} ${t}`);
    }

    const cols = await q(`select column_name from information_schema.columns where table_schema='public' and table_name='journal_entries' order by ordinal_position`);
    console.log('journal_entries cols:', cols.map((r) => r.column_name).join(', '));

    const rpcs = await q(`select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('post_journal_entry','get_recent_journal_entries','approve_journal_entry','current_staff_agency_id','staff_role','has_permission','require_admin_aal2') order by 1`);
    console.log('rpcs:', rpcs.map((r) => r.proname).join(', '));

    for (const t of ['staff_profiles', 'chart_of_accounts', 'journal_entries']) {
      const n = await q(`select count(*)::int as n from public.${t}`);
      console.log(`${t} rows:`, n[0].n);
    }
  });
}
