import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const configuredOrigins = (Deno.env.get('RESERVATION_ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsHeaders = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && configuredOrigins.includes(origin) ? origin : '',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-turnstile-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

const json = (body: unknown, origin: string | null, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });

function normalizePhone(value: string) {
  return value.replace(/[^0-9+]/g, '').slice(0, 20);
}

function validEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno./* eslint-disable complexity */
serve(async (req) => {
  const origin = req.headers.get('origin');
  if (origin && !configuredOrigins.includes(origin)) return json({ error: 'Origin not allowed' }, origin, 403);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, origin, 405);

  try {
    const isProduction = (Deno.env.get('APP_ENV') ?? 'production').toLowerCase() === 'production';
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || configuredOrigins.length === 0) return json({ error: 'Server configuration error' }, origin, 500);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const body = await req.json();
    const honeypot = String(body.honeypot ?? '').trim();
    if (honeypot) return json({ error: 'Invalid request' }, origin, 400);

    const name = String(body.name ?? '').trim();
    const phone = normalizePhone(String(body.phone ?? ''));
    const email = String(body.email ?? '').trim();
    const packageId = String(body.package_id ?? '');
    const startDate = String(body.start_date ?? '');
    const endDate = String(body.end_date ?? '');
    const travelers = Number(body.travelers);
    const notes = String(body.notes ?? '').trim();
    const suppliedIdempotencyKey = String(req.headers.get('idempotency-key') ?? '').trim();
    if (isProduction && !suppliedIdempotencyKey) return json({ error: 'Idempotency key required' }, origin, 400);

    if (name.length < 2 || name.length > 120) return json({ error: 'Invalid name' }, origin, 400);
    if (phone.length < 8 || phone.length > 20) return json({ error: 'Invalid phone' }, origin, 400);
    if (!validEmail(email)) return json({ error: 'Invalid email' }, origin, 400);
    if (!packageId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return json({ error: 'Invalid travel dates' }, origin, 400);
    if (endDate < startDate) return json({ error: 'End date must be after start date' }, origin, 400);
    if (!Number.isInteger(travelers) || travelers < 1 || travelers > 20) return json({ error: 'Invalid travelers count' }, origin, 400);
    if (notes.length > 4000) return json({ error: 'Notes too long' }, origin, 400);
    if (suppliedIdempotencyKey && (suppliedIdempotencyKey.length < 8 || suppliedIdempotencyKey.length > 128)) return json({ error: 'Invalid idempotency key' }, origin, 400);

    const trustedEdgeIp = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-vercel-forwarded-for');
    if (isProduction && !trustedEdgeIp) return json({ error: 'Unable to determine client network identity' }, origin, 503);
    const realIp = trustedEdgeIp ?? 'unknown';
    const ipHash = await sha256(realIp);
    const { data: allowed, error: limitError } = await admin.rpc('consume_reservation_rate_limit', {
      p_ip_hash: ipHash,
      p_window_seconds: 600,
      p_max_requests: 5,
    });
    if (limitError) return json({ error: 'Rate limit service unavailable' }, origin, 503);
    if (!allowed) return json({ error: 'Too many reservation attempts. Please try again later.' }, origin, 429);

    const turnstileSecret = Deno.env.get('TURNSTILE_SECRET');
    const turnstileToken = req.headers.get('x-turnstile-token');
    if (isProduction && !turnstileSecret) return json({ error: 'Captcha service is not configured' }, origin, 503);
    if (turnstileSecret || isProduction) {
      if (!turnstileToken) return json({ error: 'Captcha required' }, origin, 400);
      const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: turnstileSecret!, response: turnstileToken, remoteip: realIp }),
      });
      const verify = await verifyResponse.json();
      if (!verify.success) return json({ error: 'Captcha verification failed' }, origin, 400);
    }

    const { data: pkg, error: packageError } = await admin
      .from('packages')
      .select('id, name, seats_available, status')
      .eq('id', packageId)
      .eq('status', 'ACTIVE')
      .maybeSingle();
    if (packageError) return json({ error: 'Unable to validate package' }, origin, 500);
    if (!pkg) return json({ error: 'Package is not available' }, origin, 400);
    if (Number(pkg.seats_available ?? 0) < travelers) return json({ error: 'Not enough capacity' }, origin, 409);

    const canonicalPayload = JSON.stringify({ packageId: pkg.id, startDate, endDate, travelers, name, phone, email: email || '', notes: notes || '' });
    const requestHash = await sha256(canonicalPayload);
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const idempotencyKey = suppliedIdempotencyKey || await sha256(`${requestHash}:${bucket}`);

    const { data: reservation, error } = await admin.from('reservations').insert({
      package_id: pkg.id,
      package_name: pkg.name,
      start_date: startDate,
      end_date: endDate,
      travelers,
      name,
      phone,
      email: email || null,
      notes: notes || null,
      status: 'pending',
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
    }).select('reference, request_hash').single();

    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await admin.from('reservations').select('reference, request_hash').eq('idempotency_key', idempotencyKey).maybeSingle();
        if (!existing) return json({ error: 'Unable to create reservation' }, origin, 400);
        if (existing.request_hash !== requestHash) return json({ error: 'Idempotency key was already used for a different request' }, origin, 409);
        return json({ reference: existing.reference, deduplicated: true }, origin);
      }
      return json({ error: 'Unable to create reservation' }, origin, 400);
    }
    return json({ reference: reservation.reference, deduplicated: false }, origin);
  } catch (error) {
    console.error(error);
    return json({ error: 'Unexpected server error' }, origin, 500);
  }
});
