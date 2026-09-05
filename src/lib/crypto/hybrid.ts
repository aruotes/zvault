/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ZVault — Hybrid PKI Cryptography Engine (ECIES-lite)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️  CLIENT-ONLY MODULE
 * Enforced via `client-only` import — this module never runs on the server.
 *
 * ──────────────────────────────────────────────
 * ARCHITECTURE: ECIES-lite key wrapping scheme
 * ──────────────────────────────────────────────
 *
 *  ENCRYPT (wrapKeyForRecipient):
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │ 1. Generate ephemeral P-256 ECDH keypair (alice_eph)          │
 *  │ 2. ECDH(alice_eph.private, recipient_static.public)           │
 *  │    → shared_secret (raw bytes)                               │
 *  │ 3. SHA-256(shared_secret) → 256-bit wrapping key (AES-KW)    │
 *  │ 4. AES-KW wrap(raw_aes_key) → wrapped_key_bytes (40 bytes)   │
 *  │ 5. Export alice_eph.public → Base64                           │
 *  │ 6. Return { wrappedKey: Uint8Array, ephPublicKey: string }    │
 *  └──────────────────────────────────────────────────────────────┘
 *
 *  DECRYPT (unwrapKeyForSelf):
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │ 1. Load recipient_static.private from IndexedDB              │
 *  │ 2. Import alice_eph.public from Base64                        │
 *  │ 3. ECDH(recipient_static.private, alice_eph.public)           │
 *  │    → shared_secret (same bits as during encryption)          │
 *  │ 4. SHA-256(shared_secret) → same 256-bit AES-KW key          │
 *  │ 5. AES-KW unwrap(wrapped_key_bytes) → AES-GCM CryptoKey      │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────
 * WHY EPHEMERAL-STATIC (not static-static)?
 * ─────────────────────────────────
 * Static-static ECDH requires Alice's static private key to be used for
 * every file share, which:
 *   a) Requires Alice to be online / have her key accessible at share time.
 *   b) Means a compromised static key decrypts ALL past shares (no forward
 *      secrecy for the key-wrapping layer).
 * Ephemeral-static (ECIES) solves both: Alice generates a throwaway keypair
 * per share operation. Only Bob's static public key is needed.
 *
 * ─────────────────
 * EPHEMERAL KEY BUNDLING:
 * ─────────────────
 * The payload returned by wrapKeyForRecipient is:
 *   { wrappedKey: Uint8Array (40 bytes), ephPublicKey: string (Base64 JWK) }
 *
 * Both MUST be stored together (e.g., as a JSON object in the AccessGranted
 * event on-chain, or in a separate off-chain DB record). Without the ephemeral
 * public key, the wrapped key cannot be derived / unwrapped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use client';
import 'client-only';

// ── Constants ─────────────────────────────────────────────────────────────────

const IDB_DB_NAME    = 'zvault-keys';
const IDB_STORE_NAME = 'ecdh-private-keys';
const IDB_KEY_ID     = 'user-static-private-key';
const ECDH_ALGO      = { name: 'ECDH', namedCurve: 'P-256' } as const;
const HASH_ALGO      = 'SHA-256' as const;

// ── IndexedDB Helpers ─────────────────────────────────────────────────────────

/**
 * Opens (or upgrades) the ZVault IndexedDB database.
 * Returns a promise that resolves to the IDBDatabase instance.
 */
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };

    req.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    req.onerror = (event) => {
      reject(new Error(`IndexedDB open failed: ${(event.target as IDBOpenDBRequest).error?.message ?? 'unknown error'}`));
    };
  });
}

/**
 * Retrieves a value from the IndexedDB key store.
 * Returns `undefined` if the key does not exist.
 */
function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req   = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror   = () => reject(new Error(`IndexedDB get("${key}") failed: ${req.error?.message ?? 'unknown'}`));
  });
}

/**
 * Writes a value to the IndexedDB key store.
 */
function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    const req   = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(new Error(`IndexedDB put("${key}") failed: ${req.error?.message ?? 'unknown'}`));
  });
}

// ── Utility: Base64 ↔ Uint8Array ─────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64.trim());
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Internal: ECDH shared-secret → AES-KW CryptoKey ─────────────────────────

/**
 * Derives an AES-256 key-wrapping key from two ECDH parties.
 *
 * Steps:
 *   1. ECDH derive → 32-byte shared secret bits.
 *   2. SHA-256(shared_secret) → 32-byte digest (ensures uniform distribution
 *      and prevents any structure in the raw ECDH output leaking into the key).
 *   3. Import digest as AES-KW key.
 *
 * The SHA-256 step takes the place of a full HKDF for simplicity; it is
 * sufficient here because the ECDH output is already a high-entropy secret.
 */
