'use client';

/**
 * useGrantAccess — Full access-sharing pipeline.
 *
 * Flow (all client-side crypto + one wallet tx):
 *   1. Fetch recipient's ECDH public key from /api/users/keys
 *   2. Import a CryptoKey from the raw AES keyBase64 string (extractable)
 *   3. wrapKeyForRecipient(aesKey, recipientPubKeyJwk) → WrappedKeyPayload
 *   4. serializeWrappedPayload(payload) → JSON string (this is encryptedKey)
 *   5. writeContractAsync: grantAccess(fileId, recipientAddr, serialized)
 *   6. waitForTransactionReceipt
 *
 * Security: encryptedKey is ALWAYS the serializeWrappedPayload output — never
 * the raw AES key or its base64 encoding.
 */
import { useState, useCallback } from 'react';
import { useWriteContract, usePublicClient } from 'wagmi';
import {
  FILE_REGISTRY_ABI,
  FILE_REGISTRY_ADDRESS,
  SEPOLIA_CHAIN_ID,
} from '@/lib/web3/contracts';
import {
  wrapKeyForRecipient,
  serializeWrappedPayload,
  fetchRecipientPublicKey,
} from '@/lib/crypto/hybrid';

export type GrantAccessStatus =
  | 'idle'
  | 'fetching-key'
  | 'wrapping'
  | 'awaiting-wallet'
  | 'confirming'
  | 'done'
  | 'error';

export interface GrantAccessParams {
  fileId:           `0x${string}`;  // bytes32 returned by registerFile
  recipientAddress: `0x${string}`;
  keyBase64:        string;          // the AES-256 key as base64 (from secret.key)
}

export interface UseGrantAccessReturn {
  grantAccess: (params: GrantAccessParams) => Promise<`0x${string}`>;
  status:      GrantAccessStatus;
  error:       string | null;
  txHash:      `0x${string}` | null;
  reset:       () => void;
}

export function useGrantAccess(): UseGrantAccessReturn {
  const { writeContractAsync } = useWriteContract();
  const publicClient           = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });

  const [status,  setStatus]  = useState<GrantAccessStatus>('idle');
  const [error,   setError]   = useState<string | null>(null);
  const [txHash,  setTxHash]  = useState<`0x${string}` | null>(null);

  const reset = useCallback(() => {
    setStatus('idle'); setError(null); setTxHash(null);
  }, []);

  const grantAccess = useCallback(async ({
    fileId,
    recipientAddress,
    keyBase64,
  }: GrantAccessParams): Promise<`0x${string}`> => {
    setError(null);

    // Step 1 — Fetch recipient's P-256 public key from the key registry
    setStatus('fetching-key');
    const recipientPubKey = await fetchRecipientPublicKey(recipientAddress);
    if (!recipientPubKey) {
      const msg = `Recipient ${recipientAddress} has not registered their encryption key. ` +
                  'Ask them to connect their wallet to ZVault first.';
      setError(msg);
      setStatus('error');
      throw new Error(msg);
    }

    // Step 2 — Import AES key as extractable CryptoKey for wrapping
    setStatus('wrapping');
    const rawBytes = Uint8Array.from(
      atob(keyBase64.trim()),
      c => c.charCodeAt(0),
    );
    const rawBuffer = new ArrayBuffer(rawBytes.byteLength);
    new Uint8Array(rawBuffer).set(rawBytes);
    const aesKey = await crypto.subtle.importKey(
      'raw',
      rawBuffer,
      { name: 'AES-GCM', length: 256 },
      true,  // extractable: true so AES-KW can wrap it
      ['encrypt', 'decrypt'],
    );

    // Step 3+4 — Wrap and serialize
    const payload           = await wrapKeyForRecipient(aesKey, recipientPubKey);
    const serializedPayload = serializeWrappedPayload(payload);
    // serializedPayload is { wrappedKey: base64, ephemeralPublicKey: JWK }
    // — NEVER the raw AES key.

    // Step 5 — Submit on-chain tx
    setStatus('awaiting-wallet');
    let hash: `0x${string}`;
    try {
      hash = await writeContractAsync({
        address:      FILE_REGISTRY_ADDRESS,
        abi:          FILE_REGISTRY_ABI,
        functionName: 'grantAccess',
        args:         [fileId, recipientAddress, serializedPayload],
        chainId:      SEPOLIA_CHAIN_ID,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
      throw err;
    }

    setTxHash(hash);

    // Step 6 — Wait for confirmation
    setStatus('confirming');
    await publicClient!.waitForTransactionReceipt({ hash, confirmations: 1 });

    // Step 7 — Index the share event off-chain
    const res = await fetch('/api/files/shared', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: hash }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      console.error('[ZVault] Failed to index share event:', errJson);
      // We don't throw here because the on-chain tx succeeded,
      // but in a production app we might have a retry queue or "index pending" state.
    }

    setStatus('done');
    return hash;
  }, [writeContractAsync, publicClient]);

  return { grantAccess, status, error, txHash, reset };
}
