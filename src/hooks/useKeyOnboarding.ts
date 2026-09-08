'use client';

/**
 * useKeyOnboarding — ECDH P-256 keypair lifecycle manager.
 *
 * UPDATED STATE MACHINE:
 *   'idle'             → wallet not connected
 *   'checking'         → reading IndexedDB to see if a key exists for this wallet
 *   'needs-onboarding' → new user: no key in IDB; waiting for user to click "Generate Keys"
 *   'generating'       → generateAndStoreUserKeyPair() in progress
 *   'syncing'          → POST /api/users/keys in flight
 *   'ready'            → keypair confirmed in IDB + public key synced to registry
 *   'error'            → any step failed (user can retry)
 *
 * SECURITY CHANGE:
 *   Keys are no longer auto-generated on wallet connect. For NEW users (no key
 *   found in IndexedDB), the hook sets 'needs-onboarding' and exposes a
 *   `startOnboarding()` function. This ensures the UI can enforce an explicit
 *   consent gate before any key material is created or published.
 *
 *   For RETURNING users (key already in IndexedDB), the hook auto-proceeds
 *   directly to syncing and 'ready', exactly as before.
 */
import { useEffect, useState, useRef, useCallback, startTransition } from 'react';
import { useAccount } from 'wagmi';
import {
  generateAndStoreUserKeyPair,
  publishPublicKey,
  hasLocalKey,
} from '@/lib/crypto/hybrid';

export type KeyOnboardingStatus =
  | 'idle'
  | 'checking'
  | 'needs-onboarding'
  | 'generating'
  | 'syncing'
  | 'ready'
  | 'error';

export interface UseKeyOnboardingReturn {
  status:           KeyOnboardingStatus;
  error:            string | null;
  /** Call to begin key generation — only valid when status === 'needs-onboarding' */
  startOnboarding:  () => void;
  /** Legacy retry alias for error state */
  retry:            () => void;
}

export function useKeyOnboarding(): UseKeyOnboardingReturn {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<KeyOnboardingStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);

  // Track the last address we successfully completed onboarding for.
  const lastReadyRef    = useRef<string | null>(null);
  const [signal, setSignal] = useState(0); // triggers a re-check / retry

  // ── Check IDB for existing key when wallet connects ──────────────────────────
  useEffect(() => {
    if (!isConnected || !address) {
      startTransition(() => {
        setStatus('idle');
        setError(null);
      });
      return;
    }

    // Already ready for this address in this session — no re-check needed.
    if (lastReadyRef.current === address.toLowerCase() && status === 'ready') return;

    let cancelled = false;

    async function check() {
      setStatus('checking');

      try {
        const hasKey = await hasLocalKey(address!);
        if (cancelled) return;

        if (!hasKey) {
          // Brand-new device / cleared IDB: gate on explicit user action.
          setStatus('needs-onboarding');
          return;
        }

        // Returning user: key exists in IDB — auto-proceed to sync.
        await runOnboarding();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    }

    async function runOnboarding() {
      try {
        setStatus('generating');
        const publicKeyJwk = await generateAndStoreUserKeyPair(address!);
        if (cancelled) return;

        setStatus('syncing');
        await publishPublicKey(address!, publicKeyJwk);
        if (cancelled) return;

        lastReadyRef.current = address!.toLowerCase();
        setError(null);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    }

    // Expose runOnboarding so startOnboarding can call it from outside this effect.
    // We store it in a ref so the callback is always current.
    runOnboardingRef.current = runOnboarding;

    check();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, signal]);

  // Ref to allow startOnboarding (defined outside the effect) to trigger the inner async fn.
  const runOnboardingRef = useRef<(() => Promise<void>) | null>(null);

  const startOnboarding = useCallback(() => {
    if (status !== 'needs-onboarding') return;
    // Trigger re-run of the effect with the key pre-seeded by one signal bump,
    // but we also call the cached ref directly for zero-delay UX.
    if (runOnboardingRef.current) {
      runOnboardingRef.current();
    } else {
      setSignal(n => n + 1);
    }
  }, [status]);

  const retry = useCallback(() => setSignal(n => n + 1), []);

  return { status, error, startOnboarding, retry };
}
