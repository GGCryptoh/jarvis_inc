/**
 * Marketplace Client — Registration and status checking
 *
 * Handles communication between a Jarvis instance and the marketplace hub
 * at jarvisinc.app. Uses the Ed25519 keypair from jarvisKey.ts for signing.
 *
 * Registration happens during KeySetupStep (Founder Ceremony) when the raw
 * private key is available before encryption. Subsequent status checks are
 * purely local (localStorage).
 */

import { loadKeyFromLocalStorage as loadKeyFromLS, signPayload, type KeyFileData } from './jarvisKey';
import { getSetting, setSetting, loadSkills, loadAgents, saveVaultEntry, getVaultEntryByService } from './database';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const MARKETPLACE_URL = 'https://jarvisinc.app';

// ---------------------------------------------------------------------------
// Session key cache — raw private key with optional persistence
//
// By default, the decrypted key lives only in a JS variable (lost on refresh).
// The founder can choose an unlock duration to persist across refreshes:
//   'session'  — in-memory only (default, cleared on page refresh)
//   'day'      — localStorage, 24h TTL
//   'week'     — localStorage, 7d TTL
//   'month'    — localStorage, 30d TTL
//   'forever'  — localStorage, no expiry
// ---------------------------------------------------------------------------

export type UnlockDuration = 'session' | 'day' | 'week' | 'month' | 'forever';

const SIGNING_CACHE_KEY = 'jarvis-signing-cache';
const SIGNING_DURATION_KEY = 'jarvis-signing-duration';

let sessionRawPrivateKey: string | null = null;

// Sidecar caches (populated by initSidecarSigning)
let cachedKeyFileData: KeyFileData | null = null;
let cachedRegistrationState: {
  registered: boolean; instanceId: string; nickname: string;
} | null = null;

/** Isomorphic key loader — uses sidecar cache in Node.js, localStorage in browser */
function loadKeyFromLocalStorage(): KeyFileData | null {
  if (cachedKeyFileData) return cachedKeyFileData;
  if (typeof window === 'undefined') return null;
  return loadKeyFromLS();
}

/** Get the user's preferred unlock duration */
export function getUnlockDuration(): UnlockDuration {
  if (typeof window === 'undefined') return 'forever'; // sidecar: always unlocked
  return (localStorage.getItem(SIGNING_DURATION_KEY) as UnlockDuration) || 'session';
}

/** Set the preferred unlock duration */
export function setUnlockDuration(duration: UnlockDuration): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIGNING_DURATION_KEY, duration);
  // If switching to 'session', clear any persisted cache
  if (duration === 'session') {
    localStorage.removeItem(SIGNING_CACHE_KEY);
  }
  // If we have a key in memory, re-persist with the new duration
  if (sessionRawPrivateKey && duration !== 'session') {
    persistSigningCache(sessionRawPrivateKey, duration);
  }
}

function persistSigningCache(key: string, duration: UnlockDuration): void {
  if (typeof window === 'undefined') return;
  if (duration === 'session') return;
  const ttlMs: Record<string, number> = {
    day:   24 * 60 * 60 * 1000,
    week:  7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };
  const expiresAt = duration === 'forever' ? null : Date.now() + (ttlMs[duration] ?? ttlMs.day);
  localStorage.setItem(SIGNING_CACHE_KEY, JSON.stringify({ key, expiresAt }));
}

/** Persist the signing key to vault so the sidecar can sign without a browser. */
export async function persistKeyToVault(rawKey?: string): Promise<boolean> {
  const key = rawKey ?? getCachedRawPrivateKey();
  if (!key) return false;
  const keyData = loadKeyFromLocalStorage();
  if (!keyData) return false;
  await saveVaultEntry({
    id: 'marketplace-signing',
    name: 'Marketplace Signing Key',
    type: 'signing',
    service: 'marketplace-signing',
    key_value: JSON.stringify({
      rawPrivateKey: key,
      publicKey: keyData.publicKey,
      publicKeyHash: keyData.publicKeyHash,
      createdAt: keyData.createdAt,
    }),
  });
  return true;
}

/** Cache the raw (decrypted) private key for browser-side signing */
export function cacheRawPrivateKey(key: string): void {
  sessionRawPrivateKey = key;
  const duration = getUnlockDuration();
  if (duration !== 'session') {
    persistSigningCache(key, duration);
  }
  // Fire-and-forget: persist to vault for sidecar signing
  persistKeyToVault(key).catch(err => console.warn('[Marketplace] Vault persist failed:', err));
}

