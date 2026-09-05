/**
 * ZVault File Mongoose Schema
 *
 * ⚠️  ZERO-KNOWLEDGE DESIGN:
 * This schema MUST NOT store encryption keys, IVs, passphrases, or any
 * derivative of key material. The IV is prepended to the ciphertext and
 * lives inside the encrypted Blob on IPFS — never in this database.
 *
 * Fields deliberately omitted:
 *   - encryptionKey / iv    → Zero-knowledge: server never touches key material
 *   - shareToken            → Phase 3: Encrypted sharing links
 *   - isDeleted             → Phase 3: Lifecycle management
 */
import 'server-only';
import mongoose, { Schema, Document, Model } from 'mongoose';

// ── TypeScript Interface ──────────────────────────────────────────────────────

export interface IFile extends Document {
  /** IPFS CIDv1 (base32) — globally unique content identifier */
  cid: string;
  /** Original filename before encryption (e.g. "report.pdf") */
  originalName: string;
  /** Size in bytes of the ENCRYPTED blob (plaintext + 12-byte IV + 16-byte GCM tag) */
  size: number;
  /** MIME type of the original file (e.g. "application/pdf") */
  mimeType: string;
  /**
   * Ethereum wallet address of the file uploader.
   * Phase 2: populated with dummy address "0x000...000" until wallet auth lands.
   * Phase 3: verified via signed message before accepting uploads.
   */
  ownerAddress: string;
  /** Auto-managed by Mongoose { timestamps: true } */
  createdAt: Date;
  updatedAt: Date;
  /**
   * Set to true after the server verifies the on-chain FileRegistered event
   * via the PATCH /api/files/[cid] route.
   * Files with onChainRegistered === false show a "Registration Pending" badge.
   */
  onChainRegistered: boolean;
  /**
   * The on-chain bytes32 fileId (keccak256 of the CID).
   * null until registerFile() tx is confirmed and verified server-side.
   */
  fileId: string | null;
}

// ── Schema Definition ─────────────────────────────────────────────────────────

const FileSchema = new Schema<IFile>(
  {
    cid: {
      type: String,
      required: [true, 'CID is required'],
      unique: true,
      index: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: [true, 'originalName is required'],
      maxlength: [255, 'originalName must be 255 characters or fewer'],
      trim: true,
    },
    size: {
      type: Number,
      required: [true, 'size is required'],
      min: [0, 'size must be non-negative'],
    },
    mimeType: {
      type: String,
      required: [true, 'mimeType is required'],
      maxlength: [127, 'mimeType must be 127 characters or fewer'],
      default: 'application/octet-stream',
      trim: true,
    },
    ownerAddress: {
      type: String,
      required: [true, 'ownerAddress is required'],
      trim: true,
      lowercase: true,
    },
    onChainRegistered: {
      type:    Boolean,
      default: false,
    },
    fileId: {
      type:    String,
      default: null,
      trim:    true,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
    collection: 'files',
  },
);

// ── Model Registration (Hot-Reload Safe) ──────────────────────────────────────

/**
 * Re-use the existing model if already compiled (prevents OverwriteModelError
 * during Next.js hot-reloads in development).
 */
const FileModel: Model<IFile> =
  (mongoose.models.File as Model<IFile>) ||
  mongoose.model<IFile>('File', FileSchema);

export default FileModel;
