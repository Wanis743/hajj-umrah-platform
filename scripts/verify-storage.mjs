const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const bucket = process.env.STORAGE_TEST_BUCKET || 'documents';
const objectPath = process.env.STORAGE_TEST_OBJECT || 'security-test/nonexistent.txt';

if (!supabaseUrl || !anonKey) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
  process.exit(2);
}

const base = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`;
const res = await fetch(base, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } });
console.log(JSON.stringify({
  check: 'anonymous_private_object_download',
  status: res.status,
  pass: res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404,
}, null, 2));
if (![400,401,403,404].includes(res.status)) process.exit(1);
