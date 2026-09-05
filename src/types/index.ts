/**
 * Shared TypeScript type definitions for ARUOTES ZVault.
 *
 * Phase 1: Placeholder only.
 * Phase 2+: Add domain types as the application grows.
 */

// ── File Metadata ────────────────────────────────────────────────────────────

/** Represents a file stored in ZVault. */
export interface VaultFile {
  /** MongoDB ObjectId as string */
  id: string;
  /** Original filename before encryption */
  name: string;
  /** MIME type of the original file */
  mimeType: string;
  /** Size in bytes of the original (unencrypted) file */
  sizeBytes: number;
  /** IPFS CID of the encrypted ciphertext */
  cid: string;
  /** Ethereum address of the file owner */
  ownerAddress: string;
  /** ISO 8601 timestamp of upload */
  uploadedAt: string;
}

// ── Encryption Metadata ──────────────────────────────────────────────────────

/** AES-256-GCM encryption parameters stored alongside the CID. */
export interface EncryptionMetadata {
  /** Base64-encoded 12-byte initialization vector */
  iv: string;
  /** AES-GCM key algorithm descriptor */
  algorithm: 'AES-GCM';
  /** Key length in bits */
  keyLength: 256;
}

// ── API Responses ─────────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
