/**
 * CLIENT-SIDE ENVIRONMENT VALIDATION
 *
 * Validates all NEXT_PUBLIC_* environment variables using Zod.
 * These variables are safe to use in both client and server contexts because
 * Next.js inlines them into the browser bundle at build time.
 *
 * If any required variable is missing or malformed, the application will
 * throw a descriptive error at startup rather than silently breaking at runtime.
 */
import { z } from 'zod';

const clientEnvSchema = z.object({
  /**
   * WalletConnect Project ID.
   * Obtain from: https://cloud.walletconnect.com
   * Required for RainbowKit wallet modal.
   */
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: z
    .string()
    .min(1, 'NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is required')
    .min(16, 'NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID appears to be too short'),

  /**
   * Sepolia RPC URL (Alchemy / Infura / Ankr).
   * Example: https://eth-sepolia.g.alchemy.com/v2/<API_KEY>
   * Optional at build time — if unset, wagmi uses the default public RPC.
   * Recommended to set for reliable rate limits.
   */
  NEXT_PUBLIC_SEPOLIA_RPC_URL: z
    .string()
    .url('NEXT_PUBLIC_SEPOLIA_RPC_URL must be a valid URL')
    .refine(
      (val) => val.startsWith('https://'),
      'NEXT_PUBLIC_SEPOLIA_RPC_URL must start with https://',
    )
    .optional()
    .or(z.literal('')),

  /**
   * Deployed FileRegistry contract address on Sepolia.
   * Obtain after running: npx hardhat ignition deploy ./ignition/modules/FileRegistry.ts --network sepolia
   * Optional until contract is deployed.
   */
  NEXT_PUBLIC_FILE_REGISTRY_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid Ethereum address (0x + 40 hex chars)')
    .optional()
    .or(z.literal('')),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Parsed and validated client-safe environment variables.
 * Safe to import from both Server and Client Components.
 *
 * Validation is lazy: validates on first property access so that
 * `npm run build` succeeds without a populated .env.local.
 */
export const clientEnv = new Proxy({} as ClientEnv, {
  get(_target, prop: string) {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID:
        process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
      NEXT_PUBLIC_SEPOLIA_RPC_URL:
        process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
      NEXT_PUBLIC_FILE_REGISTRY_ADDRESS:
        process.env.NEXT_PUBLIC_FILE_REGISTRY_ADDRESS,
    });
    if (!result.success) {
      throw new Error(
        `[ZVault] Invalid client environment variables:\n${result.error.issues
          .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
          .join('\n')}`,
      );
    }
    return result.data[prop as keyof ClientEnv];
  },
});
