
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const r = await client.query(`update public.fiscal_periods set status='OPEN', closed_at=null, closed_by=null where status in ('CLOSED','LOCKED')`);
  console.log('reopened', r.rowCount);
});
