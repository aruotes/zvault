'use client';

/**
 * ShareModal — ECIES key-wrapping + grantAccess on-chain flow.
 *
 * QA Fix F: If rawAesKey is not provided (owner reopens modal in a new session),
 * the modal renders a dropzone requesting the user's secret.key file to re-derive
 * the CryptoKey before wrapping.
 *
 * QA Fix D: The "Share" button is disabled if the wallet is on the wrong network.
 */

import { useState, useCallback, useRef } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useGrantAccess, type GrantAccessStatus } from '@/hooks/useGrantAccess';
import { SEPOLIA_CHAIN_ID } from '@/lib/web3/contracts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShareModalProps {
  isOpen:   boolean;
  onClose:  () => void;
  fileName: string;
  fileId:   `0x${string}`;  // bytes32 from on-chain registerFile
  /** Pass if rawAesKey is still in memory (same upload session). */
  keyBase64?: string;
}

// ── Status badge helpers ──────────────────────────────────────────────────────

const STATUS_LABELS: Record<GrantAccessStatus, string> = {
  idle:                   '',
  'fetching-key':         'Fetching recipient\'s public key…',
  'recipient-not-found':  '',   // handled by the invite card below
  wrapping:               'Wrapping AES key with ECIES…',
  'awaiting-wallet':      'Awaiting wallet signature…',
  confirming:             'Waiting for on-chain confirmation…',
  done:                   'Access granted ✓',
  error:                  'An error occurred.',
};

