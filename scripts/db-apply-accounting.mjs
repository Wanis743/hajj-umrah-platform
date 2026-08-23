/**
 * Migration runner — applies the accounting vertical to the LIVE database.
 *
 * Safety model:
 * - Explicit allowlist of reviewed files (no directory sweep).
 * - Each file runs in its own transaction; failure aborts the run.
 * - Each applied version is recorded in supabase_migrations.schema_migrations
 *   with statements + name (matching Supabase CLI bookkeeping).
 * - Re-run safe: skips versions already recorded.
 *
 * The seed_chart_of_accounts migration defines a function that seeds per-agency;
 * it does NOT insert rows at migration time, so no data is written to existing
 * agencies by this run beyond schema/function objects.
 */
import fs from 'node:fs';
import path from 'node:path';
import { withClient } from './db-probe.mjs';

const migDir = path.resolve('supabase/migrations');

// Reviewed accounting-vertical set (slice 3 scope). CRM/DMS/BI/etc. deferred.
const FILES = [
  '20260724002100_journal_entries_rpc.sql',   // reader RPC (v1)
  '20260727081100_journal_entries_rpc_v2.sql',// reader RPC (v2, current)
  '20260823120000_journal_entry_totals.sql', // rebuild-authored: restores total columns (missing from history)
  '20260821000000_post_journal_entry.sql',
  '20260821000002_fiscal_period_guard.sql',
  '20260821000003_duplicate_protection.sql',
  '20260821000004_subledger_integration.sql',
  '20260822000000_harden_financial_core.sql',
  '20260822000001_seed_chart_of_accounts.sql',
  '20260822000002_reconciliation_module.sql',
  '20260822000003_fix_rpcs.sql',
  '20260822000004_automated_ledger_engine.sql',
  '20260823120000_journal_entry_totals.sql', // (recorded above if re-run)
  '20260823120100_journal_line_dimensions.sql', // rebuild-authored: line package dimension
  '20260823120200_journal_line_agency_stamp.sql', // rebuild-authored: stamp line scope from entry
  '20260823120300_audit_logs_actor.sql', // rebuild-authored: audit_logs.actor_id for POST audit
  '20260823000010_approve_journal_entry.sql', // slice-3 approval capability
];

await withClient(async (client) => {
  const applied = new Set(
    (await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => String(r.version)),
  );

  for (const file of FILES) {
    const version = file.slice(0, 14);
    const name = file.slice(15, -4);
    if (applied.has(version)) {
      console.log(`SKIP ${version} ${name} (already recorded)`);
      continue;
    }
    const raw = fs.readFileSync(path.join(migDir, file), 'utf8');
    const sql = raw.replace(/^\uFEFF/, '').trimStart();

    try {
      await client.query('BEGIN');
      await client.query(sql); // multi-statement; pg sends as one simple query
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES ($1, $2, $3)`,
        [version, [name], name],
      );
      await client.query('COMMIT');
      console.log(`APPLY ${version} ${name}`);
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`FAILED ${file}:`, cause instanceof Error ? cause.message : cause);
      process.exit(1);
    }
  }

  // Post-apply verification
  console.log('\n--- post-apply verification ---');
  for (const fnName of ['post_journal_entry', 'get_recent_journal_entries', 'auto_reconcile_bank_statement',
    'approve_journal_entry', 'seed_default_chart_of_accounts', 'assert_open_fiscal_period']) {
    const r = await client.query(`select count(*)::int as n from pg_proc where pronamespace='public'::regnamespace and proname=$1`, [fnName]);
    console.log(`  ${r.rows[0].n > 0 ? 'OK ' : 'MISS'} function ${fnName}`);
  }
  const col = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='journal_entries' and column_name='posted_at'`);
  console.log(`  ${col.rows.length > 0 ? 'OK ' : 'MISS'} journal_entries.posted_at`);
  const trig = await client.query(`select trigger_name from information_schema.triggers where event_object_table in ('journal_entries','journal_lines') group by 1 order by 1`);
  console.log('  journal triggers:', trig.rows.map((r) => r.trigger_name).join(', ') || '(none)');
});
