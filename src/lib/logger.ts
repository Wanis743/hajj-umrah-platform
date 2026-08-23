import { normalizeError } from './errors';

export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export interface LogContext {
  action?: string;
  status?: string;
  request?: string;
  error_code?: string;
  event_name: string;
  correlation_id?: string;
  agency_id?: string;
  branch_id?: string;
  actor_id?: string;
  release_version?: string;
  environment?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

const SENSITIVE = /authorization|cookie|token|password|secret|passport|phone|email|ip|user.?agent/i;

function sanitize(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE.test(key) ? '[REDACTED]' : sanitize(val);
  }
  return out;
}

const sink = (severity: LogSeverity, context: LogContext) => {
  const payload = {
    action: context.action ?? 'unknown',
    status: context.status ?? 'ok',
    request: context.request ?? 'none',
    error_code: context.error_code ?? null,
    severity,
    release_version: context.release_version ?? import.meta.env.VITE_APP_VERSION ?? 'dev',
    environment: context.environment ?? import.meta.env.MODE,
    ...context,
    metadata: sanitize(context.metadata ?? {}),
    timestamp: new Date().toISOString(),
  };
  const serialized = JSON.stringify(payload);
  if (severity === 'ERROR' || severity === 'FATAL') console.error(serialized);
  else if (severity === 'WARN') console.warn(serialized);
  // eslint-disable-next-line no-console
  else console.info(serialized);
  return payload;
};

export function reportError(event_name: string, error: unknown, metadata?: Record<string, unknown>): void {
  const normalized = normalizeError(error);
  sink('ERROR', {
    event_name,
    metadata: {
      code: normalized.code,
      ...(normalized.causeCode !== undefined ? { causeCode: normalized.causeCode } : {}),
      ...(metadata ?? {}),
    },
  });
}

export function reportWarning(event_name: string, metadata?: Record<string, unknown>): void {
  sink('WARN', metadata ? { event_name, metadata } : { event_name });
}

export function reportInfo(event_name: string, metadata?: Record<string, unknown>): void {
  sink('INFO', metadata ? { event_name, metadata } : { event_name });
}
