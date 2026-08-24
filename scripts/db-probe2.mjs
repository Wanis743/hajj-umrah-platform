
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const e = await client.query('select to_regclass($1) as reg', ['public.bi_datasets']);
  console.log('bi_datasets:', e.rows[0].reg);
  if (e.rows[0].reg) {
    const c = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='bi_datasets' order by ordinal_position`);
    console.log(c.rows.map(x => x.column_name).join(', '));
  }
});
