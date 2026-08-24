
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const r = await client.query(`select pg_get_function_arguments(oid) as args, pg_get_function_result(oid) as ret, prosecdef from pg_proc where pronamespace='public'::regnamespace and proname='get_group_profitability'`);
  console.log(`get_group_profitability(${r.rows[0].args}) -> ${r.rows[0].ret} definer=${r.rows[0].prosecdef}`);
});
