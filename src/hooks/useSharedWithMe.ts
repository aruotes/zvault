'use client';

/**
 * useSharedWithMe — Queries AccessGranted event logs for the connected wallet.
 *
 * QA Fix C: Uses file.ownerAddress from MongoDB (/api/files) rather than
 * log.address (which is the contract address, not the file owner).
 *
 * QA Fix E: Uses DEPLOYMENT_BLOCK as fromBlock to avoid scanning all Sepolia
 * history, preventing RPC timeouts.
 */
import { useEffect, useState, useCallback, startTransition } from 'react';
import { useAccount, usePublicClient }       from 'wagmi';
import { decodeEventLog }                    from 'viem';
import {
  FILE_REGISTRY_ABI,
  FILE_REGISTRY_ADDRESS,
  SEPOLIA_CHAIN_ID,
  DEPLOYMENT_BLOCK,
} from '@/lib/web3/contracts';

export interface SharedFile {
  /** On-chain bytes32 fileId */
  fileId:               `0x${string}`;
  /** IPFS CID — used to fetch the encrypted blob */
  cid:                  string;
  /** Original filename from MongoDB */
  originalName:         string;
  /** MIME type from MongoDB */
  mimeType:             string;
  /** True owner address from MongoDB (QA Fix C — NOT from log.address) */
  ownerAddress:         string;
  /** Serialized WrappedKeyPayload JSON from the event log */
  serializedWrappedKey: string;
  /** Sepolia block the event was emitted in */
  blockNumber:          bigint;
}

/** MongoDB file record shape (what GET /api/files returns per item) */
interface MongoFile {
  cid:          string;
  originalName: string;
  mimeType:     string;
  ownerAddress: string;
  fileId?:      string | null;
}

export interface UseSharedWithMeReturn {
  sharedFiles: SharedFile[];
  isLoading:   boolean;
  error:       string | null;
  refresh:     () => void;
}

export function useSharedWithMe(): UseSharedWithMeReturn {
  const { address, isConnected } = useAccount();
  const publicClient             = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });

  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [isLoading,   setIsLoading]   = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [refreshSig,  setRefreshSig]  = useState(0);

  const refresh = useCallback(() => setRefreshSig(n => n + 1), []);

  useEffect(() => {
    if (!isConnected || !address || !publicClient) {
      startTransition(() => setSharedFiles([]));
      return;
    }

    let cancelled = false;

    async function fetchShared() {
      setIsLoading(true);
      setError(null);

      try {
        // ── Step 1: Fetch indexed shares + file metadata from MongoDB ──
        const metaRes = await fetch(`/api/files/shared?recipient=${address}`);
        if (!metaRes.ok) {
          throw new Error('Failed to fetch shared files metadata');
        }
        const { shares } = await metaRes.json() as {
          shares: Array<{
            fileId: `0x${string}`;
            blockNumber: number;
            txHash: string;
            cid?: string;
            originalName?: string;
            mimeType?: string;
            ownerAddress?: string;
          }>;
        };

        if (shares.length === 0) {
          if (!cancelled) { setSharedFiles([]); setIsLoading(false); }
          return;
        }

        // ── Step 2: Extract encryptedKey from precise on-chain blocks ──
        // Instead of 10K block range scans, we do pinpoint queries for the specific blocks.
        const eventAbi = FILE_REGISTRY_ABI.find(
          (e): e is typeof e & { type: 'event'; name: 'AccessGranted' } =>
            e.type === 'event' && 'name' in e && e.name === 'AccessGranted',
        );
        if (!eventAbi) throw new Error('AccessGranted ABI entry not found.');

        const results: SharedFile[] = [];

        // Batching these promises would be faster, but sequentially is safer for rate limits
        for (const share of shares) {
          try {
            const logs = await publicClient!.getLogs({
              address:   FILE_REGISTRY_ADDRESS,
              event:     eventAbi,
              args:      { recipient: address as `0x${string}`, fileId: share.fileId },
              fromBlock: BigInt(share.blockNumber),
              toBlock:   BigInt(share.blockNumber),
            });

            // Parse the precise log
            for (const log of logs) {
              try {
                const decoded = decodeEventLog({
                  abi:    FILE_REGISTRY_ABI,
                  topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
                  data:   log.data,
                });
                if (decoded.eventName !== 'AccessGranted') continue;

                const args = decoded.args as {
                  fileId:       `0x${string}`;
                  recipient:    `0x${string}`;
                  encryptedKey: string;
                };

                results.push({
                  fileId:               args.fileId,
                  cid:                  share.cid          ?? '',
                  originalName:         share.originalName ?? `File ${args.fileId.slice(0, 10)}…`,
                  mimeType:             share.mimeType     ?? 'application/octet-stream',
                  ownerAddress:         share.ownerAddress ?? 'unknown',
                  serializedWrappedKey: args.encryptedKey, // Pulled straight from the chain!
                  blockNumber:          log.blockNumber ?? BigInt(share.blockNumber),
                });
                break; // Only need the first matching log per share
              } catch { /* non-matching log */ }
            }
          } catch (err) {
            console.error(`Failed to fetch log for block ${share.blockNumber}`, err);
          }
        }

        if (!cancelled) {
          setSharedFiles(results);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      }
    }

    fetchShared();
    return () => { cancelled = true; };
  }, [address, isConnected, publicClient, refreshSig]);

  return { sharedFiles, isLoading, error, refresh };
}
