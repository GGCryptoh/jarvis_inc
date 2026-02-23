import { NextRequest, NextResponse } from 'next/server';
import { verifySignature, buildSignatureData, isTimestampValid } from '@/lib/crypto';
import { getInstanceById, listPeersByIpHash, updateHeartbeat } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const instanceId = request.nextUrl.searchParams.get('instance_id');
    const timestamp = request.nextUrl.searchParams.get('timestamp');
    const signature = request.nextUrl.searchParams.get('signature');
    const publicKey = request.nextUrl.searchParams.get('public_key');

    if (!instanceId || !timestamp || !signature || !publicKey) {
      return NextResponse.json(
        { error: 'Missing required params: instance_id, timestamp, signature, public_key' },
        { status: 400 }
      );
    }

    // Validate timestamp (anti-replay)
    if (!isTimestampValid(parseInt(timestamp, 10))) {
      return NextResponse.json(
        { error: 'Invalid or expired timestamp' },
        { status: 400 }
      );
    }

    // Verify signature over the query params
    const signatureData = buildSignatureData({
      instance_id: instanceId,
      public_key: publicKey,
      timestamp: parseInt(timestamp, 10),
    });
    if (!verifySignature(publicKey, signature, signatureData)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Look up the requesting instance
    const instance = await getInstanceById(instanceId);
    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    // Update heartbeat (signed request = proof of life)
    await updateHeartbeat(instanceId);

    // Find peers with the same ip_hash
    const peers = await listPeersByIpHash(instanceId, instance.ip_hash);

    return NextResponse.json({ peers });
  } catch (error) {
    console.error('Peers error:', error);
    return NextResponse.json({ error: 'Failed to fetch peers' }, { status: 500 });
  }
}
