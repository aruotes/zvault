'use client';

import {
  useState, useRef, useEffect, useReducer, useCallback,
} from 'react';
import { encryptFile, decryptFile, generateAndExportKey } from '@/lib/crypto/core';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useKeyOnboarding }     from '@/hooks/useKeyOnboarding';
import { useRegisterFile }      from '@/hooks/useRegisterFile';
import { ConnectPromptOverlay } from '@/components/features/ConnectPromptOverlay';
import { ShareModal }           from '@/components/features/ShareModal';
import { SharedWithMePane }     from '@/components/features/SharedWithMePane';
import { SEPOLIA_CHAIN_ID }     from '@/lib/web3/contracts';

// ── Constants ─────────────────────────────────────────────────────────────────

const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VaultFile {
  _id?:          string;
  cid:           string;
  originalName:  string;
  size:          number;
  mimeType:      string;
  ownerAddress:  string;
  createdAt:     string;
  onChainRegistered: boolean;
  fileId:        string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k     = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i     = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  type: 'success' | 'error' | 'loading';
  message: string;
}
function StatusBadge({ type, message }: StatusBadgeProps) {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error:   'bg-rose-50 border-rose-200 text-rose-800',
    loading: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  const icons = { success: '✓', error: '✕', loading: '⟳' };
  return (
    <div className={`mt-3 px-4 py-3 rounded-lg text-sm flex items-start gap-2 border shadow-sm ${styles[type]}`}>
      <span className={`mt-0.5 flex-shrink-0 ${type === 'loading' ? 'animate-spin inline-block' : 'font-medium'}`}>
        {icons[type]}
      </span>
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

interface FileDropzoneProps {
  id:          string;
  label:       string;
  accept?:     string;
  onFile:      (file: File) => void;
  currentFile: File | null;
}
function FileDropzone({ id, label, accept, onFile, currentFile }: FileDropzoneProps) {
  const inputRef              = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all duration-200
        ${dragging    ? 'border-blue-400 bg-blue-50 scale-[1.01]'
          : currentFile ? 'border-emerald-400 bg-emerald-50'
          : 'border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 shadow-sm'}`}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }}
      />
      {currentFile ? (
        <div className="space-y-1">
          <p className="text-emerald-700 font-medium text-sm truncate">✓ {currentFile.name}</p>
          <p className="text-slate-500 text-xs">{formatBytes(currentFile.size)} — click or drop to replace</p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-slate-700 text-sm font-medium">{label}</p>
          <p className="text-slate-500 text-xs">Click to browse or drag & drop</p>
        </div>
      )}
    </div>
  );
}

interface UploadProgressProps {
  progress: number;
  statusText: string;
  isError?: boolean;
}

function UploadProgress({ progress, statusText, isError }: UploadProgressProps) {
  if (progress === 0 && !isError) return null;

  return (
    <div className="mt-3 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-slate-700 font-medium">
          {!isError && progress < 100 && <span className="animate-spin text-blue-600">⟳</span>}
          {!isError && progress === 100 && <span className="text-emerald-600 font-bold">✓</span>}
          {isError && <span className="text-rose-600 font-bold">✕</span>}
          <span>{statusText}</span>
        </div>
        <span className="text-slate-400 text-xs font-medium">{Math.round(progress)}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
        <div 
          className={`h-full transition-all duration-300 ${isError ? 'bg-rose-500' : progress === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`}
          style={{ width: `${progress}%` }} 
        />
      </div>
    </div>
  );
}

// ── Key Onboarding Banner ─────────────────────────────────────────────────────

function KeyOnboardingBanner() {
  const { status, error, retry } = useKeyOnboarding();

  if (status === 'idle' || status === 'ready') return null;

  if (status === 'error') {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-rose-950/30 border border-rose-500/20 px-4 py-3">
        <span className="text-rose-400 text-sm">✕</span>
        <p className="text-rose-300 text-xs flex-1">
          Failed to initialise your encryption key: {error}
        </p>
        <button
          onClick={retry}
          className="text-rose-300 underline text-xs flex-shrink-0"
        >Retry</button>
      </div>
    );
  }

  const label = status === 'generating'
    ? 'Generating your P-256 ECDH keypair…'
    : 'Syncing public key to ZVault registry…';

  return (
    <div className="flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 shadow-sm">
      <span className="text-blue-600 text-sm animate-spin">⟳</span>
      <p className="text-blue-800 text-xs font-medium">{label}</p>
    </div>
  );
}

// ── Network Gate Banner ───────────────────────────────────────────────────────

function NetworkGateBanner() {
  const chainId       = useChainId();
  const { switchChain } = useSwitchChain();
  const { isConnected } = useAccount();

  if (!isConnected || chainId === SEPOLIA_CHAIN_ID) return null;

  return (
    <div className="flex items-center justify-between rounded-xl bg-amber-950/30
      border border-amber-500/20 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-400">⚠</span>
        <p className="text-amber-200/80 text-xs">
          <strong className="text-amber-300">Wrong network.</strong>{' '}
          ZVault requires Ethereum Sepolia for uploads and sharing.
        </p>
      </div>
      <button
        id="switch-network-btn"
        onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
        className="ml-4 flex-shrink-0 px-3 py-1 rounded-lg bg-amber-500/20
          hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition-colors"
      >Switch</button>
    </div>
  );
}

// ── Encrypt & Upload Pane ─────────────────────────────────────────────────────

interface EncryptUploadPaneProps {
  onUploadComplete: () => void;
}

function EncryptUploadPane({ onUploadComplete }: EncryptUploadPaneProps) {
  const { address, isConnected } = useAccount();
  const chainId                  = useChainId();
  const { registerFile }         = useRegisterFile();

  const [file,       setFile]       = useState<File | null>(null);
  const [isLoading,  setIsLoading]  = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [statusText, setStatusText] = useState('');
  
  const [status,     setStatus]     = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Persist last keyBase64 + fileId in memory for ShareModal (same session)
  const [lastKey,    setLastKey]    = useState<string | undefined>(undefined);
  const [lastFileId, setLastFileId] = useState<`0x${string}` | undefined>(undefined);
  const [shareOpen,  setShareOpen]  = useState(false);
  const [lastFileName, setLastFileName] = useState('');

  const isWrongNetwork = isConnected && chainId !== SEPOLIA_CHAIN_ID;

  const handleUpload = async () => {
    if (!file || isLoading || !address) return;
    setIsLoading(true);
    setProgress(0);
    setStatusText('');
    setStatus(null);
    setLastKey(undefined);
    setLastFileId(undefined);

    try {
      // ── Step 1: Generate key ──────────────────────────────────────────────
      setStatusText('Generating AES-256-GCM key');
      setProgress(10);
      const keyBase64 = await generateAndExportKey();

      // ── Step 2: Encrypt ───────────────────────────────────────────────────
      setStatusText('Encrypting file locally');
      setProgress(25);
      const encryptedBlob = await encryptFile(file, keyBase64);

      // ── Step 3: Get presigned URL ─────────────────────────────────────────
      setStatusText('Requesting secure upload URL');
      setProgress(40);
      const urlRes = await fetch('/api/ipfs/upload-url');
      if (!urlRes.ok) throw new Error('Failed to get upload URL from server.');
      const { url: signedUrl } = await urlRes.json() as { url: string };

      // ── Step 4: Upload to Pinata via signed URL ──────────────────────────
      setStatusText('Pinning to decentralized storage');
      setProgress(55);

      const formData = new FormData();
      formData.append(
        'file',
        new File([encryptedBlob], 'encrypted.bin', { type: 'application/octet-stream' }),
      );
      formData.append('network', 'public');

      const uploadRes = await fetch(signedUrl, {
        method: 'POST',
        body:   formData,
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`IPFS upload failed: ${uploadRes.status} — ${errText.slice(0, 200)}`);
      }
      const uploadData = await uploadRes.json() as { data?: { cid?: string; id?: string } };
      const cid = uploadData?.data?.cid;
      if (!cid) throw new Error('IPFS upload succeeded but Pinata returned no CID.');

      // ── Step 5: Save metadata to MongoDB ──────────────────────────────────
      setStatusText('Saving metadata');
      setProgress(70);
      const metaRes = await fetch('/api/files', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          cid,
          originalName: file.name,
          size:         encryptedBlob.size,
          mimeType:     file.type || 'application/octet-stream',
          ownerAddress: address,
        }),
      });
      if (!metaRes.ok) {
        const errJson = await metaRes.json() as { error?: string };
        throw new Error(errJson.error ?? 'Failed to save metadata.');
      }

      // ── Step 6: Register on Sepolia (Wagmi writeContractAsync) ────────────
      setStatusText('Securing proofs on-chain');
      setProgress(85);
      const { fileId, txHash } = await registerFile(cid);
      console.log('[ZVault] registerFile confirmed. txHash:', txHash, 'fileId:', fileId);

      // ── Step 7: Finalizing ────────────────────────────────────────────────
      setStatusText('Finalizing encryption keys');
      setProgress(100);
      triggerDownload(new Blob([keyBase64], { type: 'text/plain' }), 'secret.key');

      // Persist in memory for same-session ShareModal
      setLastKey(keyBase64);
      setLastFileId(fileId);
      setLastFileName(file.name);

      setStatus({
        type:    'success',
        message: `File encrypted, pinned & registered on Sepolia ✓  CID: ${cid.slice(0, 20)}… Your secret.key was downloaded — keep it safe.`,
      });
      onUploadComplete();
    } catch (err) {
      setProgress(0);
      setStatusText('');
      setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Upload to ZVault</h2>
        <p className="text-slate-500 text-sm mt-1 leading-relaxed">
          Your files are End-to-End Encrypted locally on your device before they are pinned to IPFS and registered on the blockchain.
        </p>
      </div>

      <FileDropzone
        id="encrypt-file-input"
        label="Select a file to encrypt & upload"
        onFile={setFile}
        currentFile={file}
      />

      {/* Wrong network warning (QA Fix D) */}
      {isWrongNetwork && (
        <p className="text-amber-300 text-xs text-center">
          ⚠ Switch to Sepolia to register files on-chain.
        </p>
      )}

      <button
        id="encrypt-upload-btn"
        onClick={handleUpload}
        disabled={!file || isLoading || !isConnected}
        className="w-full py-3.5 px-6 rounded-xl font-medium text-sm
          bg-blue-600 hover:bg-blue-700 active:bg-blue-800
          disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed
          text-white transition-all shadow-sm
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {isLoading ? (statusText || 'Processing...') : 'Upload Securely'}
      </button>

      {/* Share button — visible after successful upload in same session */}
      {lastFileId && lastKey && status?.type === 'success' && (
        <button
          id="share-file-btn"
          onClick={() => setShareOpen(true)}
          className="w-full py-3 px-6 rounded-xl font-medium text-sm
            bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors
            shadow-sm"
        >
          Share Access
        </button>
      )}

      {(progress > 0 || status?.type === 'error') && (
        <UploadProgress 
          progress={progress} 
          statusText={status?.type === 'error' ? 'Upload failed' : statusText} 
          isError={status?.type === 'error'} 
        />
      )}
      {status && <StatusBadge type={status.type} message={status.message} />}

      {/* Share modal — receives in-memory key (no re-upload needed) */}
      {lastFileId && (
        <ShareModal
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          fileName={lastFileName}
          fileId={lastFileId}
          keyBase64={lastKey}
        />
      )}
    </div>
  );
}

// ── Decrypt Pane ──────────────────────────────────────────────────────────────

function DecryptPane() {
  const [encFile, setEncFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [status,  setStatus]  = useState<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null);
  const [busy,    setBusy]    = useState(false);

  const handleDecrypt = async () => {
    if (!encFile || !keyFile || busy) return;
    setBusy(true);
    setStatus({ type: 'loading', message: 'Extracting IV and decrypting…' });
    try {
      const keyBase64    = (await keyFile.text()).trim();
      const decryptedBlob = await decryptFile(encFile, keyBase64);
      const originalName = encFile.name.replace(/^encrypted_/, '').replace(/\.bin$/, '');
      triggerDownload(decryptedBlob, `decrypted_${originalName}`);
      setStatus({ type: 'success', message: `Decrypted successfully → downloaded as decrypted_${originalName}` });
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Decrypt Local File</h2>
        <p className="text-slate-400 text-sm mt-1">
          Upload a <code className="text-indigo-300 text-xs bg-slate-800 px-1 rounded">.bin</code> file
          and its <code className="text-indigo-300 text-xs bg-slate-800 px-1 rounded">secret.key</code>.
          Decryption runs entirely in your browser.
        </p>
      </div>

      <FileDropzone id="decrypt-bin-input" label="Upload encrypted .bin file"
        accept=".bin,application/octet-stream" onFile={setEncFile} currentFile={encFile} />
      <FileDropzone id="decrypt-key-input" label="Upload secret.key"
        accept=".key,.txt,text/plain" onFile={setKeyFile} currentFile={keyFile} />

      <button
        id="decrypt-btn"
        onClick={handleDecrypt}
        disabled={!encFile || !keyFile || busy}
        className="w-full py-3 px-6 rounded-xl font-semibold text-sm
          bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800
          disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
          text-white transition-all duration-200 shadow-lg shadow-emerald-900/30
          focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 focus:ring-offset-slate-900"
      >
        {busy ? 'Decrypting…' : '🔓 Decrypt & Restore'}
      </button>

      {status && <StatusBadge type={status.type} message={status.message} />}
    </div>
  );
}

// ── Vault File List ───────────────────────────────────────────────────────────

interface VaultListProps {
  refreshTrigger: number;
}

type FetchState =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; files: VaultFile[] }
  | { status: 'error'; message: string };

type FetchAction =
  | { type: 'LOADING' }
  | { type: 'SUCCESS'; files: VaultFile[] }
  | { type: 'ERROR'; message: string };

function fetchReducer(_state: FetchState, action: FetchAction): FetchState {
  switch (action.type) {
    case 'LOADING': return { status: 'loading' };
    case 'SUCCESS': return { status: 'success', files: action.files };
    case 'ERROR':   return { status: 'error', message: action.message };
  }
}

function VaultList({ refreshTrigger }: VaultListProps) {
  const { address, isConnected }  = useAccount();
  const [fetchState, dispatch] = useReducer(fetchReducer, { status: 'loading' });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [decryptCid,  setDecryptCid]  = useState<string | null>(null);
  const [decryptStatus, setDecryptStatus] = useState<{
    cid: string; type: 'success' | 'error' | 'loading'; message: string;
  } | null>(null);
  const [retryCount,  setRetryCount]  = useState(0);
  const [shareTarget, setShareTarget] = useState<VaultFile | null>(null);

  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    if (!isConnected || !address) {
      dispatch({ type: 'SUCCESS', files: [] });
      setDecryptCid(null);
      setDecryptStatus(null);
      setDownloading(null);
      setShareTarget(null);
      return;
    }

    dispatch({ type: 'LOADING' });

    const url = address
      ? `/api/files?owner=${encodeURIComponent(address.toLowerCase())}`
      : '/api/files';

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load files from server.');
        return res.json() as Promise<{ files: VaultFile[] }>;
      })
      .then((data) => {
        if (!cancelled) dispatch({ type: 'SUCCESS', files: data.files });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : 'Unknown error.' });
      });

    return () => { cancelled = true; };
  }, [refreshTrigger, retryCount, address, isConnected]);

  const handleManualRefresh = () => setRetryCount((n) => n + 1);

  const downloadEncrypted = async (file: VaultFile) => {
    setDownloading(file.cid);
    try {
      const res  = await fetch(`${IPFS_GATEWAY}/${file.cid}`);
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const blob = await res.blob();
      triggerDownload(blob, `encrypted_${file.originalName}.bin`);
    } catch (err) {
      console.error('IPFS download failed:', err);
    } finally {
      setDownloading(null);
    }
  };

  const decryptFromIPFS = async (file: VaultFile, key: File) => {
    setDecryptCid(file.cid);
    setDecryptStatus({ cid: file.cid, type: 'loading', message: 'Fetching from IPFS gateway…' });
    try {
      const res    = await fetch(`${IPFS_GATEWAY}/${file.cid}`);
      if (!res.ok) throw new Error(`IPFS gateway returned ${res.status}`);
      const encBlob = await res.blob();

      setDecryptStatus({ cid: file.cid, type: 'loading', message: 'Decrypting…' });
      const keyBase64 = (await key.text()).trim();
      const decBlob   = await decryptFile(encBlob, keyBase64, file.mimeType);
      triggerDownload(decBlob, `decrypted_${file.originalName}`);
      setDecryptStatus({ cid: file.cid, type: 'success', message: `Decrypted → downloaded as decrypted_${file.originalName}` });
    } catch (err) {
      setDecryptStatus({ cid: file.cid, type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDecryptCid(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="text-center py-14 text-slate-500">
        <p className="text-4xl mb-4">🔒</p>
        <p className="text-base">Please connect your wallet to view your Vault.</p>
      </div>
    );
  }

  if (fetchState.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-slate-500">
        <span className="animate-spin">⟳</span>
        <span className="text-sm">Loading vault…</span>
      </div>
    );
  }

  if (fetchState.status === 'error') {
    return (
      <div className="rounded-xl bg-rose-950/30 border border-rose-500/20 p-4 text-rose-300 text-sm text-center">
        {fetchState.message}
        <button onClick={handleManualRefresh} className="ml-2 underline opacity-70 hover:opacity-100">Retry</button>
      </div>
    );
  }

  const files = (fetchState as { status: 'success'; files: VaultFile[] }).files;

  if (files.length === 0) {
    return (
      <div className="text-center py-14 text-slate-600">
        <p className="text-3xl mb-3">🗄️</p>
        <p className="text-sm">Your vault is empty. Encrypt and upload a file to get started.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {files.map((f: VaultFile) => {
          const dStatus     = decryptStatus?.cid === f.cid ? decryptStatus : null;
          const isDecrypting = decryptCid === f.cid;

          return (
            <div key={f.cid}
              className="rounded-xl bg-white border border-slate-200 p-5 shadow-sm
                transition-all duration-200 hover:border-blue-300 hover:shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="text-slate-800 font-semibold text-base truncate">{f.originalName}</p>
                    {/* Registration status badge */}
                    {f.onChainRegistered ? (
                      <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold uppercase tracking-wider">
                        Secured
                      </span>
                    ) : (
                      <span className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold uppercase tracking-wider">
                        Pending
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 text-sm text-slate-500">
                    <span className="font-medium text-slate-700">{formatBytes(f.size)}</span>
                    <span>·</span>
                    <span>{f.mimeType}</span>
                    <span>·</span>
                    <span>{timeAgo(f.createdAt)}</span>
                  </div>
                  
                  <details className="mt-3 text-xs text-slate-500 cursor-pointer group">
                    <summary className="font-medium text-blue-600 hover:text-blue-700 outline-none select-none">
                      Technical Proofs
                    </summary>
                    <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono space-y-1.5 break-all">
                      <p><strong className="text-slate-400 font-medium">IPFS CID:</strong> <br/>{f.cid}</p>
                      {f.fileId && <p><strong className="text-slate-400 font-medium">FileID (On-Chain):</strong> <br/>{f.fileId}</p>}
                    </div>
                  </details>
                </div>

                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button
                    id={`download-btn-${f.cid.slice(0, 8)}`}
                    onClick={() => downloadEncrypted(f)}
                    disabled={downloading === f.cid}
                    title="Download encrypted .bin from IPFS"
                    className="px-4 py-2 rounded-lg text-sm font-medium
                      bg-white hover:bg-slate-50 text-slate-700
                      disabled:opacity-50 transition-all border border-slate-300 shadow-sm"
                  >
                    {downloading === f.cid ? '⟳' : '⬇ Encrypted'}
                  </button>

                  <button
                    id={`decrypt-ipfs-btn-${f.cid.slice(0, 8)}`}
                    onClick={() => { setDecryptCid(f.cid); keyInputRef.current?.click(); }}
                    disabled={isDecrypting}
                    title="Fetch from IPFS and decrypt with your .key file"
                    className="px-4 py-2 rounded-lg text-sm font-medium
                      bg-emerald-600 hover:bg-emerald-700 text-white
                      disabled:opacity-50 transition-all border border-emerald-700 shadow-sm"
                  >
                    {isDecrypting ? '⟳' : '🔓 Decrypt'}
                  </button>

                  {/* Share button */}
                  {f.onChainRegistered && f.fileId && (
                    <button
                      id={`share-btn-${f.cid.slice(0, 8)}`}
                      onClick={() => setShareTarget(f)}
                      title="Share access with another wallet"
                      className="px-4 py-2 rounded-lg text-sm font-medium
                        bg-blue-600 hover:bg-blue-700 text-white
                        transition-all border border-blue-700 shadow-sm"
                    >
                      Share
                    </button>
                  )}
                </div>
              </div>

              {dStatus && (
                <div className="mt-3">
                  <StatusBadge type={dStatus.type} message={dStatus.message} />
                </div>
              )}
            </div>
          );
        })}

        {/* Hidden key input — shared across all rows */}
        <input
          ref={keyInputRef}
          type="file"
          accept=".key,.txt,text/plain"
          className="sr-only"
          onChange={(e) => {
            const key        = e.target.files?.[0];
            const targetFile = files.find((ff: VaultFile) => ff.cid === decryptCid);
            if (key && targetFile) decryptFromIPFS(targetFile, key);
            e.target.value = '';
          }}
        />
      </div>

      {/* Share modal from vault list — no key in memory, user must upload secret.key */}
      {shareTarget && shareTarget.fileId && (
        <ShareModal
          isOpen={!!shareTarget}
          onClose={() => setShareTarget(null)}
          fileName={shareTarget.originalName}
          fileId={shareTarget.fileId as `0x${string}`}
          keyBase64={undefined}  // QA Fix F: triggers key dropzone in modal
        />
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { isConnected }    = useAccount();
  const [vaultRefresh,  setVaultRefresh]  = useState(0);
  const [activeTab,     setActiveTab]     = useState<'encrypt' | 'decrypt' | 'shared'>('encrypt');

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">

      {/* ── Header ── */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center
              text-white text-sm font-bold shadow-sm">Z</div>
            <div>
              <span className="font-bold text-slate-800 tracking-tight text-lg">ARUOTES </span>
              <span className="font-medium text-slate-500 tracking-tight text-lg">ZVault</span>
            </div>
          </div>
          <ConnectButton
            showBalance={{ smallScreen: false, largeScreen: true }}
            chainStatus={{ smallScreen: 'icon', largeScreen: 'full' }}
            accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
          />
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-10 text-center">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 mb-4">
          The Zero-Knowledge <span className="text-blue-600">Secure Vault</span>
        </h1>
        <p className="text-slate-500 text-lg max-w-2xl mx-auto">
          Files are encrypted in your browser, pinned to decentralized storage, and secured on the blockchain. Keys never leave your device.
        </p>
      </section>

      {/* ── Feature Strip ── */}
      <section className="max-w-6xl mx-auto px-6 mb-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: '🔒', title: 'End-to-End Encrypted', desc: 'Keys never leave your device' },
            { icon: '☁️', title: 'Decentralized Storage', desc: 'Securely pinned to IPFS' },
            { icon: '⛓️', title: 'Immutable Proofs', desc: 'Verified on Ethereum Sepolia' },
            { icon: '🤝', title: 'Secure Sharing', desc: 'Zero-knowledge access control' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="rounded-2xl bg-white border border-slate-200 p-5 text-center shadow-sm">
              <div className="text-2xl mb-2">{icon}</div>
              <p className="text-slate-800 text-sm font-bold">{title}</p>
              <p className="text-slate-500 text-xs mt-1 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Status Banners ── */}
      <section className="max-w-6xl mx-auto px-6 mb-4 space-y-2">
        <KeyOnboardingBanner />
        <NetworkGateBanner />
      </section>

      {/* ── Main Grid ── */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Left Column: Tabs ── */}
          <div className="space-y-4">
            {/* Tab Switcher */}
            <div className="flex rounded-xl bg-slate-200/50 p-1.5 gap-1 border border-slate-200">
              {([
                { key: 'encrypt', label: 'Upload', active: 'bg-white text-slate-900 shadow-sm font-semibold' },
                { key: 'decrypt', label: 'Decrypt',    active: 'bg-white text-slate-900 shadow-sm font-semibold' },
                { key: 'shared',  label: 'Shared with Me',   active: 'bg-white text-slate-900 shadow-sm font-semibold' },
              ] as const).map(({ key, label, active }) => (
                <button
                  key={key}
                  id={`tab-${key}`}
                  onClick={() => setActiveTab(key)}
                  className={`flex-1 py-2.5 px-3 rounded-lg text-sm transition-all duration-200
                    ${activeTab === key ? active : 'text-slate-500 hover:text-slate-800 hover:bg-white/60 font-medium'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="rounded-2xl bg-white border border-slate-200 p-8 shadow-sm relative min-h-[400px]">
              {!isConnected && activeTab !== 'decrypt' && <ConnectPromptOverlay />}

              {activeTab === 'encrypt' && (
                <EncryptUploadPane onUploadComplete={() => setVaultRefresh(n => n + 1)} />
              )}
              {activeTab === 'decrypt' && <DecryptPane />}
              {activeTab === 'shared'  && <SharedWithMePane />}
            </div>
          </div>

          {/* ── Right Column: Vault ── */}
          <div className="rounded-2xl bg-white border border-slate-200 p-8 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-slate-800 tracking-tight">Your Vault</h2>
                <p className="text-slate-500 text-sm mt-1">
                  Securely stored and verified
                </p>
              </div>
              <button
                id="refresh-vault-btn"
                onClick={() => setVaultRefresh(n => n + 1)}
                title="Refresh vault"
                className="text-slate-500 hover:text-white transition-colors text-lg"
              >⟳</button>
            </div>
            <VaultList refreshTrigger={vaultRefresh} />
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-8 flex items-start gap-3 rounded-xl bg-blue-50 border border-blue-100 p-5 shadow-sm">
          <span className="text-blue-500 text-xl">🛡️</span>
          <p className="text-slate-600 text-sm leading-relaxed">
            <strong className="text-slate-800">Secure Architecture.</strong>{' '}
            Your files are strictly encrypted client-side using AES-256-GCM. Metadata is anchored immutably to Ethereum Sepolia via <code className="text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded text-xs">FileRegistry.sol</code>. Zero-knowledge access sharing uses ECIES—meaning our servers never see your encryption keys.
            <br/>
            <a href={`https://sepolia.etherscan.io/address/0x360C4b995537f6988CA1591Fb7678235b7f0e2AB`}
              target="_blank" rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700 underline font-medium mt-2 inline-block">
              View Smart Contract on Etherscan →
            </a>
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 py-8 bg-white mt-auto">
        <p className="text-center text-slate-500 text-sm">
          &copy; 2026 ARUOTES ZVault. Secure decentralized storage.
        </p>
      </footer>
    </main>
  );
}
