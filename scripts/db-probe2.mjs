
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const t = await client.query(`select table_name from information_schema.tables where table_schema='public' and table_name ilike '%quote%'`);
  console.log('tables:', t.rows.map(x => x.table_name));
  const c = await client.query(`select table_name, column_name from information_schema.columns where table_schema='public' and column_name='quote_id'`);
  console.log('cols w/ quote_id:', c.rows);
});
