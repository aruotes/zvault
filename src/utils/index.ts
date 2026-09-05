/**
 * Pure utility helpers for ARUOTES ZVault.
 * No side effects, no imports from lib/crypto or lib/db.
 *
 * Phase 1: Basic helpers only.
 */

/**
 * Formats a byte count into a human-readable string.
 * @example formatBytes(1536) => "1.5 KB"
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Truncates an Ethereum address for display.
 * @example truncateAddress("0xAbCd...1234") => "0xAbCd...1234"
 */
export function truncateAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Converts an ArrayBuffer to a Base64-encoded string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64');
}

/**
 * Converts a Base64-encoded string back to an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = Buffer.from(base64, 'base64');
  return binary.buffer.slice(
    binary.byteOffset,
    binary.byteOffset + binary.byteLength,
  );
}
