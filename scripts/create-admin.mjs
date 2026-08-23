import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!url || !key || !email || !password) {
  console.error('Required env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD');
  process.exit(1);
}
if (password.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: users, error: listError } = await client.auth.admin.listUsers();
if (listError) throw listError;

let user = users.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  user = created.data.user;
} else {
  const updated = await client.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (updated.error) throw updated.error;
}

const { error: profileError } = await client
  .from('staff_profiles')
  .upsert({ user_id: user.id, role: 'ADMIN', is_active: true }, { onConflict: 'user_id' });
if (profileError) throw profileError;

console.log(`Admin ready: ${user.email} (${user.id})`);
