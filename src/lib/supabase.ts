import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Initialize the Supabase client singleton.
 * Reads from VITE_ env vars (set by .env.development or Docker setup).
 * Falls back to localStorage for manual override.
 */
export function initSupabase(url?: string, anonKey?: string): SupabaseClient {
  const supabaseUrl = url
    || import.meta.env.VITE_SUPABASE_URL
    || localStorage.getItem('jarvis_supabase_url')
    || '';
  const supabaseKey = anonKey
    || import.meta.env.VITE_SUPABASE_ANON_KEY
    || localStorage.getItem('jarvis_supabase_anon_key')
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
  localStorage.setItem('jarvis_supabase_url', supabaseUrl);
  localStorage.setItem('jarvis_supabase_anon_key', supabaseKey);

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
    import.meta.env.VITE_SUPABASE_URL
    || localStorage.getItem('jarvis_supabase_url')
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
  localStorage.removeItem('jarvis_supabase_url');
  localStorage.removeItem('jarvis_supabase_anon_key');
  client = null;
}
