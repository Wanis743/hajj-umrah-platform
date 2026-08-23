/** Check which of the unguarded CREATE TABLE targets already exist in the live DB. */
import { withClient } from './db-probe.mjs';

await withClient(async (client) => {
  for (const name of ['payment_allocations', 'bank_statements', 'bank_transactions']) {
    const r = await client.query('select to_regclass($1) as reg', [`public.${name}`]);
    const exists = r.rows[0].reg !== null;
    let rows = 0;
    if (exists) {
      const c = await client.query(`select count(*)::int as n from public.${name}`);
      rows = c.rows[0].n;
    }
    console.log(`${exists ? (rows > 0 ? 'DATA' : 'EXISTS') : 'absent'}  ${name}${exists ? ` (${rows} rows)` : ''}`);
  }
});
