'use client';

/**
 * FileRegistry Contract — Sepolia
 *
 * Reads the deployed contract address from NEXT_PUBLIC_FILE_REGISTRY_ADDRESS.
 * ABI is kept minimal (only functions needed by the frontend).
 * Chain: Ethereum Sepolia (11155111)
 */

export const FILE_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerFile',
    inputs: [{ name: 'cid', type: 'string' }],
    outputs: [{ name: 'fileId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'grantAccess',
    inputs: [
      { name: 'fileId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'encryptedKey', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeAccess',
    inputs: [
      { name: 'fileId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'files',
    inputs: [{ name: 'fileId', type: 'bytes32' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'createdAt', type: 'uint64' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'accessPermissions',
    inputs: [
      { name: 'fileId', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'FileRegistered',
    inputs: [
      { name: 'fileId', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'cid', type: 'string', indexed: false },
      { name: 'timestamp', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AccessGranted',
    inputs: [
      { name: 'fileId', type: 'bytes32', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'encryptedKey', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AccessRevoked',
    inputs: [
      { name: 'fileId', type: 'bytes32', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
    ],
  },
] as const;

/**
 * Sepolia FileRegistry address from env.
 * Returns `undefined` if not yet deployed — caller should handle gracefully.
 */
export function getFileRegistryAddress(): `0x${string}` | undefined {
  const addr = process.env.NEXT_PUBLIC_FILE_REGISTRY_ADDRESS;
  if (!addr || addr === '0x0000000000000000000000000000000000000000') return undefined;
  return addr as `0x${string}`;
}

export const SEPOLIA_CHAIN_ID = 11155111 as const;
