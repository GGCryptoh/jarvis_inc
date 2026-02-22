import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** True when running in a browser with localStorage available. */
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

/**
 * Resolve an env variable across Vite, Node.js, and browser localStorage.
 * Vite injects import.meta.env at build time; Node.js uses process.env;
 * localStorage is the last resort for manual overrides in the browser.
 */
function getEnv(key: string): string {
  // Vite injects import.meta.env at build time
  try {
    const val = (import.meta as any).env?.[key];
    if (val) return val;
  } catch { /* not in Vite context */ }
  // Node.js process.env fallback
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key]!;
  // Browser localStorage fallback
  if (isBrowser) return localStorage.getItem(`jarvis_${key.replace('VITE_', '').toLowerCase()}`) ?? '';
  return '';
}

/**
 * Initialize the Supabase client singleton.
 * Reads from VITE_ env vars (set by .env.development or Docker setup).
 * Falls back to process.env (Node sidecar) or localStorage (browser override).
 */
export function initSupabase(url?: string, anonKey?: string): SupabaseClient {
  const supabaseUrl = url
    || getEnv('VITE_SUPABASE_URL')
    || '';
  const supabaseKey = anonKey
    || getEnv('VITE_SUPABASE_ANON_KEY')
    || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and anon key required. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,  // No auth yet — single-tenant, anon key only
      autoRefreshToken: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  // Save to localStorage for persistence across page reloads
  if (isBrowser) {
    localStorage.setItem('jarvis_supabase_url', supabaseUrl);
    localStorage.setItem('jarvis_supabase_anon_key', supabaseKey);
  }

  return client;
}

/** Get the current Supabase client. Throws if not initialized. */
export function getSupabase(): SupabaseClient {
  if (!client) throw new Error('Supabase not initialized — call initSupabase() first');
  return client;
}

/** Check if Supabase config is available (env vars or localStorage). */
export function hasSupabaseConfig(): boolean {
  return !!(
    getEnv('VITE_SUPABASE_URL')
  );
}

/** Health ping — verifies the connection works. */
export async function pingSupabase(): Promise<boolean> {
  try {
    const sb = getSupabase();
    const { error } = await sb.from('settings').select('key').limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Clear stored config (for reset). */
export function clearSupabaseConfig(): void {
  if (isBrowser) {
    localStorage.removeItem('jarvis_supabase_url');
    localStorage.removeItem('jarvis_supabase_anon_key');
  }
  client = null;
}
