/**
 * hardhat/scripts/export-abi.ts
 *
 * Reads the Ignition deployment artifacts for FileRegistry on chain-11155111
 * and writes a type-safe ABI + address + deployment-block constant to the
 * Next.js source tree.  Run this whenever you redeploy or bump the contract.
 *
 * Usage (from the hardhat/ directory):
 *   npx ts-node --project tsconfig.json scripts/export-abi.ts
 *
 * Output:
 *   ../src/lib/web3/generated/FileRegistry.ts  (auto-generated — do not edit)
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── Source paths (all relative to hardhat/) ───────────────────────────────────

const CHAIN_DIR = path.resolve(
  __dirname,
  '../ignition/deployments/chain-11155111',
);
const ARTIFACT_PATH  = path.join(CHAIN_DIR, 'artifacts/FileRegistryModule#FileRegistry.json');
const ADDRESSES_PATH = path.join(CHAIN_DIR, 'deployed_addresses.json');
const JOURNAL_PATH   = path.join(CHAIN_DIR, 'journal.jsonl');

// ── Destination (Next.js lib layer) ──────────────────────────────────────────

const OUT_DIR  = path.resolve(__dirname, '../../src/lib/web3/generated');
const OUT_FILE = path.join(OUT_DIR, 'FileRegistry.ts');

// ── Read artifacts ────────────────────────────────────────────────────────────

const artifact  = JSON.parse(fs.readFileSync(ARTIFACT_PATH,  'utf-8')) as {
  abi: unknown[];
};
const addresses = JSON.parse(fs.readFileSync(ADDRESSES_PATH, 'utf-8')) as Record<string, string>;

const contractAddress = addresses['FileRegistryModule#FileRegistry'];
if (!contractAddress) {
  throw new Error('FileRegistryModule#FileRegistry address not found in deployed_addresses.json');
}

// ── Extract deployment block from journal.jsonl (QA Fix E) ───────────────────
// The TRANSACTION_CONFIRM entry has the on-chain receipt with blockNumber.

let deploymentBlock = 11_639_064; // hard-coded fallback from known deployment

try {
  const journalLines = fs.readFileSync(JOURNAL_PATH, 'utf-8')
    .split('\n')
    .filter(Boolean);

  for (const line of journalLines) {
    const entry = JSON.parse(line) as {
      type?: string;
      receipt?: { blockNumber?: number };
    };
    if (
      entry.type === 'TRANSACTION_CONFIRM' &&
      typeof entry.receipt?.blockNumber === 'number'
    ) {
      deploymentBlock = entry.receipt.blockNumber;
      console.log(`[export-abi] Extracted deployment block from journal: ${deploymentBlock}`);
      break;
    }
  }
} catch (e) {
  console.warn(
    `[export-abi] Could not parse journal.jsonl; using hard-coded block ${deploymentBlock}. Error: ${e}`,
  );
}

// ── Emit TypeScript source ────────────────────────────────────────────────────

const output = `// ─────────────────────────────────────────────────────────────────────────────
// AUTO-GENERATED — DO NOT EDIT BY HAND
// Source: hardhat/ignition/deployments/chain-11155111/
// Regenerate: cd hardhat && npx ts-node scripts/export-abi.ts
// ─────────────────────────────────────────────────────────────────────────────

export const FILE_REGISTRY_ADDRESS =
  '${contractAddress}' as const satisfies \`0x\${string}\`;

export const SEPOLIA_CHAIN_ID = 11155111 as const;

/**
 * Sepolia block at which FileRegistry was deployed.
 * Used as \`fromBlock\` in getLogs to avoid scanning all history.
 */
export const DEPLOYMENT_BLOCK = BigInt(${deploymentBlock});


export const FILE_REGISTRY_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, output, 'utf-8');
console.log(`[export-abi] Written → ${OUT_FILE}`);
console.log(`[export-abi] Address: ${contractAddress}`);
console.log(`[export-abi] Deployment block: ${deploymentBlock}`);