/** Get the cached raw private key — checks memory first, then localStorage */
export function getCachedRawPrivateKey(): string | null {
  if (sessionRawPrivateKey) return sessionRawPrivateKey;
  if (typeof window === 'undefined') return null; // sidecar uses sessionRawPrivateKey directly

  // Try restoring from localStorage
  const raw = localStorage.getItem(SIGNING_CACHE_KEY);
  if (!raw) return null;
  try {
    const { key, expiresAt } = JSON.parse(raw) as { key: string; expiresAt: number | null };
    if (expiresAt !== null && Date.now() > expiresAt) {
      // Expired — clear it
      localStorage.removeItem(SIGNING_CACHE_KEY);
      return null;
    }
    // Restore to memory
    sessionRawPrivateKey = key;
    return key;
  } catch {
    localStorage.removeItem(SIGNING_CACHE_KEY);
    return null;
  }
}

/** Clear the signing cache (both memory and localStorage) */
export function clearSigningCache(): void {
  sessionRawPrivateKey = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SIGNING_CACHE_KEY);
  }
}

/** Get human-readable expiry info */
export function getSigningExpiry(): { unlocked: boolean; label: string } {
  if (!getCachedRawPrivateKey()) return { unlocked: false, label: 'LOCKED' };
  if (typeof window === 'undefined') return { unlocked: true, label: 'SIDECAR' };
  const duration = getUnlockDuration();
  if (duration === 'session') return { unlocked: true, label: 'THIS SESSION' };
  if (duration === 'forever') return { unlocked: true, label: 'ALWAYS' };
  const raw = localStorage.getItem(SIGNING_CACHE_KEY);
  if (!raw) return { unlocked: true, label: duration.toUpperCase() };
  try {
    const { expiresAt } = JSON.parse(raw) as { expiresAt: number | null };
    if (!expiresAt) return { unlocked: true, label: 'ALWAYS' };
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return { unlocked: false, label: 'EXPIRED' };
    const hours = Math.ceil(remaining / (60 * 60 * 1000));
    if (hours < 24) return { unlocked: true, label: `${hours}h LEFT` };
    const days = Math.ceil(hours / 24);
    return { unlocked: true, label: `${days}d LEFT` };
  } catch {
    return { unlocked: true, label: duration.toUpperCase() };
  }
}

// ---------------------------------------------------------------------------
// Sidecar initialization — load signing key + registration from vault/settings
// ---------------------------------------------------------------------------

/**
 * Initialize marketplace signing for the sidecar (headless Node.js).
 * Loads the raw signing key from vault and registration state from settings.
 * Must be called once at sidecar boot, after Supabase is connected.
 */
export async function initSidecarSigning(): Promise<boolean> {
  const entry = await getVaultEntryByService('marketplace-signing');
  if (!entry) { console.warn('[Sidecar] No signing key in vault'); return false; }
  try {
    const data = JSON.parse(entry.key_value);
    sessionRawPrivateKey = data.rawPrivateKey;
    cachedKeyFileData = {
      publicKey: data.publicKey,
      publicKeyHash: data.publicKeyHash,
      encryptedPrivateKey: { encrypted: '', iv: '', salt: '' },
      createdAt: data.createdAt || entry.created_at,
    };
  } catch { return false; }

  const regId = await getSetting('marketplace_instance_id');
  const regNick = await getSetting('marketplace_nickname');
  if (regId) {
    cachedRegistrationState = {
      registered: true, instanceId: regId, nickname: regNick || 'Unknown',
    };
  }
  console.log('[Sidecar] Signing initialized, instance:', regId);
  return true;
}

/** localStorage key for marketplace registration state */
const REGISTRATION_KEY = 'jarvis-marketplace-registered';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketplaceStatus {
  registered: boolean;
  hasKey: boolean;
  instanceId: string | null;
  nickname: string | null;
  lastRegistered: string | null;
}

export interface RegisterResult {
  success: boolean;
  error?: string;
  instanceId?: string;
}

// ---------------------------------------------------------------------------
// Status checking
// ---------------------------------------------------------------------------

/**
 * Check marketplace registration status from local state.
 * Does NOT call the marketplace API — purely local check.
 */
export function getMarketplaceStatus(): MarketplaceStatus {
  if (typeof window === 'undefined') {
    // Sidecar path — use cached registration state
    return {
      registered: cachedRegistrationState?.registered ?? false,
      hasKey: cachedKeyFileData !== null,
      instanceId: cachedRegistrationState?.instanceId ?? null,
      nickname: cachedRegistrationState?.nickname ?? null,
      lastRegistered: null,
    };
  }

  const keyData = loadKeyFromLocalStorage();
  const regData = localStorage.getItem(REGISTRATION_KEY);

  let registered = false;
  let instanceId: string | null = null;
  let nickname: string | null = null;
  let lastRegistered: string | null = null;

  if (regData) {
    try {
      const parsed = JSON.parse(regData);
      registered = parsed.registered === true;
      instanceId = parsed.instanceId ?? null;
      nickname = parsed.nickname ?? null;
      lastRegistered = parsed.lastRegistered ?? null;
    } catch { /* corrupt data, treat as unregistered */ }
  }

  return {
    registered,
    hasKey: keyData !== null,
    instanceId,
    nickname,
    lastRegistered,
  };
}

