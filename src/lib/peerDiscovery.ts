/**
 * Peer Discovery — mDNS/Bonjour LAN discovery
 * =============================================
 * Advertises this Jarvis instance on the local network via mDNS (_jarvis._tcp)
 * and discovers other instances. Runs on the Vite dev server host.
 */

import type Bonjour from 'bonjour-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LANPeer {
  id: string;
  nickname: string;
  host: string;
  kongPort: number;
  gatewayPort: number;
  version: string;
  discoveredAt: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let bonjourInstance: Bonjour | null = null;
let browser: ReturnType<Bonjour['find']> | null = null;
const discoveredPeers = new Map<string, LANPeer>();
let advertiseConfig: {
  instanceId: string;
  nickname: string;
  kongPort: number;
  gatewayPort: number;
  version: string;
} | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start advertising this instance and discovering peers on the LAN.
 * Call once at Vite dev server startup.
 */
export async function startPeerDiscovery(config: {
  instanceId: string;
  nickname: string;
  kongPort: number;
  gatewayPort: number;
  version: string;
  devPort?: number;
}): Promise<void> {
  // Dynamic import — bonjour-service is a Node.js-only module
  const { Bonjour } = await import('bonjour-service');
  bonjourInstance = new Bonjour();
  advertiseConfig = config;

  // Advertise our service
  const txtRecord: Record<string, string> = {
    id: config.instanceId,
    nick: config.nickname.substring(0, 24),
    kong: String(config.kongPort),
    gw: String(config.gatewayPort),
    ver: config.version,
  };

  bonjourInstance.publish({
    name: `jarvis-${config.instanceId.substring(0, 8)}`,
    type: 'jarvis',
    port: config.devPort ?? 5173,
    txt: txtRecord,
  });

  console.log(`[PeerDiscovery] Advertising _jarvis._tcp (${config.nickname})`);

  // Browse for other Jarvis instances
  browser = bonjourInstance.find({ type: 'jarvis' }, (service) => {
    const txt = service.txt as Record<string, string> || {};
    const peerId = txt.id;
    if (!peerId || peerId === config.instanceId) return; // skip self

    const peer: LANPeer = {
      id: peerId,
      nickname: txt.nick || 'Unknown',
      host: service.host || service.referer?.address || 'unknown',
      kongPort: parseInt(txt.kong || '8000', 10),
      gatewayPort: parseInt(txt.gw || '3001', 10),
      version: txt.ver || '0.0.0',
      discoveredAt: Date.now(),
    };

    const isNew = !discoveredPeers.has(peerId);
    discoveredPeers.set(peerId, peer);
    if (isNew) {
      console.log(`[PeerDiscovery] Found peer: ${peer.nickname} @ ${peer.host}:${peer.kongPort}`);
    }
  });
}

/**
 * Stop advertising and browsing.
 * Call on Vite dev server shutdown.
 */
export function stopPeerDiscovery(): void {
  if (browser) {
    browser.stop();
    browser = null;
  }
  if (bonjourInstance) {
    bonjourInstance.unpublishAll();
    bonjourInstance.destroy();
    bonjourInstance = null;
  }
  discoveredPeers.clear();
  console.log('[PeerDiscovery] Stopped');
}

/**
 * Get all currently discovered LAN peers.
 * Filters out stale peers (not seen in 5 minutes).
 */
export function getLANPeers(): LANPeer[] {
  const staleThreshold = Date.now() - 5 * 60 * 1000;
  const peers: LANPeer[] = [];
  for (const [id, peer] of discoveredPeers) {
    if (peer.discoveredAt < staleThreshold) {
      discoveredPeers.delete(id);
    } else {
      peers.push(peer);
    }
  }
  return peers;
}
