
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const r = await client.query("select count(*)::int as n from supabase_migrations.schema_migrations where version='20260823130000'");
  if (r.rows[0].n === 0) {
    await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ('20260823130000', ARRAY['missing_create_commands'], 'missing_create_commands')`);
    console.log('recorded 20260823130000');
  } else {
    console.log('already recorded');
  }
});
