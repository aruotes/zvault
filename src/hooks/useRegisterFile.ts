'use client';

/**
 * useRegisterFile — Wagmi hook for FileRegistry.registerFile(cid).
 *
 * Full pipeline:
 *   1. writeContractAsync → MetaMask prompt → txHash
 *   2. waitForTransactionReceipt (1 confirmation)
 *   3. Decode FileRegistered event → extract on-chain fileId
 *   4. Call PATCH /api/files/[cid] for server-side verification (QA Fix A)
 *
 * The server route independently verifies the receipt before flipping
 * onChainRegistered in MongoDB, so client-side trust is not required.
 */
import { useState, useCallback } from 'react';
import { useWriteContract, usePublicClient, useAccount } from 'wagmi';
import { decodeEventLog, keccak256, stringToBytes } from 'viem';

import {
  FILE_REGISTRY_ABI,
  FILE_REGISTRY_ADDRESS,
  SEPOLIA_CHAIN_ID,
} from '@/lib/web3/contracts';

export type RegisterFileStatus =
  | 'idle'
  | 'awaiting-wallet'
  | 'confirming'
  | 'verifying'
  | 'done'
  | 'error';

export interface RegisterFileResult {
  txHash: `0x${string}`;
  fileId: `0x${string}`;
}

export interface UseRegisterFileReturn {
  registerFile: (cid: string) => Promise<RegisterFileResult>;
  status:       RegisterFileStatus;
  error:        string | null;
  reset:        () => void;
}

export function useRegisterFile(): UseRegisterFileReturn {
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { address }            = useAccount();

  const [status, setStatus] = useState<RegisterFileStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);

  const reset = useCallback(() => { setStatus('idle'); setError(null); }, []);

  const registerFile = useCallback(async (cid: string): Promise<RegisterFileResult> => {
    if (!address) throw new Error('Wallet not connected.');

    setStatus('awaiting-wallet');
    setError(null);

    let txHash: `0x${string}`;
    try {
      txHash = await writeContractAsync({
        address:      FILE_REGISTRY_ADDRESS,
        abi:          FILE_REGISTRY_ABI,
        functionName: 'registerFile',
        args:         [cid],
        chainId:      SEPOLIA_CHAIN_ID,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      throw err;
    }

    // Wait for 1 confirmation
    setStatus('confirming');
    const receipt = await publicClient!.waitForTransactionReceipt({
      hash:          txHash,
      confirmations: 1,
    });

    // Extract fileId from FileRegistered event
    let fileId: `0x${string}` = keccak256(stringToBytes(cid)) as `0x${string}`;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi:    FILE_REGISTRY_ABI,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          data:   log.data,
        });
        if (decoded.eventName === 'FileRegistered') {
          fileId = (decoded.args as { fileId: `0x${string}` }).fileId;
          break;
        }
      } catch { /* non-matching log — skip */ }
    }

    // Server-side receipt verification before marking DB record (QA Fix A)
    setStatus('verifying');
    const verifyRes = await fetch(`/api/files/${encodeURIComponent(cid)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ txHash }),
    });
    if (!verifyRes.ok) {
      const err = await verifyRes.json() as { error?: string };
      throw new Error(err.error ?? 'Server-side tx verification failed.');
    }

    setStatus('done');
    return { txHash, fileId };
  }, [address, writeContractAsync, publicClient]);

  return { registerFile, status, error, reset };
}
