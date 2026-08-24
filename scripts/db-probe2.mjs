
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  for (const t of ['documents','extraction_jobs','evidence_packages']) {
    const e = await client.query('select to_regclass($1) as reg', [`public.${t}`]);
    if (e.rows[0].reg === null) { console.log(`${t}: MISSING`); continue; }
    const c = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}' order by ordinal_position`);
    console.log(`${t}:`, c.rows.map(x => x.column_name).join(', '));
  }
  const b = await client.query(`select id, name from storage.buckets`);
  console.log('buckets:', b.rows);
});
