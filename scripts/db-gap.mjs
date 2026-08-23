/** Migration gap analysis — which repo migrations are NOT applied to the live DB. */
import fs from 'node:fs';
import path from 'node:path';
import { withClient } from './db-probe.mjs';

const migDir = path.resolve('supabase/migrations');
const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql') && !f.startsWith('fix')).sort();

await withClient(async (client) => {
  // Supabase records applied migrations in supabase_migrations.schema_migrations
  let applied;
  try {
    const r = await client.query('select version from supabase_migrations.schema_migrations order by version');
    applied = new Set(r.rows.map((row) => String(row.version)));
    console.log(`remote migration records: ${applied.size}`);
  } catch {
    console.log('no supabase_migrations table visible (remote managed outside CLI?)');
    applied = new Set();
  }

  // Ground truth: which objects actually exist?
  const fn = async (name) => {
    const r = await client.query(`select count(*)::int as n from pg_proc where pronamespace='public'::regnamespace and proname=$1`, [name]);
    return r.rows[0].n > 0;
  };

  console.log('\n--- object ground truth ---');
  for (const [label, name] of [
    ['post_journal_entry', 'post_journal_entry'],
    ['get_recent_journal_entries', 'get_recent_journal_entries'],
    ['auto_reconcile_bank_statement', 'auto_reconcile_bank_statement'],
    ['assert_open_fiscal_period', 'assert_open_fiscal_period'],
    ['close_fiscal_period', 'close_fiscal_period'],
    ['seed_default_chart_of_accounts', 'seed_default_chart_of_accounts'],
    ['apply_import_batch (import)', 'apply_import_batch'],
  ]) {
    console.log(`  ${(await fn(name)) ? 'OK ' : 'MISS'} ${label}`);
  }

  const t = async (name) => {
    const r = await client.query(`select to_regclass($1) as reg`, [`public.${name}`]);
    return r.rows[0].reg !== null;
  };
  for (const name of ['financial_models', 'model_scenarios', 'bank_statements', 'bank_transactions', 'import_batches', 'import_batch_rows', 'invoices', 'payments']) {
    console.log(`  table ${(await t(name)) ? 'OK ' : 'MISS'} ${name}`);
  }
});