async function deriveAesKwKey(
  privateKey: CryptoKey,
  publicKey:  CryptoKey,
): Promise<CryptoKey> {
  // Step 1: ECDH derivation — produces raw shared secret bytes
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );

  // Step 2: Hash for key material uniformity
  const digest = await crypto.subtle.digest(HASH_ALGO, sharedBits);

  // Step 3: Import as AES-KW key (non-extractable)
  const buf = new ArrayBuffer(32);
  new Uint8Array(buf).set(new Uint8Array(digest));
  return crypto.subtle.importKey(
    'raw',
    buf,
    { name: 'AES-KW' },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates a static P-256 ECDH keypair for the current user.
 *
 * - The PRIVATE key is generated with `extractable: false` and stored in
 *   IndexedDB. It NEVER leaves the browser.
 * - The PUBLIC key is exported as a JWK JSON string and returned so it can
 *   be published to the ZVault key registry (POST /api/users/keys).
 *
 * If a key already exists in IndexedDB, this function is a no-op and returns
 * the existing public key.
 *
 * @returns The JWK-encoded P-256 public key as a JSON string.
 */
export async function generateAndStoreUserKeyPair(): Promise<string> {
  const db = await openIDB();

  // Check if we already have a stored private key
  const existing = await idbGet<CryptoKey>(db, IDB_KEY_ID);
  if (existing) {
    // Derive and return the public key from an existing keypair stored in IDB.
    // Because we only store the private key (non-extractable), we need to
    // re-export the public key from a paired key stored alongside it.
    const existingPub = await idbGet<CryptoKey>(db, `${IDB_KEY_ID}-pub`);
    if (existingPub) {
      const jwk = await crypto.subtle.exportKey('jwk', existingPub);
      return JSON.stringify(jwk);
    }
  }

  // Generate a new keypair — private key is non-extractable for security.
  const keyPair = await crypto.subtle.generateKey(
    ECDH_ALGO,
    false, // extractable: false — private key NEVER leaves the browser
    ['deriveBits'],
  );

  // Store private key in IndexedDB (non-extractable — safe to persist)
  await idbPut(db, IDB_KEY_ID, keyPair.privateKey);
  // Store public key separately so we can export/re-export it
  await idbPut(db, `${IDB_KEY_ID}-pub`, keyPair.publicKey);

  // Export public key as JWK — this is safe to publish
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return JSON.stringify(jwk);
}

/**
 * Retrieves the static private key from IndexedDB.
 * Throws if no key exists — caller must ensure `generateAndStoreUserKeyPair`
 * was called first.
 */
async function loadPrivateKey(): Promise<CryptoKey> {
  const db  = await openIDB();
  const key = await idbGet<CryptoKey>(db, IDB_KEY_ID);
  if (!key) {
    throw new Error(
      'No static ECDH private key found in IndexedDB. ' +
      'Call generateAndStoreUserKeyPair() first.',
    );
  }
  return key;
}

/**
 * Imports a P-256 ECDH public key from a JWK JSON string.
 * Used both for the recipient's static key and ephemeral keys.
 */
async function importEcdhPublicKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString) as JsonWebKey;
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    ECDH_ALGO,
    true, // public keys can be extractable
    [],   // no usages — public keys are used as the 'public' param in deriveBits
  );
}

// ── Exported Payload Types ────────────────────────────────────────────────────

/**
 * The result of wrapKeyForRecipient.
 *
 * BOTH fields must be stored together. The ephemeralPublicKey is essential
 * for the recipient to perform the same ECDH derivation during unwrap.
 *
 * Storage recommendation:
 *   - Serialize as: { wrappedKey: base64, ephPublicKey: string }
 *   - Pass the entire object as the `encryptedKey` payload in the
 *     FileRegistry.grantAccess() event.
 */
export interface WrappedKeyPayload {
  /** AES-256-GCM key wrapped with AES-KW — always 40 bytes for a 256-bit key */
  wrappedKey:       Uint8Array;
  /** The ephemeral P-256 ECDH public key (JWK JSON string) used during wrapping */
  ephemeralPublicKey: string;
}

/**
 * Wraps a raw AES-256-GCM file key for a specific recipient using ECIES-lite.
 *
 * The recipient's static public key (from the ZVault key registry) is combined
 * with a freshly generated ephemeral keypair. Only the recipient, holding their
 * static private key in IndexedDB, can derive the same shared secret and unwrap.
 *
 * @param rawAesKey            - The AES-GCM CryptoKey to wrap (extractable: true).
 * @param recipientPublicKeyJwk - The recipient's P-256 ECDH public key (JWK JSON string).
 * @returns A WrappedKeyPayload containing wrappedKey bytes + ephemeralPublicKey.
 */
