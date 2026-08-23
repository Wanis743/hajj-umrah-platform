import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { reportWarning } from './logger';

export const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  reportWarning('supabase.config', { missingConfiguration: true });
}

/**
 * In production builds (import.meta.env.PROD), we do NOT fall back to
 * localhost. Instead we create an intentionally broken client so that every
 * call returns a clear network error and the UI surfaces BACKEND_NOT_CONFIGURED
 * rather than silently trying (and failing) to reach a dev server.
 *
 * In development builds the localhost placeholder is kept for convenience.
 */
const PLACEHOLDER_URL = import.meta.env.PROD
  ? 'https://not-configured.supabase.co'   // will fail fast with network error
  : 'http://localhost:54321';               // dev convenience

const PLACEHOLDER_KEY = 'backend-not-configured';

export const supabase = createClient<Database>(
  supabaseUrl || PLACEHOLDER_URL,
  supabaseAnonKey || PLACEHOLDER_KEY,
);
