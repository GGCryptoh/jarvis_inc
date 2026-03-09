/**
 * Jarvis Key — Ed25519 keypair generation, encryption, signing
 *
 * Provides cryptographic identity for a Jarvis instance on the marketplace.
 * Uses Web Crypto API (browser-compatible, all async).
 *
 * Key format:
 *   - publicKey:  raw 32-byte Ed25519 public key, base64-encoded
 *   - privateKey: PKCS8 DER Ed25519 private key, base64-encoded
 *   - publicKeyHash: SHA-256 hex digest of the raw public key bytes (instance ID)
 *
 * Encryption:
 *   - PBKDF2 (600 000 iterations, SHA-256) derives AES-256-GCM key from master password
 *   - AES-256-GCM encrypts the private key with random IV and salt
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default filename for on-disk key storage (future gateway write) */
export const KEY_FILE_NAME = '.jarvis-key';

/** localStorage key for the key bundle */
export const LOCAL_STORAGE_KEY = 'jarvis-instance-key';

/** PBKDF2 iteration count — OWASP 2023 recommendation for SHA-256 */
const PBKDF2_ITERATIONS = 600_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeyPair {
  /** Raw 32-byte Ed25519 public key, base64 */
  publicKey: string;
  /** PKCS8 DER Ed25519 private key, base64 */
  privateKey: string;
  /** SHA-256 hex digest of the raw public key — serves as the instance ID */
  publicKeyHash: string;
}

export interface EncryptedBundle {
  /** AES-256-GCM ciphertext, base64 */
  encrypted: string;
  /** 12-byte IV, base64 */
  iv: string;
  /** 32-byte PBKDF2 salt, base64 */
  salt: string;
}

export interface KeyFileData {
  publicKey: string;
  publicKeyHash: string;
  encryptedPrivateKey: EncryptedBundle;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a new Ed25519 keypair.
 *
 * Returns the public key (raw, base64), private key (PKCS8, base64),
 * and a SHA-256 hex hash of the public key that serves as the instance ID.
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' } as EcKeyGenParams,
    true, // extractable
    ['sign', 'verify'],
  );

  // Export raw public key (32 bytes)
  const rawPublicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);

  // Export PKCS8 private key
  const pkcs8PrivateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  // SHA-256 hash of raw public key → hex string (instance ID)
  const hashBuffer = await crypto.subtle.digest('SHA-256', rawPublicKey);

  return {
    publicKey: bufferToBase64(rawPublicKey),
    privateKey: bufferToBase64(pkcs8PrivateKey),
    publicKeyHash: bufferToHex(hashBuffer),
  };
}

// ---------------------------------------------------------------------------
// Password-based encryption (PBKDF2 + AES-256-GCM)
// ---------------------------------------------------------------------------

/**
 * Derive an AES-256-GCM CryptoKey from a master password using PBKDF2.
 */
async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a base64-encoded private key with a master password.
 *
 * Uses PBKDF2 (600k iterations) to derive an AES-256-GCM key,
 * then encrypts the private key bytes. The returned bundle contains
 * everything needed for decryption except the password.
 */
export async function encryptPrivateKey(
  privateKeyBase64: string,
  masterPassword: string,
): Promise<EncryptedBundle> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const aesKey = await deriveAesKey(masterPassword, salt);

  const plaintext = base64ToBuffer(privateKeyBase64);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintext,
  );

  // AES-GCM appends the 16-byte auth tag to the ciphertext automatically
  return {
    encrypted: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv.buffer),
    salt: bufferToBase64(salt.buffer),
  };
}

/**
 * Decrypt an encrypted private key bundle with the master password.
 *
 * Returns the base64-encoded PKCS8 private key.
 * Throws if the password is wrong or data has been tampered with.
 */
export async function decryptPrivateKey(
  bundle: EncryptedBundle,
  masterPassword: string,
): Promise<string> {
  const salt = new Uint8Array(base64ToBuffer(bundle.salt));
  const iv = new Uint8Array(base64ToBuffer(bundle.iv));
  const ciphertext = base64ToBuffer(bundle.encrypted);

  const aesKey = await deriveAesKey(masterPassword, salt);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext,
  );

  return bufferToBase64(plaintext);
}

// ---------------------------------------------------------------------------
// Payload signing
// ---------------------------------------------------------------------------

/**
 * Sign a JSON payload with the Ed25519 private key.
 *
 * The payload is canonicalized: keys sorted, 'signature' key excluded,
 * then JSON.stringify'd. The signature is returned as a base64 string.
 */
export async function signPayload(
  privateKeyBase64: string,
  data: Record<string, unknown>,
): Promise<string> {
  // Build canonical JSON (exclude 'signature', sort keys)
  const filtered: Record<string, unknown> = {};
  const keys = Object.keys(data).filter((k) => k !== 'signature').sort();
  for (const key of keys) {
    filtered[key] = data[key];
  }
  const canonical = JSON.stringify(filtered);
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(canonical);

  // Import the PKCS8 private key
  const pkcs8 = base64ToBuffer(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' } as EcKeyImportParams,
    false,
    ['sign'],
  );

  // Sign
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' } as EcdsaParams,
    privateKey,
    dataBytes,
  );

  return bufferToBase64(signature);
}

// ---------------------------------------------------------------------------
// Local storage persistence
// ---------------------------------------------------------------------------

/**
 * Save the key file data to localStorage.
 */
export function saveKeyToLocalStorage(data: KeyFileData): void {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
}

/**
 * Load the key file data from localStorage. Returns null if not found.
 */
export function loadKeyFromLocalStorage(): KeyFileData | null {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as KeyFileData;
  } catch {
    return null;
  }
}

/**
 * Check whether a Jarvis instance key exists in localStorage.
 */
export function hasInstanceKey(): boolean {
  return localStorage.getItem(LOCAL_STORAGE_KEY) !== null;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of the key file as `.jarvis-key`.
 */
export function downloadKeyFile(data: KeyFileData): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = KEY_FILE_NAME;
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
