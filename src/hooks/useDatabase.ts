import { useState, useEffect, useCallback } from 'react';
import { hasSupabaseConfig, initSupabase, pingSupabase, clearSupabaseConfig } from '../lib/supabase';
import { isFounderInitialized, isCEOInitialized, resetDatabase } from '../lib/database';

interface DatabaseState {
  ready: boolean;
  initialized: boolean;       // founder has completed ceremony
  ceoInitialized: boolean;    // CEO has been designated
  error: string | null;
}

/**
 * Top-level hook that connects to Supabase.
 * Returns { ready, initialized, ceoInitialized, error, reset, reinit }.
 */
export function useDatabase() {
  const [state, setState] = useState<DatabaseState>({
    ready: false,
    initialized: false,
    ceoInitialized: false,
    error: null,
  });

  // Boot
  useEffect(() => {
    async function boot() {
      try {
        // Check if Supabase config is available
        if (!hasSupabaseConfig()) {
          setState({
            ready: false,
            initialized: false,
            ceoInitialized: false,
            error: 'No Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.development',
          });
          return;
        }

        // Initialize the Supabase client
        initSupabase();

        // Verify connection
        const ok = await pingSupabase();
        if (!ok) {
          setState({
            ready: false,
            initialized: false,
            ceoInitialized: false,
            error: 'Cannot reach Supabase. Is the Docker stack running? (npm run jarvis)',
          });
          return;
        }

        // Check initialization state
        const founderReady = await isFounderInitialized();
        const ceoReady = founderReady ? await isCEOInitialized() : false;

        setState({
          ready: true,
          initialized: founderReady,
          ceoInitialized: ceoReady,
          error: null,
        });
      } catch (err) {
        setState({
          ready: false,
          initialized: false,
          ceoInitialized: false,
          error: String(err),
        });
      }
    }
    boot();
  }, []);

  // Reset DB → truncate all tables, re-check
  const reset = useCallback(async () => {
    setState({ ready: false, initialized: false, ceoInitialized: false, error: null });
    await resetDatabase();
    setState({ ready: true, initialized: false, ceoInitialized: false, error: null });
  }, []);

  // Re-check initialization (call after ceremony writes to DB)
  const reinit = useCallback(async () => {
    const founderReady = await isFounderInitialized();
    const ceoReady = founderReady ? await isCEOInitialized() : false;
    setState(prev => ({
      ...prev,
      initialized: founderReady,
      ceoInitialized: ceoReady,
    }));
  }, []);

  return { ...state, reset, reinit };
}
