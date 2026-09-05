/**
 * ZVault User Mongoose Schema
 *
 * Stores the Ethereum wallet address and its associated ECDH public key
 * for the Explicit Key Registry (PKI). This enables asymmetric key wrapping
 * so any user can encrypt a file key specifically for another user.
 *
 * SECURITY NOTES:
 *  - ONLY the PUBLIC key is stored here. The private key NEVER leaves the
 *    browser and is stored in IndexedDB with extractable:false.
 *  - The publicKey field holds the P-256 ECDH public key in JWK format
 *    (JSON string), which can safely be published.
 *  - walletAddress is stored in lowercase for normalisation and indexed
 *    for O(1) lookups by address.
 */
import 'server-only';
import mongoose, { Schema, Document, Model } from 'mongoose';

// ── TypeScript Interface ──────────────────────────────────────────────────────

export interface IUser extends Document {
  /** Ethereum wallet address (lowercase, e.g. "0xabc...123") */
  walletAddress: string;
  /**
   * P-256 ECDH public key in JWK JSON string format.
   * This is the SPKI/JWK representation exported by Web Crypto API.
   * Never contains private key material.
   */
  publicKey: string;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema Definition ─────────────────────────────────────────────────────────

const UserSchema = new Schema<IUser>(
  {
    walletAddress: {
      type:      String,
      required:  [true, 'walletAddress is required'],
      unique:    true,
      index:     true,
      trim:      true,
      lowercase: true,
      match: [
        /^0x[0-9a-f]{40}$/i,
        'walletAddress must be a valid Ethereum address (0x + 40 hex chars)',
      ],
    },
    publicKey: {
      type:     String,
      required: [true, 'publicKey is required'],
      trim:     true,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

// ── Model Registration (Hot-Reload Safe) ──────────────────────────────────────

const UserModel: Model<IUser> =
  (mongoose.models.User as Model<IUser>) ||
  mongoose.model<IUser>('User', UserSchema);

export default UserModel;
