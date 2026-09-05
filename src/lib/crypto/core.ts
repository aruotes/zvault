/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ZVault — AES-256-GCM Core Cryptography Module
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️  CLIENT-ONLY MODULE
 * This file imports `client-only` to enforce at build time that this module
 * can only run inside the browser. Any attempt to import it from a Server
 * Component, Route Handler, or Server Action will throw a compile-time error,
 * preventing key material from ever existing in the server process.
 *
 * Algorithm: AES-GCM, 256-bit key, 12-byte (96-bit) IV.
 *
 * IV Strategy:
 *   - A fresh 12-byte IV is generated via `crypto.getRandomValues()` for
 *     every single encryption operation.
 *   - The IV is prepended to the ciphertext bytes before returning the Blob:
 *
 *       [ IV (12 bytes) | Ciphertext (N bytes) ]
 *
 *   - On decryption, the first 12 bytes of the Blob are sliced off as the IV,
 *     and the remainder is treated as ciphertext.
 *   - AES-GCM appends a 16-byte authentication tag to the ciphertext, so the
 *     returned plaintext is always (N - 16) bytes shorter than the ciphertext.
 *
 * Key Storage Policy:
 *   - The raw key is NEVER stored in localStorage, sessionStorage, cookies,
 *     or React state that persists beyond a single transaction.
 *   - The key is exported as a Base64 string only for the user to download as
 *     a file (`secret.key`). It lives in memory only for the duration of the
 *     encrypt/decrypt call.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use client';
import 'client-only';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALGORITHM = 'AES-GCM' as const;
const KEY_LENGTH = 256 as const;
const IV_LENGTH_BYTES = 12 as const; // 96-bit IV — recommended for AES-GCM

// ── Internal Utilities ────────────────────────────────────────────────────────

/**
 * Converts a Uint8Array to a URL-safe Base64 string.
 * Used internally to export the raw key bytes.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a Base64 string back to a Uint8Array.
 * Used internally to import a raw key from a `.key` file.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Imports a raw Base64 key string as a Web Crypto CryptoKey.
 * The key is imported as non-extractable for operations to minimise
 * the window during which key material is held as a CryptoKey object.
 */
async function importKey(keyBase64: string): Promise<{ cryptoKey: CryptoKey; rawBuffer: ArrayBuffer }> {
  const rawKey = base64ToUint8Array(keyBase64);
  const rawBuffer = new ArrayBuffer(rawKey.byteLength);
  new Uint8Array(rawBuffer).set(rawKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawBuffer,
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // non-extractable once imported for use
    ['encrypt', 'decrypt'],
  );
  return { cryptoKey, rawBuffer };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates a new AES-256-GCM key, exports it as a Base64 string,
 * and returns it for the user to download as `secret.key`.
 *
 * The key is marked `extractable: true` ONLY to allow this one-time export.
 * After export the raw bytes are held in memory only for the duration of
 * this function call.
 */
export async function generateAndExportKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable — needed for the one-time raw export below
    ['encrypt', 'decrypt'],
  );

  const rawKey = await crypto.subtle.exportKey('raw', key);
  return uint8ArrayToBase64(new Uint8Array(rawKey));
}

/**
 * Encrypts a File using AES-256-GCM.
 *
 * IV layout of returned Blob:
 *   Bytes 0–11  : IV (12 bytes, generated fresh via crypto.getRandomValues)
 *   Bytes 12–N  : AES-GCM ciphertext (plaintext length + 16-byte auth tag)
 *
 * @param file      - The original File object chosen by the user.
 * @param keyBase64 - The Base64-encoded raw AES-256 key string.
 * @returns         - A Blob containing [IV ‖ ciphertext], MIME type
 *                   `application/octet-stream`.
 */
export async function encryptFile(
  file: File,
  keyBase64: string,
): Promise<Blob> {
  // 1. Read the file into an ArrayBuffer
  const plaintext = await file.arrayBuffer();

  // 2. Generate a fresh, cryptographically secure 12-byte IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

  // 3. Import the key and encrypt
  const { cryptoKey } = await importKey(keyBase64);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as Uint8Array<ArrayBuffer> },
    cryptoKey,
    plaintext,
  );

  // 4. Prepend the IV to the ciphertext using the Blob constructor
  // [ IV (12 B) | ciphertext (N B) ]
  return new Blob([iv, ciphertext], { type: 'application/octet-stream' });
}

