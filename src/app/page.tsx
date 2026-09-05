'use client';

import { useState, useRef, useEffect, useReducer, useCallback } from 'react';
import { encryptFile, decryptFile, generateAndExportKey } from '@/lib/crypto/core';
import { ConnectButton } from '@rainbow-me/rainbowkit';

// ── Constants ─────────────────────────────────────────────────────────────────

const DUMMY_OWNER = '0x0000000000000000000000000000000000000000';
const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VaultFile {
  _id?: string;
  cid: string;
  originalName: string;
  size: number;
  mimeType: string;
  ownerAddress: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  type: 'success' | 'error' | 'loading';
  message: string;
}
function StatusBadge({ type, message }: StatusBadgeProps) {
  const styles = {
    success: 'bg-emerald-950/60 border-emerald-500/30 text-emerald-300',
    error:   'bg-rose-950/60   border-rose-500/30   text-rose-300',
    loading: 'bg-indigo-950/60 border-indigo-500/30 text-indigo-300',
  };
  const icons = { success: '✓', error: '✕', loading: '⟳' };
  return (
    <div className={`mt-3 px-4 py-3 rounded-lg text-sm font-medium flex items-start gap-2 border ${styles[type]}`}>
      <span className={`mt-0.5 flex-shrink-0 ${type === 'loading' ? 'animate-spin inline-block' : ''}`}>
        {icons[type]}
      </span>
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

interface FileDropzoneProps {
  id: string;
  label: string;
  accept?: string;
  onFile: (file: File) => void;
  currentFile: File | null;
}
function FileDropzone({ id, label, accept, onFile, currentFile }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
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
      className={`cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all duration-200
        ${dragging ? 'border-indigo-400 bg-indigo-950/40 scale-[1.01]'
          : currentFile ? 'border-emerald-500/50 bg-emerald-950/20'
          : 'border-slate-600 hover:border-slate-400 bg-slate-900/40 hover:bg-slate-800/40'}`}
    >
      <input ref={inputRef} id={id} type="file" accept={accept} className="sr-only"
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); }} />
      {currentFile ? (
        <div className="space-y-0.5">
          <p className="text-emerald-400 font-medium text-sm truncate">✓ {currentFile.name}</p>
          <p className="text-slate-500 text-xs">{formatBytes(currentFile.size)} — click or drop to replace</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          <p className="text-slate-400 text-sm font-medium">{label}</p>
          <p className="text-slate-600 text-xs">Click to browse or drag & drop</p>
        </div>
      )}
    </div>
  );
}

// ── Upload Progress Steps ─────────────────────────────────────────────────────

interface UploadStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