const STATUS_COLORS: Partial<Record<GrantAccessStatus, string>> = {
  done:  'text-emerald-300 bg-emerald-950/60 border-emerald-500/30',
  error: 'text-rose-300 bg-rose-950/60 border-rose-500/30',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ShareModal({ isOpen, onClose, fileName, fileId, keyBase64: initialKey }: ShareModalProps) {
  const { address }            = useAccount();
  const chainId                = useChainId();
  const { switchChain }        = useSwitchChain();
  const { grantAccess, status, error, txHash, reset } = useGrantAccess();

  const [recipientAddr, setRecipientAddr] = useState('');
  const [resolvedKey,   setResolvedKey]   = useState<string | undefined>(initialKey);
  const [keyDropError,  setKeyDropError]  = useState<string | null>(null);
  const [inviteCopied,  setInviteCopied]  = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const isWrongNetwork       = chainId !== SEPOLIA_CHAIN_ID;
  // Extract before isBusy so TypeScript control-flow doesn't narrow
  // status to 'idle|done|error' at the point of the disabled check.
  const isRecipientNotFound  = status === 'recipient-not-found';
  const isBusy = status !== 'idle' && status !== 'done' && status !== 'error' && !isRecipientNotFound;

  const handleKeyFile = useCallback(async (file: File) => {
    try {
      const text = (await file.text()).trim();
      // Basic sanity check: base64 AES-256 key is 44 chars
      if (text.length < 40) throw new Error('Key file appears invalid (too short).');
      setResolvedKey(text);
      setKeyDropError(null);
    } catch (err) {
      setKeyDropError(err instanceof Error ? err.message : 'Failed to read key file.');
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!resolvedKey || !address) return;
    const addr = recipientAddr.trim() as `0x${string}`;
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
    try {
      await grantAccess({ fileId, recipientAddress: addr, keyBase64: resolvedKey });
    } catch (err) {
      // 'RECIPIENT_NOT_FOUND' is surfaced via hook status — not a crash.
      // All other errors are surfaced via hook's 'error' status.
      if (err instanceof Error && err.message !== 'RECIPIENT_NOT_FOUND') {
        console.error('[ZVault] grantAccess unexpected error:', err);
      }
    }
  }, [resolvedKey, address, recipientAddr, fileId, grantAccess]);

  const handleCopyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // clipboard API blocked in some browser contexts
    }
  }, []);

  const handleClose = useCallback(() => {
    reset();
    setRecipientAddr('');
    setKeyDropError(null);
    setInviteCopied(false);
    onClose();
  }, [reset, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4
      bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>

      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl
        w-full max-w-md p-6 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-white font-semibold text-lg">Share File Access</h2>
            <p className="text-slate-400 text-xs mt-0.5 truncate max-w-[280px]">{fileName}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-500 hover:text-white transition-colors text-xl leading-none"
          >×</button>
        </div>

        {/* Wrong network banner (QA Fix D) */}
        {isWrongNetwork && (
          <div className="flex items-center justify-between rounded-lg bg-amber-950/40
            border border-amber-500/30 px-3 py-2.5">
            <p className="text-amber-300 text-xs font-medium">
              ⚠ Switch to Ethereum Sepolia to share files.
            </p>
            <button
              onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
              className="text-xs font-semibold text-amber-200 underline ml-2 flex-shrink-0"
            >Switch</button>
          </div>
        )}

        {/* Key file dropzone — shown when no key in memory (QA Fix F) */}
        {!resolvedKey && (
          <div>
            <p className="text-slate-300 text-xs font-medium mb-2">
              Upload your <code className="text-indigo-300 bg-slate-800 px-1 rounded">secret.key</code> to enable sharing:
            </p>
            <div
              onClick={() => keyInputRef.current?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-slate-600
                hover:border-indigo-500 p-4 text-center transition-colors"
            >
              <input
                ref={keyInputRef}
                type="file"
                accept=".key,.txt,text/plain"
                className="sr-only"
                onChange={e => { if (e.target.files?.[0]) handleKeyFile(e.target.files[0]); }}
              />
              <p className="text-slate-400 text-sm">Click to upload secret.key</p>
              <p className="text-slate-600 text-xs mt-0.5">or drag & drop</p>
            </div>
            {keyDropError && (
              <p className="text-rose-400 text-xs mt-1">{keyDropError}</p>
            )}
          </div>
        )}

        {resolvedKey && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-950/30
            border border-emerald-500/20 px-3 py-2">
            <span className="text-emerald-400 text-sm">✓</span>
            <p className="text-emerald-300 text-xs">Encryption key loaded.</p>
            <button
              onClick={() => setResolvedKey(undefined)}
              className="ml-auto text-slate-500 hover:text-rose-400 text-xs"
            >Clear</button>
          </div>
        )}

        {/* Recipient address input */}
        <div>
          <label className="text-slate-300 text-xs font-medium block mb-1.5">
            Recipient Wallet Address
          </label>
          <input
            type="text"
            value={recipientAddr}
            onChange={e => setRecipientAddr(e.target.value)}
            placeholder="0x..."
            disabled={isBusy}
            className="w-full rounded-xl bg-slate-800 border border-slate-600 px-3 py-2.5
              text-white text-sm font-mono placeholder:text-slate-500
              focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
              disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* ── Recipient-not-found: Invite card (replaces red error) ── */}
        {isRecipientNotFound && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3.5 space-y-3">
            <div className="flex items-start gap-2">
              <span className="text-amber-400 text-base leading-none mt-0.5">⚠</span>
              <p className="text-amber-200 text-xs leading-relaxed">
                <strong className="font-semibold">Wallet not yet registered on ZVault.</strong>{' '}
                This wallet hasn&apos;t registered on ZVault yet. To enable end-to-end
                encryption, they need to connect their wallet once.
              </p>
            </div>
            <button
              id="share-modal-copy-invite-btn"
              onClick={handleCopyInvite}
              className="
                w-full py-2 rounded-lg text-xs font-semibold
                bg-amber-500/15 border border-amber-500/25
                text-amber-300 hover:bg-amber-500/25
                transition-colors duration-150
              "
            >
              {inviteCopied ? '✓ Copied!' : '🔗 Copy Invite Link'}
            </button>
          </div>
        )}

        {/* Progress display — all statuses except recipient-not-found (handled above) */}
        {status !== 'idle' && !isRecipientNotFound && (
          <div className={`rounded-lg border px-3 py-2.5 text-xs font-medium
            ${STATUS_COLORS[status] ?? 'text-indigo-300 bg-indigo-950/60 border-indigo-500/30'}`}>
            {STATUS_LABELS[status]}
            {status === 'done' && txHash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-1 underline opacity-70 hover:opacity-100 font-mono truncate"
              >
                {txHash.slice(0, 20)}…
              </a>
            )}
            {status === 'error' && error && (
              <p className="mt-1 opacity-80">{error}</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {status === 'done' ? (
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-xl font-semibold text-sm
                bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
            >Done</button>
          ) : (
            <>
              <button
                onClick={handleClose}
                disabled={isBusy}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm
                  bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >Cancel</button>
              <button
                id="share-modal-submit-btn"
                onClick={handleShare}
                disabled={
                  isBusy ||
                  isRecipientNotFound ||  // key missing — cannot share
                  isWrongNetwork ||
                  !resolvedKey ||
                  !/^0x[0-9a-fA-F]{40}$/.test(recipientAddr.trim()) ||
                  recipientAddr.trim().toLowerCase() === address?.toLowerCase()
                }
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm
                  bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700
                  text-white transition-colors shadow-lg shadow-indigo-900/30
                  disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                {isBusy ? '⟳ Sharing…' : '🔐 Grant Access'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
