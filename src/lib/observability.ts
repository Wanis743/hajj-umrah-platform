import { supabase } from '@/lib/supabase';
import { reportWarning } from '@/lib/logger';

export async function trackObservability(eventName: string, severity: 'INFO'|'WARN'|'ERROR'|'FATAL', metadata: Record<string, unknown> = {}) {
  try {
    await supabase.from('observability_events').insert({
      severity,
      event_name: eventName,
      correlation_id: crypto.randomUUID(),
      release_version: import.meta.env.VITE_APP_VERSION ?? 'dev',
      environment: import.meta.env.MODE,
      metadata,
    });
  } catch {
    reportWarning('observability.sink_failed', { eventName });
  }
}
