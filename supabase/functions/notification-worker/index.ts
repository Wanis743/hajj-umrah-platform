import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { deliverViaProvider } from './providerAdapters.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function authorized(req: Request): boolean {
  const expected = Deno.env.get('WORKER_SECRET');
  const provided = req.headers.get('x-worker-secret') ?? '';
  return Boolean(expected && provided && provided === expected);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorized(req)) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Server configuration error' }, 500);

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), 100);
  const { data, error } = await supabase.rpc('claim_notification_queue', { p_limit: limit });
  if (error) return json({ error: error.message }, 500);

  let sent = 0;
  let failed = 0;

  for (const item of data ?? []) {
    const requestHash = await sha256(JSON.stringify({
      channel: item.channel,
      recipient: item.recipient,
      template: item.template,
      payload: item.payload,
    }));
    const idempotencyKey = `notification:${item.id}`;

    try {
      if (item.channel === 'IN_APP') {
        await supabase.from('notification_delivery_attempts').insert({
          notification_id: item.id,
          channel: item.channel,
          provider: 'supabase-in-app',
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          status: 'SENT',
          http_status: 200,
          provider_response: { mode: 'IN_APP' },
          attempted_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        });
        await supabase.rpc('complete_notification_queue', { p_id: item.id });
        sent += 1;
        continue;
      }

      const result = await deliverViaProvider({
        channel: item.channel,
        recipient: item.recipient,
        template: item.template,
        payload: item.payload as Record<string, unknown>,
        idempotencyKey,
      });

      await supabase.from('notification_delivery_attempts').insert({
        notification_id: item.id,
        channel: item.channel,
        provider: result.provider,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        status: result.ok ? 'SENT' : 'FAILED',
        http_status: result.status,
        provider_message_id: result.providerMessageId ?? null,
        provider_response: result.response ?? null,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
        attempted_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      if (!result.ok) throw new Error(result.errorMessage ?? result.errorCode ?? 'Delivery failed');
      await supabase.rpc('complete_notification_queue', { p_id: item.id });
      sent += 1;
    } catch (err) {
      await supabase.rpc('fail_notification_queue', {
        p_id: item.id,
        p_error: err instanceof Error ? err.message : 'Delivery failed',
      });
      failed += 1;
    }
  }

  return json({ claimed: data?.length ?? 0, sent, failed });
});
