import { supabase } from '@/lib/supabase';

export interface PublicReservationInput {
  packageId: string;
  startDate: string;
  endDate: string;
  travelers: number;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  honeypot?: string;
  turnstileToken?: string;
}

export interface PublicReservationResult {
  reference: string;
  deduplicated: boolean;
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback: use getRandomValues via globalThis to avoid TS narrowing to 'never'
  const arr = new Uint32Array(3);
  globalThis.crypto.getRandomValues(arr);
  return `res-${Date.now()}-${arr[0]}-${arr[1]}`;
}

/**
 * Submits a public reservation through the hardened `create-reservation` edge function.
 * The reference is generated server-side; the browser never writes to `reservations`.
 */
export async function submitPublicReservation(
  input: PublicReservationInput,
  idempotencyKey: string = newIdempotencyKey(),
): Promise<PublicReservationResult> {
  const headers: Record<string, string> = { 'idempotency-key': idempotencyKey };
  if (input.turnstileToken) headers['x-turnstile-token'] = input.turnstileToken;

  const { data, error } = await supabase.functions.invoke('create-reservation', {
    headers,
    body: {
      package_id: input.packageId,
      start_date: input.startDate,
      end_date: input.endDate,
      travelers: input.travelers,
      name: input.name,
      phone: input.phone,
      email: input.email ?? '',
      notes: input.notes ?? '',
      honeypot: input.honeypot ?? '',
    },
  });

  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        if (body?.error) message = String(body.error);
      } catch {
        /* keep transport message */
      }
    }
    throw new Error(message);
  }

  const payload = data as { reference?: string; deduplicated?: boolean; error?: string } | null;
  if (!payload?.reference) throw new Error(payload?.error ?? 'Unable to create reservation');
  return { reference: payload.reference, deduplicated: Boolean(payload.deduplicated) };
}

export { newIdempotencyKey };
