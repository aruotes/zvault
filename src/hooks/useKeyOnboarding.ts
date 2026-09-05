'use client';

/**
 * useKeyOnboarding — ECDH P-256 keypair lifecycle manager.
 *
 * Fires once per wallet-connect event. Idempotent:
 *   - generateAndStoreUserKeyPair(address) is a no-op if the key already exists
 *     for that wallet address in IndexedDB.
 *   - publishPublicKey posts the public key to the ZVault key registry.
 *
 * State machine:
 *   'idle'       → wallet not connected
 *   'generating' → generateAndStoreUserKeyPair() in progress
 *   'syncing'    → POST /api/users/keys in flight
 *   'ready'      → keypair confirmed in IDB + public key synced
 *   'error'      → any step failed (user can retry)
 */
import { useEffect, useState, useRef } from 'react';
import { useAccount } from 'wagmi';
import {
  generateAndStoreUserKeyPair,
  publishPublicKey,
} from '@/lib/crypto/hybrid';

export type KeyOnboardingStatus =
  | 'idle'
  | 'generating'
  | 'syncing'
  | 'ready'
  | 'error';

export interface UseKeyOnboardingReturn {
  status: KeyOnboardingStatus;
  error:  string | null;
  retry:  () => void;
}

export function useKeyOnboarding(): UseKeyOnboardingReturn {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<KeyOnboardingStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);
  // Track the last address we successfully onboarded to prevent re-runs.
  const lastOnboardedRef = useRef<string | null>(null);
  const [retrySignal, setRetrySignal] = useState(0);

  useEffect(() => {
    if (!isConnected || !address) {
      setStatus('idle');
      return;
    }
    // Already onboarded for this address in this session → stay 'ready'.
    if (lastOnboardedRef.current === address.toLowerCase() && status === 'ready') return;

    let cancelled = false;

    async function run() {
      try {
        // Step 1 — Generate or retrieve existing wallet-scoped keypair (QA Fix B)
        setStatus('generating');
        const publicKeyJwk = await generateAndStoreUserKeyPair(address!);
        if (cancelled) return;

        // Step 2 — Publish public key to the ZVault key registry
        setStatus('syncing');
        await publishPublicKey(address!, publicKeyJwk);
        if (cancelled) return;

        lastOnboardedRef.current = address!.toLowerCase();
        setError(null);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    }

    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, retrySignal]);

  return {
    status,
    error,
    retry: () => setRetrySignal(n => n + 1),
  };
}
