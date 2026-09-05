'use client';

/**
 * Web3Providers — Wagmi v2 + RainbowKit v2 + TanStack Query v5
 *
 * Wraps the app with all required Web3 context providers.
 * This is a Client Component because Wagmi hooks and RainbowKit rely on
 * browser APIs (window.ethereum, IndexedDB, localStorage for wallet state).
 *
 * Chain: Ethereum Sepolia (11155111) — unified testnet for ZVault protocol.
 * RPC:   NEXT_PUBLIC_SEPOLIA_RPC_URL (Alchemy/Infura) → falls back to public RPC.
 * WalletConnect ProjectID: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 */

import { ReactNode }             from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { sepolia }                               from 'wagmi/chains';
import { QueryClient, QueryClientProvider }   from '@tanstack/react-query';
import {
  RainbowKitProvider,
  getDefaultConfig,
  darkTheme,
}                                             from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';

// ── Wagmi Config ──────────────────────────────────────────────────────────────

// NEXT_PUBLIC_SEPOLIA_RPC_URL is injected at build time.
// If unset, wagmi falls back to the default public Sepolia RPC.
const sepoliaRpcUrl = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

const wagmiConfig = getDefaultConfig({
  appName:    'ARUOTES ZVault',
  projectId:  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'DEMO_PROJECT_ID',
  chains:     [sepolia],
  transports: {
    [sepolia.id]: http(sepoliaRpcUrl ? sepoliaRpcUrl : undefined),
  },
  ssr: true, // Enable SSR-safe config for Next.js App Router
});

// ── TanStack Query Client ─────────────────────────────────────────────────────

// Singleton QueryClient — created once per browser session.
// Kept outside the component so it's not re-created on every render.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:  1000 * 60 * 5, // 5 minutes — reduces unnecessary refetches
      retry:      2,
      refetchOnWindowFocus: false,
    },
  },
});

// ── RainbowKit Theme ──────────────────────────────────────────────────────────

const rainbowTheme = darkTheme({
  accentColor:           '#6366f1', // indigo-500 — matches ZVault brand
  accentColorForeground: '#ffffff',
  borderRadius:          'large',
  fontStack:             'system',
  overlayBlur:           'small',
});

// ── Provider Component ────────────────────────────────────────────────────────

interface Web3ProvidersProps {
  children: ReactNode;
}

export function Web3Providers({ children }: Web3ProvidersProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} locale="en-US">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// Re-export wagmiConfig for use in server-side utilities (e.g., reading chain state)
export { wagmiConfig };
