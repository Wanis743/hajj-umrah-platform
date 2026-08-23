
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const c = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='audit_logs' order by ordinal_position`);
  console.log('live audit_logs cols:', c.rows.map(x => x.column_name).join(', '));
});
