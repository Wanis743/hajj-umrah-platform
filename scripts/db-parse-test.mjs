
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  await client.query(`insert into supabase_migrations.schema_migrations (version, statements, name) values ('20260823131100', ARRAY['bi_agency_defaults'], 'bi_agency_defaults')`);
  console.log('recorded');
});