export async function wrapKeyForRecipient(
  rawAesKey:               CryptoKey,
  recipientPublicKeyJwk:   string,
): Promise<WrappedKeyPayload> {
  // 1. Generate an ephemeral keypair — throwaway, never stored
  const ephKeyPair = await crypto.subtle.generateKey(
    ECDH_ALGO,
    true, // extractable: true — we need to export the public half for the payload
    ['deriveBits'],
  );

  // 2. Import recipient's static public key
  const recipientPub = await importEcdhPublicKey(recipientPublicKeyJwk);

  // 3. Derive AES-KW key from ephemeral private + recipient static public
  const aesKwKey = await deriveAesKwKey(ephKeyPair.privateKey, recipientPub);

  // 4. Wrap the AES-GCM file key using AES-KW
  // AES-KW of a 256-bit key produces 40 bytes (RFC 3394: 8 bytes header + key).
  const wrappedKeyBuffer = await crypto.subtle.wrapKey(
    'raw',
    rawAesKey,
    aesKwKey,
    'AES-KW',
  );
  const wrappedKey = new Uint8Array(wrappedKeyBuffer);

  // 5. Export the ephemeral PUBLIC key — needed by the recipient to unwrap
  const ephPubJwk = await crypto.subtle.exportKey('jwk', ephKeyPair.publicKey);

  return {
    wrappedKey,
    ephemeralPublicKey: JSON.stringify(ephPubJwk),
  };
}

/**
 * Unwraps a wrapped AES-256-GCM file key using the current user's static
 * ECDH private key from IndexedDB.
 *
 * The ephemeral public key (from the WrappedKeyPayload) reconstructs the
 * same shared secret that was used during wrapping, without any interaction
 * with the sender.
 *
 * @param wrappedKey            - The 40-byte wrapped key bytes.
 * @param ephemeralPublicKeyJwk - The ephemeral P-256 public key (JWK JSON string).
 * @returns The unwrapped AES-256-GCM CryptoKey, ready for decryption.
 */
export async function unwrapKeyForSelf(
  wrappedKey:             Uint8Array,
  ephemeralPublicKeyJwk:  string,
): Promise<CryptoKey> {
  // 1. Load the user's static private key from IndexedDB
  const staticPrivateKey = await loadPrivateKey();

  // 2. Import the sender's ephemeral public key
  const ephPub = await importEcdhPublicKey(ephemeralPublicKeyJwk);

  // 3. Derive the same AES-KW key (static private + ephemeral public → same shared secret)
  const aesKwKey = await deriveAesKwKey(staticPrivateKey, ephPub);

  // 4. Ensure wrappedKey is in its own ArrayBuffer for type safety
  const wrappedBuf = new ArrayBuffer(wrappedKey.byteLength);
  new Uint8Array(wrappedBuf).set(wrappedKey);

  // 5. Unwrap → returns the original AES-256-GCM CryptoKey
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedBuf,
    aesKwKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable once unwrapped
    ['encrypt', 'decrypt'],
  );
}

// ── Utilities for Serialization ───────────────────────────────────────────────

/**
 * Serializes a WrappedKeyPayload to a JSON string for storage in the
 * FileRegistry smart contract event or MongoDB.
 *
 * Format: { "wrappedKey": "<base64>", "ephemeralPublicKey": "<JWK JSON>" }
 */
export function serializeWrappedPayload(payload: WrappedKeyPayload): string {
  return JSON.stringify({
    wrappedKey:         uint8ToBase64(payload.wrappedKey),
    ephemeralPublicKey: payload.ephemeralPublicKey,
  });
}

/**
 * Deserializes a JSON string back to a WrappedKeyPayload.
 * Use before calling `unwrapKeyForSelf`.
 */
export function deserializeWrappedPayload(json: string): WrappedKeyPayload {
  const raw = JSON.parse(json) as { wrappedKey: string; ephemeralPublicKey: string };
  return {
    wrappedKey:         base64ToUint8(raw.wrappedKey),
    ephemeralPublicKey: raw.ephemeralPublicKey,
  };
}

// ── Public key registry helpers ───────────────────────────────────────────────

/**
 * Publishes the current user's public key to the ZVault key registry.
 * Called automatically after wallet connection + key generation.
 */
export async function publishPublicKey(
  walletAddress: string,
  publicKeyJwk:  string,
): Promise<void> {
  const res = await fetch('/api/users/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, publicKey: publicKeyJwk }),
  });
  if (!res.ok) {
    const err = await res.json() as { error?: string };
    throw new Error(err.error ?? 'Failed to publish public key.');
  }
}

/**
 * Fetches a recipient's public key from the ZVault key registry.
 * Returns null if the recipient has not registered their key yet.
 */
export async function fetchRecipientPublicKey(
  walletAddress: string,
): Promise<string | null> {
  const res = await fetch(`/api/users/keys?address=${encodeURIComponent(walletAddress)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch recipient public key.');
  const data = await res.json() as { publicKey: string };
  return data.publicKey;
}
