/**
 * Pre-flight for applying the accounting vertical to the LIVE database.
 * 1. Inspect supabase_migrations.schema_migrations shape
 * 2. Logical backup of finance-critical tables to local JSON (gitignored dir)
 */
import fs from 'node:fs';
import { withClient } from './db-probe.mjs';

fs.mkdirSync('docs/rebuild/backup', { recursive: true });

await withClient(async (client) => {
  // 1) bookkeeping table shape
  const cols = await client.query(
    `select column_name, data_type from information_schema.columns
     where table_schema='supabase_migrations' and table_name='schema_migrations' order by ordinal_position`,
  );
  console.log('schema_migrations cols:', cols.rows.map((r) => `${r.column_name}:${r.data_type}`).join(', '));

  const applied = await client.query('select count(*)::int as n from supabase_migrations.schema_migrations');
  console.log('applied count:', applied.rows[0].n);

  // 2) backup critical tables (small dataset)
  const tables = ['chart_of_accounts', 'journal_entries', 'journal_lines', 'payments', 'invoices', 'audit_logs', 'staff_profiles'];
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '');
  for (const t of tables) {
    const r = await client.query(`select * from public.${t}`);
    const file = `docs/rebuild/backup/${t}-${stamp}.json`;
    fs.writeFileSync(file, JSON.stringify(r.rows, null, 1));
    console.log(`backed up ${t}: ${r.rows.length} rows -> ${file}`);
  }

  // 3) confirm staff identity + role for the upcoming E2E (no secrets printed)
  const staff = await client.query(`select role, agency_id, branch_id, is_active from public.staff_profiles limit 3`);
  console.log('staff profiles:', staff.rows.map((r) => `${r.role}/active=${r.is_active}`).join(' | '));

  // 4) open fiscal periods (approval requires one covering entry_date)
  const periods = await client.query(`select label, start_date, end_date, status from public.fiscal_periods order by start_date desc limit 5`);
  console.log('fiscal periods:', periods.rows.map((r) => `${r.label}:${r.status}`).join(' | ') || 'NONE');
});
