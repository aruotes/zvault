/**
 * /api/files
 *
 * POST — Persist file metadata after a successful direct IPFS upload.
 * GET  — Retrieve the list of all uploaded files.
 *
 * Note on ownership: Phase 2 uses a dummy ownerAddress passed from the client.
 * Phase 3 will replace this with verified wallet signature authentication.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { connectToDatabase, FileModel } from '@/lib/db';

// ── Zod Validation Schema ─────────────────────────────────────────────────────

const createFileSchema = z.object({
  /** IPFS CIDv1 — base32 content identifier */
  cid: z
    .string()
    .min(1, 'cid is required')
    .refine(
      (v) => v.startsWith('baf') || v.startsWith('Qm'),
      'cid must be a valid IPFS CID (CIDv1 starts with "baf", CIDv0 with "Qm")',
    ),
  originalName: z
    .string()
    .min(1, 'originalName is required')
    .max(255, 'originalName must be 255 chars or fewer'),
  size: z
    .number({ invalid_type_error: 'size must be a number' })
    .int('size must be an integer')
    .nonnegative('size must be non-negative'),
  mimeType: z
    .string()
    .min(1, 'mimeType is required')
    .max(127, 'mimeType must be 127 chars or fewer'),
  ownerAddress: z
    .string()
    .min(1, 'ownerAddress is required'),
});

// ── POST /api/files ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Parse and validate request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = createFileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join('; ') },
        { status: 400 },
      );
    }

    const { cid, originalName, size, mimeType, ownerAddress } = parsed.data;

    // 2. Connect to MongoDB (returns cached connection if warm)
    await connectToDatabase();

    // 3. Persist metadata (server throws on duplicate CID via unique index)
    const file = await FileModel.create({
      cid,
      originalName,
      size,
      mimeType,
      ownerAddress,
    });

    return NextResponse.json(
      { id: String(file._id), cid: file.cid },
      { status: 201 },
    );
  } catch (err: unknown) {
    // Duplicate CID — MongoDB unique index violation (code 11000).
    // MongoDB driver exposes `code` as a number on write errors.
    const mongoErr = err as { code?: number };
    if (mongoErr?.code === 11000) {
      return NextResponse.json(
        { error: 'A file with this CID already exists.' },
        { status: 409 },
      );
    }

    console.error('[ZVault] POST /api/files error:', err);
    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 },
    );
  }
}

// ── GET /api/files ────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    await connectToDatabase();

    const files = await FileModel.find()
      .sort({ createdAt: -1 }) // newest first
      .select('cid originalName size mimeType ownerAddress createdAt')
      .lean();                  // plain objects — faster and lower memory

    return NextResponse.json({ files }, { status: 200 });
  } catch (err) {
    console.error('[ZVault] GET /api/files error:', err);
    return NextResponse.json(
      { error: 'Failed to retrieve files.' },
      { status: 500 },
    );
  }
}