function UploadSteps({ steps }: { steps: UploadStep[] }) {
  const colors = {
    pending: 'text-slate-600 border-slate-700',
    active:  'text-indigo-300 border-indigo-500 bg-indigo-950/40',
    done:    'text-emerald-400 border-emerald-600 bg-emerald-950/30',
    error:   'text-rose-400 border-rose-600 bg-rose-950/30',
  };
  const icons = { pending: '○', active: '◉', done: '✓', error: '✕' };
  return (
    <div className="mt-3 space-y-1.5">
      {steps.map((s) => (
        <div key={s.label} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs font-mono transition-all duration-300 ${colors[s.status]}`}>
          <span className={s.status === 'active' ? 'animate-pulse' : ''}>{icons[s.status]}</span>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Encrypt & Upload Pane ─────────────────────────────────────────────────────

interface EncryptUploadPaneProps {
  onUploadComplete: () => void;
}

type Step = { label: string; status: 'pending' | 'active' | 'done' | 'error' };

function EncryptUploadPane({ onUploadComplete }: EncryptUploadPaneProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);

  const setStep = (steps: Step[]) => setSteps(steps);
  const markStep = (
    allSteps: Step[],
    index: number,
    s: Step['status'],
  ): Step[] => allSteps.map((st, i) => i === index ? { ...st, status: s } : st);

  const handleUpload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setStatus(null);

    const initialSteps: Step[] = [
      { label: '① Generate AES-256-GCM key', status: 'pending' },
      { label: '② Encrypt file in browser', status: 'pending' },
      { label: '③ Request presigned upload URL', status: 'pending' },
      { label: '④ Upload encrypted blob to IPFS', status: 'pending' },
      { label: '⑤ Save metadata to database', status: 'pending' },
    ];
    setStep(initialSteps);

    let currentSteps = initialSteps;

    try {
      // ── Step 1: Generate key ──────────────────────────────────────────────
      currentSteps = markStep(currentSteps, 0, 'active');
      setStep([...currentSteps]);
      const keyBase64 = await generateAndExportKey();
      currentSteps = markStep(currentSteps, 0, 'done');
      setStep([...currentSteps]);

      // ── Step 2: Encrypt ───────────────────────────────────────────────────
      currentSteps = markStep(currentSteps, 1, 'active');
      setStep([...currentSteps]);
      const encryptedBlob = await encryptFile(file, keyBase64);
      currentSteps = markStep(currentSteps, 1, 'done');
      setStep([...currentSteps]);

      // Download key file immediately after encryption
      triggerDownload(
        new Blob([keyBase64], { type: 'text/plain' }),
        'secret.key',
      );

      // ── Step 3: Get presigned URL ─────────────────────────────────────────
      currentSteps = markStep(currentSteps, 2, 'active');
      setStep([...currentSteps]);
      const urlRes = await fetch('/api/ipfs/upload-url');
      if (!urlRes.ok) throw new Error('Failed to get upload URL from server.');
      const { url: signedUrl } = await urlRes.json() as { url: string };
      currentSteps = markStep(currentSteps, 2, 'done');
      setStep([...currentSteps]);

      // ── Step 4: Upload directly to Pinata ─────────────────────────────────
      currentSteps = markStep(currentSteps, 3, 'active');
      setStep([...currentSteps]);
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        body: encryptedBlob,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(`IPFS upload failed: ${uploadRes.status} — ${errText.slice(0, 120)}`);
      }
      const uploadData = await uploadRes.json() as { data?: { cid?: string }; cid?: string };
      const cid = uploadData?.data?.cid ?? uploadData?.cid;
      if (!cid) throw new Error('IPFS upload succeeded but no CID was returned.');
      currentSteps = markStep(currentSteps, 3, 'done');
      setStep([...currentSteps]);

      // ── Step 5: Save metadata to MongoDB ──────────────────────────────────
      currentSteps = markStep(currentSteps, 4, 'active');
      setStep([...currentSteps]);
      const metaRes = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cid,
          originalName: file.name,
          size: encryptedBlob.size,
          mimeType: file.type || 'application/octet-stream',
          ownerAddress: DUMMY_OWNER,
        }),
      });
      if (!metaRes.ok) {
        const errJson = await metaRes.json() as { error?: string };
        throw new Error(errJson.error ?? 'Failed to save metadata.');
      }
      currentSteps = markStep(currentSteps, 4, 'done');
      setStep([...currentSteps]);

      setStatus({
        type: 'success',
        message: `File encrypted and pinned to IPFS ✓ CID: ${cid.slice(0, 20)}… Your secret.key was downloaded — keep it safe.`,
      });
      onUploadComplete();
    } catch (err) {
      // Mark last active step as error
      const errSteps = currentSteps.map((s) =>
        s.status === 'active' ? { ...s, status: 'error' as const } : s,
      );
      setStep(errSteps);
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Encrypt & Upload</h2>
        <p className="text-slate-400 text-sm mt-1">
          File is encrypted in your browser then uploaded directly to IPFS. The key never leaves your device.
        </p>
      </div>

      <FileDropzone
        id="encrypt-file-input"
        label="Select a file to encrypt & upload"
        onFile={setFile}
        currentFile={file}
      />

      <button
        id="encrypt-upload-btn"
        onClick={handleUpload}
        disabled={!file || busy}
        className="w-full py-3 px-6 rounded-xl font-semibold text-sm
          bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700
          disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
          text-white transition-all duration-200 shadow-lg shadow-indigo-900/30
          focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-slate-900"
      >
        {busy ? 'Encrypting & uploading…' : '🔒 Encrypt, Upload & Pin to IPFS'}
      </button>

      {steps.length > 0 && <UploadSteps steps={steps} />}
      {status && <StatusBadge type={status.type} message={status.message} />}
    </div>
  );
}

// ── Decrypt Pane ──────────────────────────────────────────────────────────────

function DecryptPane() {
  const [encFile, setEncFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDecrypt = async () => {
    if (!encFile || !keyFile || busy) return;
    setBusy(true);
    setStatus({ type: 'loading', message: 'Extracting IV and decrypting…' });
    try {
      const keyBase64 = (await keyFile.text()).trim();
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
          Upload a <code className="text-indigo-300 text-xs bg-slate-800 px-1 rounded">.bin</code> file and its <code className="text-indigo-300 text-xs bg-slate-800 px-1 rounded">secret.key</code>. Decryption runs entirely in your browser.
        </p>
      </div>

      <FileDropzone id="decrypt-bin-input" label="Upload encrypted .bin file" accept=".bin,application/octet-stream" onFile={setEncFile} currentFile={encFile} />
      <FileDropzone id="decrypt-key-input" label="Upload secret.key" accept=".key,.txt,text/plain" onFile={setKeyFile} currentFile={keyFile} />

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

// Reducer for the async fetch lifecycle — keeps all state transitions in one place
// and removes the need to call multiple setters inside the useEffect body.
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
    case 'LOADING':  return { status: 'loading' };
    case 'SUCCESS':  return { status: 'success', files: action.files };
    case 'ERROR':    return { status: 'error', message: action.message };
  }
}

function VaultList({ refreshTrigger }: VaultListProps) {
  const [fetchState, dispatch] = useReducer(fetchReducer, { status: 'loading' });
  const [downloading, setDownloading] = useState<string | null>(null);
  const [decryptCid, setDecryptCid] = useState<string | null>(null);
  const [decryptStatus, setDecryptStatus] = useState<{ cid: string; type: 'success' | 'error' | 'loading'; message: string } | null>(null);
  // Local retry counter — incrementing it re-runs the fetch effect.
  const [retryCount, setRetryCount] = useState(0);

  const keyInputRef = useRef<HTMLInputElement>(null);

  // Fetch files effect — the synchronous body only starts an async chain.
  // All state mutations happen in async .then()/.catch() via dispatch,
  // which satisfies the react-hooks/set-state-in-effect rule.
  useEffect(() => {
    let cancelled = false;

    fetch('/api/files')
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
  }, [refreshTrigger, retryCount]);

  const handleManualRefresh = () => setRetryCount((n) => n + 1);

  /** Download the encrypted blob from IPFS gateway */
  const downloadEncrypted = async (file: VaultFile) => {
    setDownloading(file.cid);
    try {
      const res = await fetch(`${IPFS_GATEWAY}/${file.cid}`);
      if (!res.ok) throw new Error(`Gateway returned ${res.status}`);
      const blob = await res.blob();
      triggerDownload(blob, `encrypted_${file.originalName}.bin`);
    } catch (err) {
      console.error('IPFS download failed:', err);
    } finally {
      setDownloading(null);
    }
  };

  /** Fetch from IPFS and decrypt in one step */
  const decryptFromIPFS = async (file: VaultFile, key: File) => {
    setDecryptCid(file.cid);
    setDecryptStatus({ cid: file.cid, type: 'loading', message: 'Fetching from IPFS gateway…' });
    try {
      const res = await fetch(`${IPFS_GATEWAY}/${file.cid}`);
      if (!res.ok) throw new Error(`IPFS gateway returned ${res.status}`);
      const encBlob = await res.blob();

      setDecryptStatus({ cid: file.cid, type: 'loading', message: 'Decrypting…' });
      const keyBase64 = (await key.text()).trim();
      const decBlob = await decryptFile(encBlob, keyBase64, file.mimeType);
      triggerDownload(decBlob, `decrypted_${file.originalName}`);
      setDecryptStatus({ cid: file.cid, type: 'success', message: `Decrypted → downloaded as decrypted_${file.originalName}` });
    } catch (err) {
      setDecryptStatus({ cid: file.cid, type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDecryptCid(null);
    }
  };

  const handleKeySelect = (file: VaultFile, key: File) => {
    decryptFromIPFS(file, key);
  };

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
        {fetchState.message} <button onClick={handleManualRefresh} className="ml-2 underline opacity-70 hover:opacity-100">Retry</button>
      </div>
    );
  }

  // TypeScript cannot narrow a discriminated union through an intermediate `const`
  // assignment, so we assert the type here after the status guards above.
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
    <div className="space-y-3">
      {files.map((f: VaultFile) => {
        const status = decryptStatus?.cid === f.cid ? decryptStatus : null;
        const isDecrypting = decryptCid === f.cid;

        return (
          <div key={f.cid} className="rounded-xl bg-slate-900/60 border border-slate-700/50 p-4 transition-all duration-200 hover:border-slate-600/60">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-white font-medium text-sm truncate">{f.originalName}</p>
                <p className="text-slate-500 text-xs mt-0.5 font-mono truncate">
                  {f.cid.slice(0, 28)}…
                </p>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                  <span>{formatBytes(f.size)}</span>
                  <span>·</span>
                  <span>{f.mimeType}</span>
                  <span>·</span>
                  <span>{timeAgo(f.createdAt)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 flex-shrink-0">
                {/* Download encrypted blob */}
                <button
                  id={`download-btn-${f.cid.slice(0, 8)}`}
                  onClick={() => downloadEncrypted(f)}
                  disabled={downloading === f.cid}
                  title="Download encrypted .bin from IPFS"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium
                    bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white
                    disabled:opacity-50 transition-all duration-150 border border-slate-700 hover:border-slate-500"
                >
                  {downloading === f.cid ? '⟳' : '⬇ .bin'}
                </button>

                {/* Decrypt from IPFS — triggers hidden key input */}
                <button
                  id={`decrypt-ipfs-btn-${f.cid.slice(0, 8)}`}
                  onClick={() => { setDecryptCid(f.cid); keyInputRef.current?.click(); }}
                  disabled={isDecrypting}
                  title="Fetch from IPFS and decrypt with your .key file"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium
                    bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-300 hover:text-emerald-200
                    disabled:opacity-50 transition-all duration-150 border border-emerald-700/40 hover:border-emerald-600"
                >
                  {isDecrypting ? '⟳' : '🔓 Decrypt'}
                </button>

                {/* Hidden file input for key — bound to whichever row triggered it */}
                <input
                  ref={keyInputRef}
                  type="file"
                  accept=".key,.txt,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    const key = e.target.files?.[0];
                    const targetFile = files.find((ff: VaultFile) => ff.cid === decryptCid);
                    if (key && targetFile) handleKeySelect(targetFile, key);
                    // Reset so same file can be re-selected
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            {status && (
              <div className="mt-2">
                <StatusBadge type={status.type} message={status.message} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [vaultRefresh, setVaultRefresh] = useState(0);
  const [activeTab, setActiveTab] = useState<'encrypt' | 'decrypt'>('encrypt');

  return (
    <main className="min-h-screen bg-[#09090b] text-white">
      {/* ── Header ── */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-indigo-900/50">Z</div>
            <div>
              <span className="font-bold text-white tracking-tight">ARUOTES </span>
              <span className="font-bold text-indigo-400 tracking-tight">ZVault</span>
            </div>
          </div>
          {/* RainbowKit connect button — Phase 4 wallet integration */}
          <ConnectButton
            showBalance={{ smallScreen: false, largeScreen: true }}
            chainStatus={{ smallScreen: 'icon', largeScreen: 'full' }}
            accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
          />
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-6 pt-12 pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-950/60 border border-indigo-500/20 text-indigo-300 text-xs font-medium mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          Phase 4 — Wallet Auth · Hybrid PKI · Smart Contract
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">
          Zero-Knowledge{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
            Decentralised Vault
          </span>
        </h1>
        <p className="text-slate-400 text-base max-w-2xl mx-auto">
          Files are encrypted in your browser, uploaded directly to IPFS, and indexed by metadata only. Keys never leave your device.
        </p>
      </section>

      {/* ── Feature Strip ── */}
      <section className="max-w-6xl mx-auto px-6 mb-10">
        <div className="grid grid-cols-4 gap-3">
          {[
            { icon: '🔑', title: 'AES-256-GCM', desc: 'Client-side only' },
            { icon: '🌐', title: 'IPFS Storage', desc: 'Direct to Pinata' },
            { icon: '🗄️', title: 'MongoDB', desc: 'Metadata only' },
            { icon: '🔒', title: 'Zero-knowledge', desc: 'No keys on server' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 text-center">
              <div className="text-xl mb-1.5">{icon}</div>
              <p className="text-white text-xs font-semibold">{title}</p>
              <p className="text-slate-500 text-xs mt-0.5">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Main Grid ── */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Left Column: Encrypt/Decrypt tabs ── */}
          <div className="space-y-4">
            {/* Tab Switcher */}
            <div className="flex rounded-xl bg-slate-900/60 border border-slate-700/50 p-1 gap-1">
              <button
                id="tab-encrypt"
                onClick={() => setActiveTab('encrypt')}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200
                  ${activeTab === 'encrypt'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              >
                🔒 Encrypt & Upload
              </button>
              <button
                id="tab-decrypt"
                onClick={() => setActiveTab('decrypt')}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200
                  ${activeTab === 'decrypt'
                    ? 'bg-emerald-700 text-white shadow-lg shadow-emerald-900/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              >
                🔓 Decrypt Local
              </button>
            </div>

            {/* Tab Content */}
            <div className="rounded-2xl bg-slate-900/60 border border-slate-700/50 p-6 backdrop-blur-sm shadow-xl shadow-black/30">
              {activeTab === 'encrypt'
                ? <EncryptUploadPane onUploadComplete={() => setVaultRefresh((n) => n + 1)} />
                : <DecryptPane />}
            </div>
          </div>

          {/* ── Right Column: Vault ── */}
          <div className="rounded-2xl bg-slate-900/60 border border-slate-700/50 p-6 backdrop-blur-sm shadow-xl shadow-black/30">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-xl font-semibold text-white">Your Vault</h2>
                <p className="text-slate-400 text-sm mt-0.5">
                  Files stored on IPFS · metadata in MongoDB
                </p>
              </div>
              <button
                id="refresh-vault-btn"
                onClick={() => setVaultRefresh((n) => n + 1)}
                title="Refresh vault"
                className="text-slate-500 hover:text-white transition-colors text-lg"
              >
                ⟳
              </button>
            </div>
            <VaultList refreshTrigger={vaultRefresh} />
          </div>
        </div>

        {/* Warning Banner */}
        <div className="mt-6 flex items-start gap-3 rounded-xl bg-amber-950/30 border border-amber-500/20 p-4">
          <span className="text-amber-400 text-lg mt-0.5">⚠</span>
          <p className="text-amber-200/80 text-xs leading-relaxed">
            <strong className="text-amber-300">Phase 2 — Development Mode.</strong>{' '}
            Wallet authentication is not yet implemented. All files are currently stored under a dummy owner address.
            Phase 3 will add wallet-signature verification before accepting uploads.
            The server never sees or stores encryption keys — your files are zero-knowledge by design.
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-800 py-6">
        <p className="text-center text-slate-600 text-xs font-mono">
          ARUOTES ZVault · Phase 2 · Next.js 16 · AES-256-GCM · IPFS (Pinata) · MongoDB
        </p>
      </footer>
    </main>
  );
}
