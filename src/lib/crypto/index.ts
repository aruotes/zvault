/**
 * ⚠️  CLIENT-ONLY MODULE — CRYPTOGRAPHIC OPERATIONS
 *
 * This file imports `client-only` to enforce that no code within `src/lib/crypto`
 * can ever be executed on the server (e.g., in Server Components, Route Handlers,
 * or Server Actions). Attempting to import this module from a server context will
 * throw a build-time error, preventing accidental key material leakage.
 *
 * Implementation: see `./core.ts` for the AES-256-GCM functions.
 */
import 'client-only';

export { generateAndExportKey, encryptFile, decryptFile } from './core';
