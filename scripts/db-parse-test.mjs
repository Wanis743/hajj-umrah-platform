
import { withClient } from './db-probe.mjs';
await withClient(async (client) => {
  const r = await client.query("select id, friendly_name, status from auth.mfa_factors where factor_type='totp'");
  console.log(r.rows);
});
