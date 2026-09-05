/**
 * PATCH /api/files/[cid]
 *
 * Server-side transaction verification before marking a file as on-chain registered.
 *
 * QA Fix A (P0): This route MUST NOT trust the client's claim that a tx succeeded.
 * It fetches the receipt from the Sepolia RPC and performs a full chain-of-custody
 * verification before mutating MongoDB state:
 *
 *   1. Fetch receipt from Sepolia — confirm tx is confirmed (status = 'success').
 *   2. Decode logs — find the FileRegistered event.
 *   3. SECURITY: Verify log.address is FILE_REGISTRY_ADDRESS (prevent spoofing).
 *   4. Verify event.owner matches MongoDB file.ownerAddress.
 *   5. Verify event.fileId === keccak256(toUtf8Bytes(cid)) (correct CID registered).
 *   6. Only then set { onChainRegistered: true, fileId: event.fileId }.
 */
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z }                         from 'zod';
import {
  createPublicClient,
  http,
  decodeEventLog,
  keccak256,
  stringToBytes,
  isAddressEqual,
} from 'viem';
import { sepolia } from 'viem/chains';
import { connectToDatabase, FileModel } from '@/lib/db';
import { serverEnv } from '@/env/server';

// ── Viem public client (server-side, no wallet needed) ────────────────────────

function getViemClient() {
  return createPublicClient({
    chain:     sepolia,
    transport: http(serverEnv.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
  });
}

// ── FileRegistry constants (hard-coded; same source as generated/FileRegistry.ts) ─

const FILE_REGISTRY_ADDRESS = '0x360C4b995537f6988CA1591Fb7678235b7f0e2AB' as const;

const FILE_REGISTERED_ABI = [{
  type:      'event',
  name:      'FileRegistered',
  inputs: [
    { indexed: true,  internalType: 'bytes32',  name: 'fileId',    type: 'bytes32'  },
    { indexed: true,  internalType: 'address',  name: 'owner',     type: 'address'  },
    { indexed: false, internalType: 'string',   name: 'cid',       type: 'string'   },
    { indexed: false, internalType: 'uint64',   name: 'timestamp', type: 'uint64'   },
  ],
}] as const;

// ── Validation schema ─────────────────────────────────────────────────────────

const patchSchema = z.object({
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a valid 32-byte transaction hash'),
});

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function PATCH(
  req:     NextRequest,
  context: { params: Promise<{ cid: string }> },
): Promise<NextResponse> {
  const { cid } = await context.params;

  // 1. Parse & validate request body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map(i => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { txHash } = parsed.data;

  try {
    await connectToDatabase();

    // 2. Load the MongoDB record for this CID
    const file = await FileModel.findOne({ cid }).lean();
    if (!file) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    if (file.onChainRegistered) {
      // Idempotent — already confirmed, nothing to do.
      return NextResponse.json({ fileId: file.fileId }, { status: 200 });
    }

    // 3. Fetch the transaction receipt from Sepolia (server-side RPC call)
    const client  = getViemClient();
    const receipt = await client.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });

    if (!receipt) {
      return NextResponse.json(
        { error: 'Transaction receipt not found on Sepolia. It may still be pending.' },
        { status: 422 },
      );
    }

    // 4. Verify tx status
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { error: 'Transaction was reverted on-chain.' },
        { status: 422 },
      );
    }

    // 5. Transaction envelope addresses (receipt.to / receipt.from) are NO LONGER checked.
    // Modern Account Abstraction (ERC-4337) and smart wallet proxies (like MetaMask
    // Delegation Manager) mean the tx might be sent to a relayer or proxy contract,
    // not directly to FileRegistry.
    // We rely exclusively on the emitted events from the authoritative contract.

    // 6. Decode logs — find FileRegistered event
    let onChainFileId: `0x${string}` | null = null;

    for (const log of receipt.logs) {
      // SECURITY: Ensure the event was actually emitted by our trusted contract.
      // An attacker could emit a spoofed FileRegistered event from a malicious contract.
      if (!log.address || !isAddressEqual(log.address, FILE_REGISTRY_ADDRESS)) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi:    FILE_REGISTERED_ABI,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          data:   log.data,
        });
        if (decoded.eventName === 'FileRegistered') {
          const args = decoded.args as { fileId: `0x${string}`; owner: `0x${string}`; cid: string };
          
          // Verify that the event's owner matches the database record owner
          if (!isAddressEqual(args.owner, file.ownerAddress as `0x${string}`)) {
            continue;
          }

          onChainFileId = args.fileId;
          break;
        }
      } catch {
        // Not a FileRegistered log — skip
      }
    }

    if (!onChainFileId) {
      return NextResponse.json(
        { error: 'FileRegistered event not found in transaction logs.' },
        { status: 422 },
      );
    }

    // 8. Verify on-chain fileId === keccak256(toUtf8Bytes(cid)) (QA Fix A — step 5)
    const expectedFileId = keccak256(stringToBytes(cid));
    if (onChainFileId.toLowerCase() !== expectedFileId.toLowerCase()) {
      return NextResponse.json(
        { error: 'On-chain fileId does not match the keccak256 of the stored CID. Possible CID tampering.' },
        { status: 422 },
      );
    }

    // 9. All checks passed — update MongoDB
    await FileModel.updateOne(
      { cid },
      { $set: { onChainRegistered: true, fileId: onChainFileId } },
    );

    return NextResponse.json({ fileId: onChainFileId }, { status: 200 });

  } catch (err) {
    console.error('[ZVault] PATCH /api/files/[cid] error:', err);
    return NextResponse.json(
      { error: 'Internal server error during transaction verification.' },
      { status: 500 },
    );
  }
}
