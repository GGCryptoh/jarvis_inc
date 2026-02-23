// SWR cache utility — show localStorage data immediately, fetch fresh in background
// Cache TTL: 20 minutes. Hard F5 bypasses cache.

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options?: {
    onFresh?: (data: T) => void; // Called when fresh data arrives
    skipCache?: boolean; // Force fresh fetch (hard F5)
  }
): Promise<T> {
  // 1. Try localStorage first
  if (!options?.skipCache && typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`mkt_cache_${key}`);
      if (cached) {
        const entry: CacheEntry<T> = JSON.parse(cached);
        const age = Date.now() - entry.timestamp;

        if (age < CACHE_TTL_MS) {
          // Fresh enough — return cached, revalidate in background
          fetcher()
            .then((fresh) => {
              localStorage.setItem(
                `mkt_cache_${key}`,
                JSON.stringify({ data: fresh, timestamp: Date.now() })
              );
              options?.onFresh?.(fresh);
            })
            .catch(() => {}); // Silent background failure

          return entry.data;
        }
      }
    } catch {
      /* localStorage may be full or unavailable */
    }
  }

  // 2. No cache or expired — fetch fresh
  const data = await fetcher();

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(
        `mkt_cache_${key}`,
        JSON.stringify({ data, timestamp: Date.now() })
      );
    } catch {
      /* Storage full — that's fine */
    }
  }

  return data;
}

/** Clear all marketplace cache entries */
export function clearCache(): void {
  if (typeof window === 'undefined') return;
  const keys = Object.keys(localStorage).filter((k) =>
    k.startsWith('mkt_cache_')
  );
  keys.forEach((k) => localStorage.removeItem(k));
}
