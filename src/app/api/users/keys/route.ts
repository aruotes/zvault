/**
 * /api/users/keys
 *
 * GET  ?address=0x...  — Fetch the ECDH public key for a given wallet address.
 * POST { walletAddress, publicKey } — Register or update a user's public key.
 *
 * The public key is a P-256 ECDH key in JWK JSON string format.
 * Private keys NEVER touch this API — they stay in the user's IndexedDB.
 *
 * Zod is used for strict validation of all inputs before any DB interaction.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { connectToDatabase, UserModel } from '@/lib/db';

// ── Validation Schemas ────────────────────────────────────────────────────────

/** Ethereum address: 0x followed by exactly 40 hex characters */
const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid Ethereum address (0x + 40 hex chars)')
  .transform((v) => v.toLowerCase());

/**
 * A JWK-encoded P-256 public key, stored as a JSON string.
 * We accept a non-empty string of reasonable length; the caller is responsible
 * for supplying a valid exported JWK (validated at import time by Web Crypto).
 */
const publicKeySchema = z
  .string()
  .min(50,  'publicKey appears too short to be a valid JWK')
  .max(2000, 'publicKey exceeds maximum allowed length');

const postBodySchema = z.object({
  walletAddress: addressSchema,
  publicKey:     publicKeySchema,
});

// ── GET /api/users/keys?address=0x... ─────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const rawAddress = searchParams.get('address') ?? '';

    const parsed = addressSchema.safeParse(rawAddress);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    await connectToDatabase();

    const user = await UserModel.findOne({ walletAddress: parsed.data })
      .select('walletAddress publicKey')
      .lean();

    if (!user) {
      return NextResponse.json(
        { error: 'No public key registered for this address.' },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { walletAddress: user.walletAddress, publicKey: user.publicKey },
      { status: 200 },
    );
  } catch (err) {
    console.error('[ZVault] GET /api/users/keys error:', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}

// ── POST /api/users/keys ──────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = postBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { walletAddress, publicKey } = parsed.data;

    await connectToDatabase();

    // Upsert: create if new, update publicKey if wallet address already exists.
    // This handles key rotation (e.g. user clears IndexedDB and re-registers).
    const user = await UserModel.findOneAndUpdate(
      { walletAddress },
      { walletAddress, publicKey },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );

    return NextResponse.json(
      { walletAddress: user.walletAddress },
      { status: 200 },
    );
  } catch (err) {
    console.error('[ZVault] POST /api/users/keys error:', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 },
    );
  }
}
