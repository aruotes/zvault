import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPublicClient, http, decodeEventLog, isAddressEqual } from 'viem';
import { sepolia } from 'viem/chains';
import { connectToDatabase, FileModel, SharedAccessModel } from '@/lib/db';
import { serverEnv } from '@/env/server';

function getViemClient() {
  return createPublicClient({
    chain: sepolia,
    transport: http(serverEnv.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
  });
}

const FILE_REGISTRY_ADDRESS = '0x360C4b995537f6988CA1591Fb7678235b7f0e2AB' as const;

const ACCESS_GRANTED_ABI = [{
  type: 'event',
  name: 'AccessGranted',
  inputs: [
    { indexed: true, internalType: 'bytes32', name: 'fileId', type: 'bytes32' },
    { indexed: true, internalType: 'address', name: 'recipient', type: 'address' },
    { indexed: false, internalType: 'string', name: 'encryptedKey', type: 'string' },
  ],
}] as const;

const postSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a valid 32-byte transaction hash'),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join('; ') }, { status: 400 });
  }

  const { txHash } = parsed.data;

  try {
    await connectToDatabase();

    // Idempotency check
    const existing = await SharedAccessModel.findOne({ txHash }).lean();
    if (existing) {
      return NextResponse.json({ message: 'Already indexed' }, { status: 200 });
    }

    const client = getViemClient();
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (!receipt) {
      return NextResponse.json({ error: 'Transaction receipt not found.' }, { status: 422 });
    }

    if (receipt.status !== 'success') {
      return NextResponse.json({ error: 'Transaction was reverted on-chain.' }, { status: 422 });
    }

    // Envelope validation (receipt.to and receipt.from) REMOVED for Account Abstraction support.
    // Rely exclusively on the event emitted by FILE_REGISTRY_ADDRESS.

    let verifiedRecipient: string | null = null;
    let verifiedFileId: string | null = null;

    for (const log of receipt.logs) {
      if (!log.address || !isAddressEqual(log.address, FILE_REGISTRY_ADDRESS)) {
        continue;
      }

      try {
        const decoded = decodeEventLog({
          abi: ACCESS_GRANTED_ABI,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
          data: log.data,
        });

        if (decoded.eventName === 'AccessGranted') {
          const args = decoded.args as { fileId: `0x${string}`; recipient: `0x${string}` };
          verifiedRecipient = args.recipient.toLowerCase();
          verifiedFileId = args.fileId.toLowerCase();
          break;
        }
      } catch {
        // Not an AccessGranted log — skip
      }
    }

    if (!verifiedRecipient || !verifiedFileId) {
      return NextResponse.json({ error: 'AccessGranted event not found or malformed.' }, { status: 422 });
    }

    await SharedAccessModel.create({
      fileId: verifiedFileId,
      recipientAddress: verifiedRecipient,
      txHash,
      blockNumber: Number(receipt.blockNumber),
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('[ZVault] POST /api/files/shared error:', err);
    return NextResponse.json({ error: 'Internal server error during share indexing.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const recipient = searchParams.get('recipient');

  if (!recipient || !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    return NextResponse.json({ error: 'Valid recipient address required.' }, { status: 400 });
  }

  try {
    await connectToDatabase();
    
    // Find all shares for this recipient
    const shares = await SharedAccessModel.find({ recipientAddress: recipient.toLowerCase() }).lean();
    
    if (shares.length === 0) {
      return NextResponse.json({ shares: [] }, { status: 200 });
    }
    
    // Fetch corresponding file metadata for all these fileIds
    const fileIds = shares.map(s => s.fileId);
    
    // Use regex for case-insensitive fileId match since they are hex
    const files = await FileModel.find({ fileId: { $in: fileIds.map(id => new RegExp(`^${id}$`, 'i')) } }).lean();
    const filesMap = new Map();
    files.forEach(f => {
      if (f.fileId) filesMap.set(f.fileId.toLowerCase(), f);
    });

    // We don't join encryptedKey because it's not stored here.
    // The frontend uses blockNumber to pinpoint the event and get the key.
    
    const enriched = shares.map(share => {
      const file = filesMap.get(share.fileId);
      return {
        fileId: share.fileId,
        blockNumber: share.blockNumber,
        txHash: share.txHash,
        cid: file?.cid,
        originalName: file?.originalName,
        mimeType: file?.mimeType,
        ownerAddress: file?.ownerAddress,
      };
    });

    return NextResponse.json({ shares: enriched }, { status: 200 });
  } catch (err) {
    console.error('[ZVault] GET /api/files/shared error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
