
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  for (const t of ['fpa_models','fpa_scenarios','fpa_planning_cycles','simulation_jobs','optimization_jobs','cash_positions','financial_controls','risk_events']) {
    const e = await client.query('select to_regclass($1) as reg', [`public.${t}`]);
    if (e.rows[0].reg === null) { console.log(`${t}: MISSING`); continue; }
    const c = await client.query(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}' order by ordinal_position`);
    console.log(`${t}:`, c.rows.map(x => x.column_name).join(', '));
  }
});
