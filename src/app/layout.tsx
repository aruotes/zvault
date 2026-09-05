import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Web3Providers } from '@/lib/web3/providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ARUOTES ZVault — Secure Decentralized File Sharing',
  description:
    'ZVault encrypts files locally in your browser using AES-256-GCM. No data leaves your device.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Web3Providers>
          {children}
        </Web3Providers>
      </body>
    </html>
  );
}
