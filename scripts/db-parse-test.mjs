
import fs from 'node:fs';
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  await client.query(fs.readFileSync('supabase/migrations/20260824090500_bank_tx_match_columns.sql', 'utf8'));
  await client.query(fs.readFileSync('supabase/migrations/20260824090600_auto_reconcile_truthful.sql', 'utf8'));
  for (const v of ['20260824090500', '20260824090600']) {
    const r = await client.query("select count(*)::int as n from supabase_migrations.schema_migrations where version=$1", [v]);
    if (r.rows[0].n === 0) await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ($1, ARRAY['bank_match_columns'], 'bank_recon_truthful')`, [v]);
  }
  console.log('recon migrations applied + recorded');
});
