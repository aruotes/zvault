'use client';

/**
 * useDecryptSharedFile — Full decryption pipeline for a recipient.
 *
 * Given a SharedFile (from useSharedWithMe):
 *   1. deserializeWrappedPayload(serializedWrappedKey)
 *   2. unwrapKeyForSelf(wrappedKey, ephemeralPublicKey, walletAddress) → CryptoKey
 *   3. Fetch encrypted blob from IPFS gateway
 *   4. decryptFileWithKey(blob, aesKey, mimeType) → plaintext Blob
 *   5. triggerDownload(plaintext, filename)
 *
 * QA Fix B: unwrapKeyForSelf now requires walletAddress for wallet-scoped IDB.
 */
import { useState, useCallback } from 'react';
import { useAccount }            from 'wagmi';
import { deserializeWrappedPayload, unwrapKeyForSelf } from '@/lib/crypto/hybrid';
import { decryptFileWithKey }    from '@/lib/crypto/core';

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

export type DecryptSharedStatus =
  | 'idle'
  | 'unwrapping'
  | 'fetching'
  | 'decrypting'
  | 'done'
  | 'error';

export interface UseDecryptSharedFileReturn {
  decryptSharedFile: (params: {
    serializedWrappedKey: string;
    cid:                  string;
    mimeType:             string;
    fileName:             string;
  }) => Promise<void>;
  status: DecryptSharedStatus;
  error:  string | null;
  reset:  () => void;
}

export function useDecryptSharedFile(): UseDecryptSharedFileReturn {
  const { address } = useAccount();
  const [status, setStatus] = useState<DecryptSharedStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);

  const reset = useCallback(() => { setStatus('idle'); setError(null); }, []);

  const decryptSharedFile = useCallback(async (params: {
    serializedWrappedKey: string;
    cid:                  string;
    mimeType:             string;
    fileName:             string;
  }): Promise<void> => {
    if (!address) throw new Error('Wallet not connected.');
    setError(null);

    try {
      // Step 1 — Deserialize the wrapped payload from the event log
      setStatus('unwrapping');
      const payload = deserializeWrappedPayload(params.serializedWrappedKey);

      // Step 2 — Unwrap the AES key using wallet-scoped IDB private key (QA Fix B)
      const aesKey = await unwrapKeyForSelf(
        payload.wrappedKey,
        payload.ephemeralPublicKey,
        address,
      );

      // Step 3 — Fetch encrypted blob from IPFS
      setStatus('fetching');
      const res = await fetch(`${IPFS_GATEWAY}/${params.cid}`);
      if (!res.ok) throw new Error(`IPFS gateway returned ${res.status}`);
      const encBlob = await res.blob();

      // Step 4 — Decrypt in browser using the unwrapped CryptoKey
      setStatus('decrypting');
      const plainBlob = await decryptFileWithKey(encBlob, aesKey, params.mimeType);

      // Step 5 — Trigger download
      const url = URL.createObjectURL(plainBlob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `decrypted_${params.fileName}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      setStatus('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      throw err;
    }
  }, [address]);

  return { decryptSharedFile, status, error, reset };
}
