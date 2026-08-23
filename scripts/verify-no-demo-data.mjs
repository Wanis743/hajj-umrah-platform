import { spawnSync } from 'node:child_process';
const sql = `
select
  (select count(*) from public.packages where id::text like '10000000-0000-0000-0000-%') as demo_packages,
  (select count(*) from public.pilgrims where id::text like '20000000-0000-0000-0000-%') as demo_pilgrims,
  (select count(*) from public.bookings where id::text like '30000000-0000-0000-0000-%') as demo_bookings,
  (select count(*) from public.payments where id::text like '40000000-0000-0000-0000-%') as demo_payments,
  (select count(*) from public.audit_logs where lower(coalesce(user_email,''))='admin@bousalem.dz') as demo_audit,
  (select count(*) from auth.users where lower(email)=lower('admin@bousalem.dz')) as demo_auth;
`;
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is required for no-demo runtime verification.');
const r = spawnSync('psql', [process.env.SUPABASE_DB_URL, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', sql], { stdio: ['ignore','pipe','inherit'], encoding: 'utf8' });
if (r.status !== 0) process.exit(r.status ?? 1);
const values = (r.stdout || '').trim().split('|').map(Number);
if (values.length !== 6 || values.some((v) => v !== 0)) throw new Error(`Demo data guard failed: ${r.stdout}`);
console.log('No-demo runtime verification passed.');