// ---------------------------------------------------------------------------
// Registration (called from KeySetupStep with raw private key)
// ---------------------------------------------------------------------------

/**
 * Register this Jarvis instance on the marketplace.
 *
 * Called from KeySetupStep during Founder Ceremony, when the raw (unencrypted)
 * private key is available for signing. This is the only time we can sign
 * without prompting for the master password.
 *
 * @param rawPrivateKeyBase64 - Unencrypted Ed25519 private key (PKCS8, base64)
 * @param publicKeyBase64 - Raw Ed25519 public key (base64)
 */
export async function registerOnMarketplace(
  rawPrivateKeyBase64: string,
  publicKeyBase64: string,
): Promise<RegisterResult> {
  // Load founder/org info from DB
  let founderName: string;
  let orgName: string;
  let primaryMission: string;
  try {
    founderName = (await getSetting('founder_name')) ?? 'Unknown';
    orgName = (await getSetting('org_name')) ?? 'Jarvis Instance';
    primaryMission = (await getSetting('primary_mission')) ?? '';
  } catch {
    founderName = 'Unknown';
    orgName = 'Jarvis Instance';
    primaryMission = '';
  }

  // Gather enabled skills
  let featuredSkills: string[] = [];
  let skillNames: string[] = [];
  try {
    const skills = await loadSkills();
    const enabled = skills.filter(s => s.enabled);
    featuredSkills = enabled.map(s => s.id).slice(0, 20);
    skillNames = enabled.map(s => {
      const def = s.definition as Record<string, unknown> | null;
      return (def?.name as string) ?? s.id;
    });
  } catch { /* DB may not be ready */ }

  // Gather agents
  let agentNames: string[] = [];
  try {
    const agents = await loadAgents();
    agentNames = agents.map(a => a.name);
  } catch { /* ignore */ }

  // Build a writeup from real instance data
  const writeupParts: string[] = [];
  if (primaryMission) writeupParts.push(`Mission: ${primaryMission}`);
  if (skillNames.length > 0) writeupParts.push(`Skills: ${skillNames.join(', ')}`);
  if (agentNames.length > 0) writeupParts.push(`Agents: ${agentNames.join(', ')}`);
  const skillsWriteup = writeupParts.join('\n') || `${founderName}'s autonomous AI workforce`;

  // Build description
  const description = primaryMission
    ? `${primaryMission.substring(0, 180)}`
    : `${founderName}'s Jarvis instance — ${orgName}`;

  const timestamp = Date.now();

  // Build payload (without signature — added after signing)
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
  const payload: Record<string, unknown> = {
    nickname: `${orgName.substring(0, 19)}-${Math.random().toString(36).substring(2, 6)}`,
    description: description.substring(0, 200),
    avatar_color: '#50fa7b',
    avatar_icon: 'bot',
    avatar_border: '#ff79c6',
    featured_skills: featuredSkills,
    skills_writeup: skillsWriteup.substring(0, 1000),
    app_version: appVersion,
    public_key: publicKeyBase64,
    timestamp,
  };

  try {
    // Sign the payload with the raw Ed25519 private key
    const signature = await signPayload(rawPrivateKeyBase64, payload);
    payload.signature = signature;

    console.log('[Marketplace] Registering with', featuredSkills.length, 'skills,', agentNames.length, 'agents');

    const res = await fetch(`${MARKETPLACE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      const instanceId = data.instance?.id;

      // Save registration state locally
      if (typeof window !== 'undefined') {
        localStorage.setItem(REGISTRATION_KEY, JSON.stringify({
          registered: true,
          instanceId,
          nickname: payload.nickname,
          lastRegistered: new Date().toISOString(),
        }));
      }

      // Persist to settings so sidecar can read registration state
      setSetting('marketplace_registered', 'true').catch(err => console.warn('[Marketplace] Setting persist failed:', err));
      setSetting('marketplace_instance_id', instanceId).catch(err => console.warn('[Marketplace] Setting persist failed:', err));
      setSetting('marketplace_nickname', String(payload.nickname)).catch(err => console.warn('[Marketplace] Setting persist failed:', err));

      console.log('[Marketplace] Registered successfully:', instanceId);
      return { success: true, instanceId };
    } else {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      console.warn('[Marketplace] Registration failed:', err.error, err.debug ?? '');
      return { success: false, error: err.error };
    }
  } catch (err) {
    console.warn('[Marketplace] Registration request failed:', err);
    return { success: false, error: 'Network error — registration will retry later' };
  }
}

// ---------------------------------------------------------------------------
// Signed API calls (for submit_feature, vote, update_profile)
// ---------------------------------------------------------------------------

/**
 * Make a signed POST request to the marketplace API.
 * Requires a session-cached raw private key (from key generation or password entry).
 * Returns the response JSON or an error.
 */
export async function signedMarketplacePost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const keyData = loadKeyFromLocalStorage();
  if (!keyData) {
    return { success: false, error: 'No marketplace identity key found. Generate one at /key first.' };
  }

  const rawKey = getCachedRawPrivateKey();
  if (!rawKey) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('navigate-toast', {
        detail: { message: 'Session signing locked — unlock to use marketplace', path: '/key' },
      }));
    }
    return {
      success: false,
      error: 'Session signing is locked. Go to /key and click UNLOCK to enter your master password first.',
    };
  }

  const status = getMarketplaceStatus();
  const payload: Record<string, unknown> = {
    ...body,
    instance_id: status.instanceId,
    public_key: keyData.publicKey,
    timestamp: Date.now(),
  };

  try {
    const signature = await signPayload(rawKey, payload);
    payload.signature = signature;

    const res = await fetch(`${MARKETPLACE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({ error: 'Unknown error' }));
    if (res.ok) {
      return { success: true, data };
    } else {
      return { success: false, error: data.error || `Request failed (${res.status})` };
    }
  } catch (err) {
    return { success: false, error: 'Network error — marketplace may be unreachable' };
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/**
 * Send a heartbeat to the marketplace to keep the instance marked as online.
 * Fire-and-forget — works from both browser and sidecar.
 * Reads registration from DB settings if in-memory cache is empty.
 */
export async function sendHeartbeat(): Promise<void> {
  let instanceId: string | null = null;
  let publicKey: string | null = null;

  // Try in-memory / localStorage first
  const status = getMarketplaceStatus();
  if (status.registered && status.instanceId) {
    instanceId = status.instanceId;
    const keyData = loadKeyFromLocalStorage();
    publicKey = keyData?.publicKey ?? null;
  }

  // Fallback: read from DB settings (sidecar path where localStorage is unavailable)
  if (!instanceId) {
    try {
      const { getSetting } = await import('./database');
      instanceId = await getSetting('marketplace_instance_id');
    } catch { /* DB not available */ }
  }
  if (!publicKey) {
    try {
      const { getVaultEntryByService } = await import('./database');
      const entry = await getVaultEntryByService('marketplace_identity');
      if (entry?.data) {
        const data = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data;
        publicKey = data.publicKey ?? null;
      }
    } catch { /* vault not available */ }
  }

  if (!instanceId) return;

  try {
    await fetch(`${MARKETPLACE_URL}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instance_id: instanceId,
        public_key: publicKey || '',
        timestamp: Date.now(),
        signature: '',
      }),
    });
  } catch { /* silent — best effort */ }
}

// ---------------------------------------------------------------------------
// Peer Discovery (marketplace-based)
// ---------------------------------------------------------------------------

export interface MarketplacePeer {
  id: string;
  nickname: string;
  online: boolean;
  last_heartbeat: string;
  featured_skills: string[];
  local_ports: Record<string, number> | null;
  lan_hostname: string | null;
}

/**
 * Fetch peer instances that share the same public IP (same LAN/household).
 * Requires a signed request — the marketplace uses ip_hash to find peers.
 */
export async function fetchPeers(): Promise<{ success: boolean; peers?: MarketplacePeer[]; error?: string }> {
  const keyData = loadKeyFromLocalStorage();
  if (!keyData) return { success: false, error: 'No marketplace identity key found' };

  const rawKey = getCachedRawPrivateKey();
  if (!rawKey) return { success: false, error: 'Session signing is locked' };

  const status = getMarketplaceStatus();
  if (!status.registered || !status.instanceId) return { success: false, error: 'Not registered on marketplace' };

  const timestamp = Date.now();
  const payload: Record<string, unknown> = {
    instance_id: status.instanceId,
    public_key: keyData.publicKey,
    timestamp,
  };

  try {
    const signature = await signPayload(rawKey, payload);

    const params = new URLSearchParams({
      instance_id: status.instanceId,
      public_key: keyData.publicKey,
      timestamp: String(timestamp),
      signature,
    });

    const res = await fetch(`${MARKETPLACE_URL}/api/peers?${params.toString()}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      return { success: false, error: err.error || `Request failed (${res.status})` };
    }

    const data = await res.json();
    return { success: true, peers: data.peers || [] };
  } catch {
    return { success: false, error: 'Network error — marketplace may be unreachable' };
  }
}
