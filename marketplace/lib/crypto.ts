import { createHash, createPublicKey, verify } from 'crypto';

/**
 * Generate instance ID from repo URL (deterministic)
 */
export function instanceIdFromRepo(repoUrl: string): string {
  return createHash('sha256').update(repoUrl.toLowerCase().trim()).digest('hex');
}

/**
 * Hash an IP address for rate limiting (we never store raw IPs)
 */
export function hashIP(ip: string): string {
  return createHash('sha256').update(ip + '_jarvis_salt_2026').digest('hex');
}

/**
 * Verify an Ed25519 signature against a public key.
 *
 * Public key comes as raw 32 bytes (base64). We wrap it in an SPKI DER
 * envelope so Node.js crypto can parse it.
 */
export function verifySignature(
  publicKeyBase64: string,
  signature: string,
  data: string
): boolean {
  try {
    const publicKeyDer = Buffer.from(publicKeyBase64, 'base64');
    // Ed25519 raw public keys are 32 bytes — wrap in SPKI DER envelope
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiDer = Buffer.concat([spkiPrefix, publicKeyDer]);

    // Create a proper KeyObject from the SPKI DER
    const keyObject = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });

    return verify(
      null, // Ed25519 doesn't use a separate hash algorithm
      Buffer.from(data, 'utf-8'),
      keyObject,
      Buffer.from(signature, 'base64')
    );
  } catch (err) {
    console.error('[crypto] verifySignature error:', err);
    return false;
  }
}

/**
 * Build the canonical string to sign from a payload
 * Excludes the signature field itself
 */
export function buildSignatureData(payload: Record<string, unknown>): string {
  const { signature, ...rest } = payload;
  // Sort keys for deterministic signing
  const sorted = Object.keys(rest)
    .sort()
    .reduce((acc, key) => {
      acc[key] = rest[key];
      return acc;
    }, {} as Record<string, unknown>);
  return JSON.stringify(sorted);
}

/**
 * Validate timestamp is within 5 minutes (anti-replay)
 */
export function isTimestampValid(timestamp: number): boolean {
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;
  return Math.abs(now - timestamp) < fiveMinutes;
}