/**
 * Decrypts an encrypted Blob produced by `encryptFile()`.
 *
 * IV extraction:
 *   The first 12 bytes of the Blob are sliced as the IV.
 *   The remaining bytes are the ciphertext passed to `crypto.subtle.decrypt`.
 *
 * @param encryptedBlob - The Blob containing [IV ‖ ciphertext].
 * @param keyBase64     - The Base64-encoded raw AES-256 key string.
 * @param mimeType      - MIME type to apply to the returned plaintext Blob.
 * @returns             - A Blob of the original plaintext.
 * @throws              - Rethrows a typed `Error` with a user-readable message
 *                        if the key is wrong or the file is corrupted
 *                        (`OperationError` from the Web Crypto API).
 */
export async function decryptFile(
  encryptedBlob: Blob,
  keyBase64: string,
  mimeType = 'application/octet-stream',
): Promise<Blob> {
  const combined = await encryptedBlob.arrayBuffer();

  // Guard: Blob must be longer than the IV alone
  if (combined.byteLength <= IV_LENGTH_BYTES) {
    throw new Error('Invalid encrypted file: too short to contain a valid IV.');
  }

  // 1. Extract IV — first 12 bytes (slice to own ArrayBuffer for type safety)
  const iv = combined.slice(0, IV_LENGTH_BYTES);

  // 2. Extract ciphertext — everything after the IV (slice to own ArrayBuffer)
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  // 3. Import the key and decrypt
  const { cryptoKey, rawBuffer: importedKeyBuffer } = await importKey(keyBase64);

  console.log('[ZVault Decrypt] Key byte length:', importedKeyBuffer.byteLength);
  console.log('[ZVault Decrypt] IV byte length:', iv.byteLength);
  console.log('[ZVault Decrypt] Ciphertext + Tag length:', ciphertext.byteLength);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: new Uint8Array(iv) },
      cryptoKey,
      ciphertext,
    );
  } catch (err) {
    const isOperationError =
      err instanceof DOMException && err.name === 'OperationError';
    
    if (isOperationError) {
      console.error('[ZVault Decrypt] Auth tag verification failed. Diagnostic: Key or file mismatch. IV length:', iv.byteLength, 'Ciphertext length:', ciphertext.byteLength);
    }

    throw new Error(
      isOperationError
        ? 'Decryption failed: incorrect key or corrupted file. Please use the exact key that was generated for this file.'
        : `Decryption failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return new Blob([plaintext], { type: mimeType });
}

/**
 * Decrypts an encrypted Blob using an already-imported AES-256-GCM CryptoKey.
 *
 * This is the shared-access decryption path: the caller holds a CryptoKey
 * that was unwrapped from the ECDH key-agreement (via `unwrapKeyForSelf`),
 * so it cannot be exported back to Base64 without re-marking as extractable.
 * We therefore call `crypto.subtle.decrypt` directly with the key object.
 *
 * IV layout is identical to `decryptFile` — first 12 bytes of the Blob.
 *
 * @param encryptedBlob - The Blob containing [IV ‖ ciphertext].
 * @param cryptoKey     - The non-extractable AES-256-GCM CryptoKey.
 * @param mimeType      - MIME type to apply to the returned plaintext Blob.
 * @returns             - A Blob of the original plaintext.
 */
export async function decryptFileWithKey(
  encryptedBlob: Blob,
  cryptoKey: CryptoKey,
  mimeType = 'application/octet-stream',
): Promise<Blob> {
  const combined = await encryptedBlob.arrayBuffer();

  if (combined.byteLength <= IV_LENGTH_BYTES) {
    throw new Error('Invalid encrypted file: too short to contain a valid IV.');
  }

  const iv         = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: new Uint8Array(iv) },
      cryptoKey,
      ciphertext,
    );
  } catch (err) {
    const isOperationError =
      err instanceof DOMException && err.name === 'OperationError';
    throw new Error(
      isOperationError
        ? 'Decryption failed: incorrect key or corrupted file.'
        : `Decryption failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return new Blob([plaintext], { type: mimeType });
}

