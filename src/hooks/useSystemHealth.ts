import { useState, useEffect, useRef, useCallback } from 'react';
import { getSupabase } from '../lib/supabase';

export interface ServiceHealth {
  name: string;
  status: 'up' | 'down' | 'checking';
}

const POLL_INTERVAL = 30_000; // 30 seconds

function getBaseUrl(): string {
  return (
    import.meta.env.VITE_SUPABASE_URL
    || localStorage.getItem('jarvis_supabase_url')
    || 'http://localhost:8000'
  );
}

// API key needed for Kong-authenticated endpoints
function getApiKey(): string {
  return (
    import.meta.env.VITE_SUPABASE_ANON_KEY
    || localStorage.getItem('jarvis_supabase_anon_key')
    || ''
  );
}

interface ServiceDef {
  name: string;
  path: string;
}

const SERVICES: ServiceDef[] = [
  { name: 'Database',       path: '/rest/v1/' },
  { name: 'Auth',           path: '/auth/v1/health' },
  { name: 'Realtime',       path: '/realtime/v1/' },
  { name: 'Storage',        path: '/storage/v1/status' },
  { name: 'Edge Functions',  path: '/functions/v1/health' },
];

async function checkService(base: string, apiKey: string, svc: ServiceDef): Promise<ServiceHealth> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${base}${svc.path}`, {
      signal: controller.signal,
      headers: apiKey ? { apikey: apiKey } : {},
    });
    clearTimeout(timer);
    // 200, 401, 404 all indicate the service is running
    const up = res.status < 500;
    return { name: svc.name, status: up ? 'up' : 'down' };
  } catch {
    return { name: svc.name, status: 'down' };
  }
}

/** Check sidecar via scheduler_state heartbeat (stale > 2 min = down) */
async function checkSidecar(): Promise<ServiceHealth> {
  try {
    const { data } = await getSupabase()
      .from('scheduler_state')
      .select('last_heartbeat, config')
      .eq('id', 'main')
      .single();
    if (!data?.last_heartbeat) return { name: 'CEO Sidecar', status: 'down' };
    const age = Date.now() - new Date(data.last_heartbeat).getTime();
    const config = (data.config ?? {}) as Record<string, unknown>;
    // If source is 'sidecar' and heartbeat is fresh, it's up
    const isSidecar = config.source === 'sidecar';
    const fresh = age < 120_000; // 2 minutes
    return { name: 'CEO Sidecar', status: (isSidecar && fresh) ? 'up' : 'down' };
  } catch {
    return { name: 'CEO Sidecar', status: 'down' };
  }
}

/** Check gateway via /health endpoint */
async function checkGateway(): Promise<ServiceHealth> {
  const gwUrl = import.meta.env.VITE_GATEWAY_URL || localStorage.getItem('jarvis_gateway_url') || 'http://localhost:3001';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${gwUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return { name: 'Gateway', status: res.ok ? 'up' : 'down' };
  } catch {
    return { name: 'Gateway', status: 'down' };
  }
}

const ALL_SERVICE_NAMES = [...SERVICES.map(s => s.name), 'CEO Sidecar', 'Gateway'];

export function useSystemHealth() {
  const [services, setServices] = useState<ServiceHealth[]>(
    ALL_SERVICE_NAMES.map(name => ({ name, status: 'checking' as const })),
  );
  const mounted = useRef(true);

  const poll = useCallback(async () => {
    const base = getBaseUrl();
    const apiKey = getApiKey();
    const results = await Promise.all([
      ...SERVICES.map(svc => checkService(base, apiKey, svc)),
      checkSidecar(),
      checkGateway(),
    ]);
    if (mounted.current) setServices(results);
  }, []);

  useEffect(() => {
    mounted.current = true;
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => { mounted.current = false; clearInterval(id); };
  }, [poll]);

  const allUp = services.every(s => s.status === 'up');
  const anyDown = services.some(s => s.status === 'down');

  return { services, allUp, anyDown, refresh: poll };
}
