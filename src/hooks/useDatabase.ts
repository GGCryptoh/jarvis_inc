import { useState, useEffect, useCallback } from 'react';
import { initDatabase, isFounderInitialized, isCEOInitialized, resetDatabase } from '../lib/database';

interface DatabaseState {
  ready: boolean;
  initialized: boolean;       // founder has completed ceremony
  ceoInitialized: boolean;    // CEO has been designated
  error: string | null;
}

/**
 * Top-level hook that boots the SQLite database.
 * Returns { ready, initialized, ceoInitialized, reset, reinit }.
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
    initDatabase()
      .then(() => {
        setState({
          ready: true,
          initialized: isFounderInitialized(),
          ceoInitialized: isCEOInitialized(),
          error: null,
        });
      })
      .catch((err) => {
        setState({ ready: false, initialized: false, ceoInitialized: false, error: String(err) });
      });
  }, []);

  // Reset DB -> back to ceremonies
  const reset = useCallback(async () => {
    await resetDatabase();
    setState({ ready: false, initialized: false, ceoInitialized: false, error: null });
    // Re-init fresh DB
    await initDatabase();
    setState({ ready: true, initialized: false, ceoInitialized: false, error: null });
  }, []);

  // Re-check initialization (call after ceremony writes to DB)
  const reinit = useCallback(() => {
    setState((prev) => ({
      ...prev,
      initialized: isFounderInitialized(),
      ceoInitialized: isCEOInitialized(),
    }));
  }, []);

  return { ...state, reset, reinit };
}
