type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

export interface ProviderDeliveryRequest {
  channel: Channel;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  timeoutMs?: number;
}

export interface ProviderDeliveryResponse {
  ok: boolean;
  provider: string;
  status: number | null;
  providerMessageId?: string;
  response?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

type Config = { url?: string; apiKey?: string; provider: string };

function config(channel: Channel): Config {
  const env: Record<Channel, Config> = {
    EMAIL: { url: Deno.env.get('EMAIL_PROVIDER_URL'), apiKey: Deno.env.get('EMAIL_API_KEY'), provider: Deno.env.get('EMAIL_PROVIDER_NAME') ?? 'email-provider' },
    SMS: { url: Deno.env.get('SMS_PROVIDER_URL'), apiKey: Deno.env.get('SMS_API_KEY'), provider: Deno.env.get('SMS_PROVIDER_NAME') ?? 'sms-provider' },
    WHATSAPP: { url: Deno.env.get('WHATSAPP_PROVIDER_URL'), apiKey: Deno.env.get('WHATSAPP_API_KEY'), provider: Deno.env.get('WHATSAPP_PROVIDER_NAME') ?? 'whatsapp-provider' },
    PUSH: { url: Deno.env.get('PUSH_PROVIDER_URL'), apiKey: Deno.env.get('PUSH_API_KEY'), provider: Deno.env.get('PUSH_PROVIDER_NAME') ?? 'push-provider' },
  };
  return env[channel];
}

export async function deliverViaProvider(request: ProviderDeliveryRequest): Promise<ProviderDeliveryResponse> {
  const cfg = config(request.channel);
  if (!cfg.url || !cfg.apiKey) {
    return { ok: false, provider: cfg.provider, status: null, errorCode: 'PROVIDER_NOT_CONFIGURED', errorMessage: `Provider is not configured for ${request.channel}.` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 10_000);
  try {
    const response = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
        'idempotency-key': request.idempotencyKey,
      },
      body: JSON.stringify({
        channel: request.channel,
        to: request.recipient,
        recipient: request.recipient,
        template: request.template,
        payload: request.payload,
      }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    let parsed: unknown = null;
    try { parsed = responseText ? JSON.parse(responseText) : null; } catch { parsed = responseText; }
    const providerMessageId =
      parsed && typeof parsed === 'object' && parsed !== null && 'id' in parsed
        ? String((parsed as { id: unknown }).id)
        : undefined;

    return response.ok
      ? { ok: true, provider: cfg.provider, status: response.status, ...(providerMessageId ? { providerMessageId } : {}), response: parsed }
      : { ok: false, provider: cfg.provider, status: response.status, response: parsed, errorCode: 'PROVIDER_REJECTED', errorMessage: `Provider returned HTTP ${response.status}.` };
  } catch (error) {
    return {
      ok: false,
      provider: cfg.provider,
      status: null,
      errorCode: error instanceof Error && error.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR',
      errorMessage: error instanceof Error ? error.message : 'Provider request failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function providerHealth(): Record<Channel, boolean> {
  return {
    EMAIL: Boolean(Deno.env.get('EMAIL_PROVIDER_URL') && Deno.env.get('EMAIL_API_KEY')),
    SMS: Boolean(Deno.env.get('SMS_PROVIDER_URL') && Deno.env.get('SMS_API_KEY')),
    WHATSAPP: Boolean(Deno.env.get('WHATSAPP_PROVIDER_URL') && Deno.env.get('WHATSAPP_API_KEY')),
    PUSH: Boolean(Deno.env.get('PUSH_PROVIDER_URL') && Deno.env.get('PUSH_API_KEY')),
  };
}
