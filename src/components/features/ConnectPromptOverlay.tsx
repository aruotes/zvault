'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

/**
 * ConnectPromptOverlay — shown when no wallet is connected.
 * Renders a centered glass-card overlay on top of gated UI sections.
 */
export function ConnectPromptOverlay() {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl
      bg-slate-950/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 text-center px-6 py-8
        bg-slate-900/80 border border-slate-700/60 rounded-2xl shadow-2xl max-w-xs w-full">
        <div className="text-4xl">🔐</div>
        <div>
          <h3 className="text-white font-semibold text-base mb-1">Connect Your Wallet</h3>
          <p className="text-slate-400 text-xs leading-relaxed">
            Connect to access your vault, upload encrypted files,
            and share access securely on Ethereum Sepolia.
          </p>
        </div>
        <ConnectButton />
      </div>
    </div>
  );
}
