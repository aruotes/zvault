const crypto = require('crypto').webcrypto;
global.crypto = crypto;
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
global.File = class File extends Blob { constructor(b, n, o) { super(b, o); this.name = n; } };

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH_BYTES = 12;

function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToUint8Array(base64) {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
async function importKey(keyBase64) {
  const rawKey = base64ToUint8Array(keyBase64);
  const rawBuffer = new ArrayBuffer(rawKey.byteLength);
  new Uint8Array(rawBuffer).set(rawKey);
  return crypto.subtle.importKey('raw', rawBuffer, { name: ALGORITHM, length: KEY_LENGTH }, false, ['encrypt', 'decrypt']);
}
async function generateAndExportKey() {
  const key = await crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_LENGTH }, true, ['encrypt', 'decrypt']);
  const rawKey = await crypto.subtle.exportKey('raw', key);
  return uint8ArrayToBase64(new Uint8Array(rawKey));
}
async function encryptFile(file, keyBase64) {
  const plaintext = await file.arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const cryptoKey = await importKey(keyBase64);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv: iv }, cryptoKey, plaintext);
  const combined = new Uint8Array(IV_LENGTH_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH_BYTES);
  return new Blob([combined], { type: 'application/octet-stream' });
}
async function decryptFile(encryptedBlob, keyBase64) {
  const combined = await encryptedBlob.arrayBuffer();
  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);
  const cryptoKey = await importKey(keyBase64);
  console.log('[ZVault Decrypt] Key byte length:', base64ToUint8Array(keyBase64).byteLength);
  console.log('[ZVault Decrypt] IV byte length:', iv.byteLength);
  console.log('[ZVault Decrypt] Ciphertext + Tag length:', ciphertext.byteLength);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv: new Uint8Array(iv) }, cryptoKey, ciphertext);
    return new Blob([plaintext], { type: 'application/octet-stream' });
  } catch (err) {
    throw err;
  }
}

async function run() {
  const key = await generateAndExportKey();
  const file = new File([new TextEncoder().encode("Hello World")], "test.txt", { type: "text/plain" });
  const enc = await encryptFile(file, key);
  
  // simulated upload/download mismatch?
  const dec = await decryptFile(enc, key);
  console.log("Decrypted text:", new TextDecoder().decode(await dec.arrayBuffer()));
}
run().catch(console.error);
