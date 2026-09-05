/**
 * SERVER-SIDE ENVIRONMENT VALIDATION
 *
 * Validates all secret/privileged environment variables using Zod.
 * This module MUST only be imported from server-side code (Server Components,
 * Route Handlers, Server Actions). Do NOT import in Client Components.
 *
 * Validation is lazy — it runs on first property access, not at module load time.
 * This allows `npm run build` to succeed without a .env.local file, while still
 * throwing descriptive errors at runtime if any variable is missing or malformed.
 */
import 'server-only';
import { z } from 'zod';

const serverEnvSchema = z.object({
  /**
   * MongoDB connection string.
   * Format: mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<db>
   */
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required')
    .refine(
      (val) => val.startsWith('mongodb'),
      'MONGODB_URI must start with "mongodb"',
    ),

  /**
   * Pinata JWT token for authenticated IPFS pinning via the Pinata API.
   * Obtain from: https://app.pinata.cloud/developers/api-keys
   * Used by PinataSDK to create presigned upload URLs.
   */
  PINATA_JWT: z
    .string()
    .min(1, 'PINATA_JWT is required')
    .min(32, 'PINATA_JWT appears to be too short to be valid'),

  /**
   * Pinata Gateway URL (optional, for fetching pinned files).
   * Example: https://gateway.pinata.cloud  or  https://<subdomain>.mypinata.cloud
   * Defaults to https://gateway.pinata.cloud if unset.
   */
  PINATA_GATEWAY_URL: z
    .string()
    .url('PINATA_GATEWAY_URL must be a valid URL')
    .optional()
    .or(z.literal('')),

  /**
   * Sepolia RPC URL for server-side chain reads (optional).
   * Same value as NEXT_PUBLIC_SEPOLIA_RPC_URL but without NEXT_PUBLIC prefix.
   * Used by Hardhat and any server-side viem client.
   * Example: https://eth-sepolia.g.alchemy.com/v2/<API_KEY>
   */
  SEPOLIA_RPC_URL: z
    .string()
    .url('SEPOLIA_RPC_URL must be a valid URL')
    .refine(
      (val) => val.startsWith('https://'),
      'SEPOLIA_RPC_URL must start with https://',
    )
    .optional()
    .or(z.literal('')),

  /**
   * Node environment — controls dev vs. production behaviour.
   */
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Parsed and validated server environment variables.
 *
 * Validation is lazy: each property getter validates on first access so that
 * `npm run build` can succeed without a populated .env.local, while runtime
 * requests that touch these values will fail fast with a clear error message.
 */
export const serverEnv = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    const result = serverEnvSchema.safeParse({
      MONGODB_URI: process.env.MONGODB_URI,
      PINATA_JWT: process.env.PINATA_JWT,
      PINATA_GATEWAY_URL: process.env.PINATA_GATEWAY_URL,
      SEPOLIA_RPC_URL: process.env.SEPOLIA_RPC_URL,
      NODE_ENV: process.env.NODE_ENV,
    });
    if (!result.success) {
      throw new Error(
        `[ZVault] Invalid server environment variables:\n${result.error.issues
          .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
          .join('\n')}`,
      );
    }
    return result.data[prop as keyof ServerEnv];
  },
});
