'use client';

/**
 * KeyOnboardingGateway
 * ─────────────────────
 * Shown for ALL non-ready connected states:
 *   - checking         → spinner (reading IDB)
 *   - needs-onboarding → primary CTA
 *   - generating       → spinner
 *   - syncing          → spinner
 *   - error            → error card with retry
 *
 * Security: Completely replaces (never overlays) the Vault UI.
 * The parent (page.tsx) guarantees this is the ONLY section rendered
 * when a connected wallet is not yet confirmed ready.
 */

import { useKeyOnboarding } from '@/hooks/useKeyOnboarding';

export function KeyOnboardingGateway() {
  const { status, error, startOnboarding, retry } = useKeyOnboarding();

  const isWorking = status === 'checking' || status === 'generating' || status === 'syncing';

  const workingLabel =
    status === 'checking'   ? 'Checking your device for existing keys…' :
    status === 'generating' ? 'Generating your P-256 ECDH keypair…' :
    status === 'syncing'    ? 'Registering public key with ZVault…' : '';

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16 w-full">
      <div className="
        w-full max-w-md
        bg-white border border-slate-200
        rounded-2xl shadow-lg
        p-10 flex flex-col items-center gap-6 text-center
      ">
        {/* Icon */}
        <div className="
          w-16 h-16 rounded-2xl
          bg-blue-50 border border-blue-100
          flex items-center justify-center text-3xl
          shadow-sm
        ">
          {status === 'error' ? '⚠️' : '🔑'}
        </div>

        {/* Copy */}
        <div className="space-y-2">
          <h2 className="text-slate-900 text-xl font-bold tracking-tight">
            {status === 'error' ? 'Key Setup Failed' : 'Welcome to ZVault'}
          </h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            {status === 'error'
              ? 'There was a problem setting up your encryption keys. Please try again.'
              : <>
                  To securely encrypt and share files, you must generate your local
                  device keys. These keys{' '}
                  <strong className="text-slate-700 font-semibold">never leave your browser</strong>
                  {' '}— only your public key is registered with ZVault.
                </>
            }
          </p>
        </div>

        {/* Progress label (checking / generating / syncing) */}
        {isWorking && (
          <div className="flex items-center gap-2 text-blue-700 text-sm bg-blue-50 border border-blue-100 px-4 py-2.5 rounded-lg w-full justify-center">
            <span className="animate-spin text-base inline-block">⟳</span>
            {workingLabel}
          </div>
        )}

        {/* Error details */}
        {status === 'error' && error && (
          <div className="w-full rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-left">
            <p className="text-rose-600 text-xs leading-relaxed font-mono break-all">{error}</p>
          </div>
        )}

        {/* Primary CTA */}
        {status === 'error' ? (
          <button
            id="onboarding-retry-btn"
            onClick={retry}
            className="
              w-full py-3.5 px-6 rounded-xl font-semibold text-sm
              bg-rose-600 hover:bg-rose-700 active:bg-rose-800
              text-white transition-all shadow-sm
              focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2
            "
          >
            Retry Key Setup
          </button>
        ) : (
          <button
            id="onboarding-generate-keys-btn"
            onClick={startOnboarding}
            disabled={isWorking}
            className="
              w-full py-3.5 px-6 rounded-xl font-semibold text-sm
              bg-blue-600 hover:bg-blue-700 active:bg-blue-800
              disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed
              text-white transition-all shadow-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
            "
          >
            {isWorking ? 'Working…' : 'Generate Encryption Keys'}
          </button>
        )}

        {/* Trust note */}
        <p className="text-slate-400 text-xs">
          🔒 Private keys are stored in your browser&apos;s IndexedDB and are never transmitted.
        </p>
      </div>
    </div>
  );
}
