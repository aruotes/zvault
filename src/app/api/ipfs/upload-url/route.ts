/**
 * GET /api/ipfs/upload-url
 *
 * Generates a short-lived Pinata presigned upload URL using the server's
 * master PINATA_JWT. The URL is returned to the browser so the client can
 * upload the encrypted Blob DIRECTLY to Pinata without routing through this
 * server (bypassing Vercel's 4.5 MB serverless payload limit).
 *
 * Security guarantees:
 *  - PINATA_JWT never leaves the server.
 *  - The returned URL is valid for 60 seconds only (single-use, upload-only).
 *  - The URL grants access to upload exactly one file — no admin capabilities.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { getPinata } from '@/lib/ipfs';

export async function GET(): Promise<NextResponse> {
  try {
    const pinata = getPinata();

    const url = await pinata.upload.public.createSignedURL({
      expires: 60, // seconds — URL is dead 60s after generation
    });

    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    console.error('[ZVault] Failed to generate Pinata presigned URL:', err);
    return NextResponse.json(
      { error: 'Failed to generate upload URL. Please try again.' },
      { status: 500 },
    );
  }
}
