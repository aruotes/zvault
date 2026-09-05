'use client';

/**
 * SharedWithMePane — Displays files shared with the connected wallet.
 *
 * Uses:
 *   - useSharedWithMe() to query AccessGranted events (QA Fix C + E)
 *   - useDecryptSharedFile() to unwrap + decrypt + download
 */
import { useSharedWithMe }      from '@/hooks/useSharedWithMe';
import { useDecryptSharedFile } from '@/hooks/useDecryptSharedFile';
import { useAccount }           from 'wagmi';

function formatAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function SharedWithMePane() {
  const { isConnected } = useAccount();
  const { sharedFiles, isLoading, error, refresh } = useSharedWithMe();
  const { decryptSharedFile, status: decryptStatus, error: decryptError, reset } = useDecryptSharedFile();

  if (!isConnected) {
    return (
      <div className="text-center py-14 text-slate-500">
        <p className="text-4xl mb-4">🔒</p>
        <p className="text-base">Please connect your wallet to view shared files.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
        <span className="animate-spin">⟳</span>
        <span className="text-sm">Scanning Sepolia for shared files…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 text-rose-800 text-sm text-center shadow-sm">
        {error}
        <button onClick={refresh} className="ml-2 underline opacity-70 hover:opacity-100 font-medium">Retry</button>
      </div>
    );
  }

  if (sharedFiles.length === 0) {
    return (
      <div className="text-center py-14 text-slate-600">
        <p className="text-3xl mb-3">📭</p>
        <p className="text-sm">No files have been shared with this wallet yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-xs">{sharedFiles.length} file{sharedFiles.length !== 1 ? 's' : ''} shared with you</p>
        <button
          onClick={refresh}
          className="text-slate-500 hover:text-white text-sm transition-colors"
          title="Refresh"
        >⟳</button>
      </div>

      {decryptError && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-800 text-sm shadow-sm">
          {decryptError}
          <button onClick={reset} className="ml-2 underline font-medium">Dismiss</button>
        </div>
      )}

      {sharedFiles.map((sf) => (
        <div
          key={`${sf.fileId}-${sf.blockNumber}`}
          className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm
            transition-all duration-200 hover:border-blue-300 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-slate-800 font-semibold text-base truncate">{sf.originalName}</p>
              
              <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500">
                <span>From: <span className="text-slate-700 font-medium">{formatAddr(sf.ownerAddress)}</span></span>
                <span>·</span>
                <span>Block #{sf.blockNumber.toString()}</span>
              </div>
              
              <details className="mt-3 text-xs text-slate-500 cursor-pointer group">
                <summary className="font-medium text-blue-600 hover:text-blue-700 outline-none select-none">
                  Technical Proofs
                </summary>
                <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono space-y-1.5 break-all">
                  <p><strong className="text-slate-400 font-medium">FileID (On-Chain):</strong> <br/>{sf.fileId}</p>
                </div>
              </details>
            </div>

            <button
              id={`decrypt-shared-btn-${sf.fileId.slice(0, 8)}`}
              disabled={decryptStatus !== 'idle' && decryptStatus !== 'done' && decryptStatus !== 'error'}
              onClick={() => decryptSharedFile({
                serializedWrappedKey: sf.serializedWrappedKey,
                cid:      sf.cid,
                mimeType: sf.mimeType,
                fileName: sf.originalName,
              })}
              className="px-4 py-2 rounded-lg text-sm font-medium flex-shrink-0
                bg-blue-600 hover:bg-blue-700 text-white
                disabled:opacity-50 transition-all border border-blue-700 shadow-sm"
            >
              {decryptStatus === 'fetching' || decryptStatus === 'unwrapping' || decryptStatus === 'decrypting'
                ? '⟳'
                : '🔓 Decrypt'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
