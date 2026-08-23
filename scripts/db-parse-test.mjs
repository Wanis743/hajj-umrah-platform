
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const r = await client.query("select count(*)::int as n from supabase_migrations.schema_migrations where version='20260822000011'");
  if (r.rows[0].n === 0) {
    await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ('20260822000011', ARRAY['bi_semantic_layer_reconciled'], 'bi_semantic_layer')`);
    await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ('20260823131100', ARRAY['bi_agency_defaults'], 'bi_agency_defaults')`);
    console.log('bookkeeping recorded');
  } else console.log('already recorded');
  const a = await client.query("select action, resource from audit_logs where resource like 'bi_%' order by created_at desc limit 4");
  console.log('BI audit trail:', a.rows);
});
